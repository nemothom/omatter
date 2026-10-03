// omatterd: long-running Matter controller exposing a local socket API.

import { existsSync, mkdirSync, unlinkSync, watch } from "node:fs";
import { createServer, type Socket } from "node:net";
import { dirname } from "node:path";
import { resolveColor } from "./color.ts";
import { ICON_STYLES, loadConfig, SOCKET_PATH, updateConfig } from "./config.ts";
import { connectDaemon, onLines, send, type Request } from "./ipc.ts";
import { type LightChange, LightManager } from "./matter.ts";
import { roomList, sortDevices } from "./order.ts";
import { expandScene, snapshotScene } from "./scenes.ts";
import { resolveTargets } from "./targets.ts";
import { OMARCHY_CURRENT, readThemePalette, THEME_SCENE, themePlan } from "./theme.ts";

const MAX_RECENT_COLORS = 8;
const MAX_FAVORITE_COLORS = 12;

const subscribers = new Set<Socket>();
let pairing = false;
/** Last scene applied, cleared by any manual change; lets "theme" follow theme switches. */
let activeScene: string | null = null;

function sceneNames() {
    const names = Object.keys(loadConfig().scenes);
    if (!names.includes(THEME_SCENE)) names.push(THEME_SCENE);
    return names;
}

function snapshot() {
    const config = loadConfig();
    const lights = sortDevices(manager.lights(), config.ui);
    const sensors = sortDevices(manager.sensors(), config.ui);
    return {
        event: "state",
        lights,
        sensors,
        rooms: roomList([...lights, ...sensors], config.ui),
        // Lights and sensors interleaved in display order.
        order: sortDevices([...lights, ...sensors], config.ui).map(d => d.id),
        scenes: sceneNames(),
        builtinScenes: THEME_SCENE in config.scenes ? [] : [THEME_SCENE],
        activeScene,
        ui: config.ui,
    };
}

function broadcast() {
    if (subscribers.size === 0) return;
    const msg = snapshot();
    for (const s of subscribers) send(s, msg);
}

const manager = new LightManager(broadcast);

const targets = (target: string | undefined) => resolveTargets(target || "all", manager.lights());
/** Lights plus sensors, for naming/room/forget/details. */
const deviceTargets = (target: string | undefined) =>
    resolveTargets(target || "all", [...manager.lights(), ...manager.sensors()]);

function rememberColor(hex: string) {
    updateConfig(c => {
        const recent = (c.ui.recentColors ?? []).filter(h => h !== hex);
        c.ui.recentColors = [hex, ...recent].slice(0, MAX_RECENT_COLORS);
    });
}

async function applyScene(name: string) {
    let plan: Map<string, LightChange>;
    const scene = loadConfig().scenes[name];
    if (scene) plan = expandScene(scene, manager.lights());
    else if (name === THEME_SCENE) plan = themePlan(manager.lights(), readThemePalette());
    else throw new Error(`No scene called "${name}"`);
    const result = await applyAll(plan);
    activeScene = name;
    broadcast();
    return result;
}

async function applyAll(plan: Map<string, LightChange>) {
    const results = await Promise.allSettled([...plan].map(([id, change]) => manager.apply(id, change)));
    const failed = results
        .map((r, i) => (r.status === "rejected" ? `${[...plan.keys()][i]}: ${r.reason?.message ?? r.reason}` : null))
        .filter(Boolean);
    if (failed.length === results.length && failed.length > 0) throw new Error(failed.join("; "));
    return { applied: results.length - failed.length, failed };
}

const handlers: Record<string, (args: any) => Promise<any> | any> = {
    status: () => snapshot(),

    async set(args) {
        const ids = targets(args.target);
        const change: LightChange = {};
        if (args.color !== undefined) Object.assign(change, resolveColor(String(args.color)));
        if (change.hex && String(args.color).startsWith("#")) rememberColor(change.hex);
        if (args.kelvin !== undefined) change.kelvin = Number(args.kelvin);
        if (args.on !== undefined) change.on = !!args.on;
        if (args.toggle) {
            // Group toggle: anything lit → all off, otherwise all on.
            const lights = manager.lights().filter(l => ids.includes(l.id));
            change.on = !lights.some(l => l.on);
        }

        const plan = new Map<string, LightChange>();
        const lights = manager.lights();
        for (const id of ids) {
            const c = { ...change };
            if (args.brightness !== undefined) c.brightness = Math.max(0, Math.min(100, Number(args.brightness)));
            if (args.brightnessDelta !== undefined) {
                const l = lights.find(x => x.id === id);
                const current = l?.on ? (l.brightness ?? 100) : 0;
                c.brightness = Math.max(0, Math.min(100, current + Number(args.brightnessDelta)));
                // Scrolling down never turns a light *on*, and stops at 1% instead of off.
                if (!l?.on && Number(args.brightnessDelta) < 0) continue;
                if (l?.on && c.brightness <= 0) c.brightness = 1;
            }
            plan.set(id, c);
        }
        if (activeScene !== null) {
            activeScene = null;
            broadcast();
        }
        return applyAll(plan);
    },

    "scene.apply": ({ name }) => applyScene(String(name)),

    "scene.save"({ name, target }) {
        name = String(name ?? "").trim();
        if (!name) throw new Error("Scene name required");
        const ids = target ? targets(target) : null;
        const lights = manager.lights().filter(l => !ids || ids.includes(l.id));
        const scene = snapshotScene(lights);
        if (Object.keys(scene).length === 0) throw new Error("No reachable lights to save");
        updateConfig(c => (c.scenes[name] = scene));
        broadcast();
        return { saved: name, lights: Object.keys(scene).length };
    },

    "scene.rm"({ name }) {
        let existed = false;
        updateConfig(c => {
            existed = name in c.scenes;
            delete c.scenes[name];
        });
        if (!existed) throw new Error(`No scene called "${name}"`);
        broadcast();
        return { removed: name };
    },

    "scene.rename"({ name, to }) {
        const newName = String(to ?? "").trim();
        if (!newName) throw new Error("New scene name required");
        updateConfig(c => {
            if (!(name in c.scenes)) throw new Error(`No scene called "${name}"`);
            if (newName !== name && newName in c.scenes) throw new Error(`A scene called "${newName}" already exists`);
            // Rebuild to keep the scene's position in the list.
            c.scenes = Object.fromEntries(Object.entries(c.scenes).map(([k, v]) => [k === name ? newName : k, v]));
        });
        broadcast();
        return { renamed: name, to: newName };
    },

    "scene.list": () => loadConfig().scenes,

    "colors.favorite"({ hex, remove }) {
        const color = resolveColor(String(hex));
        if (!("hex" in color)) throw new Error("Favourites must be colours, not white temperatures");
        updateConfig(c => {
            const favs = (c.ui.favoriteColors ?? []).filter(h => h !== color.hex);
            c.ui.favoriteColors = remove ? favs : [...favs, color.hex].slice(-MAX_FAVORITE_COLORS);
        });
        broadcast();
        return loadConfig().ui.favoriteColors;
    },

    details({ target }) {
        const [id, ...rest] = deviceTargets(target);
        if (!id || rest.length) throw new Error("Details need exactly one device");
        return manager.details(id);
    },

    reconnect({ target }) {
        const ids = deviceTargets(target);
        ids.forEach(id => manager.reconnect(id));
        return { reconnecting: ids };
    },

    "order.set"({ rooms, devices }) {
        const strings = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === "string");
        if (rooms !== undefined && !strings(rooms)) throw new Error("rooms must be a list of room names");
        if (devices !== undefined && !strings(devices)) throw new Error("devices must be a list of device ids");
        if (rooms !== undefined) {
            // Match typed names to existing rooms regardless of case.
            const known = roomList([...manager.lights(), ...manager.sensors()]);
            rooms = rooms.map((r: string) => known.find(k => k.toLowerCase() === r.trim().toLowerCase()) ?? r.trim());
        }
        updateConfig(c => {
            if (rooms !== undefined) c.ui.roomOrder = rooms;
            if (devices !== undefined) c.ui.deviceOrder = devices;
        });
        broadcast();
        return { rooms: loadConfig().ui.roomOrder ?? [], devices: loadConfig().ui.deviceOrder ?? [] };
    },

    "ui.set"(prefs) {
        if (prefs.icon !== undefined && !ICON_STYLES.includes(prefs.icon)) {
            throw new Error(`Unknown icon "${prefs.icon}" (choose ${ICON_STYLES.join(", ")})`);
        }
        updateConfig(c => {
            if (prefs.icon !== undefined) c.ui.icon = prefs.icon;
            if (Array.isArray(prefs.collapsedRooms)) c.ui.collapsedRooms = prefs.collapsedRooms.map(String);
        });
        broadcast();
        return loadConfig().ui;
    },

    async pair({ code, name, room }) {
        if (!code) throw new Error("Pairing code required");
        if (pairing) throw new Error("Already pairing a device; wait for it to finish");
        pairing = true;
        let ids: string[];
        try {
            ids = await manager.pair(String(code));
        } finally {
            pairing = false;
        }
        updateConfig(c => {
            ids.forEach((id, i) => {
                c.lights[id] ??= {};
                if (name) c.lights[id].name = ids.length > 1 ? `${name} ${i + 1}` : name;
                if (room) c.lights[id].room = String(room).trim();
            });
        });
        broadcast();
        return [...manager.lights(), ...manager.sensors()].filter(d => ids.includes(d.id));
    },

    rename({ target, name }) {
        const [id, ...rest] = deviceTargets(target);
        if (!id || rest.length) throw new Error("Rename needs exactly one device");
        updateConfig(c => ((c.lights[id] ??= {}).name = name));
        broadcast();
        return { id, name };
    },

    room({ target, room }) {
        const ids = deviceTargets(target);
        updateConfig(c => ids.forEach(id => ((c.lights[id] ??= {}).room = room || undefined)));
        broadcast();
        return { ids, room };
    },

    async forget({ target }) {
        const ids = deviceTargets(target);
        const nodes = [...new Set(ids.map(id => id.split(":")[0]))];
        for (const node of nodes) await manager.forget(node);
        updateConfig(c => {
            for (const id of Object.keys(c.lights)) if (nodes.includes(id.split(":")[0])) delete c.lights[id];
        });
        return { forgotten: nodes };
    },
};

async function handle(socket: Socket, req: Request) {
    if (req.cmd === "subscribe") {
        subscribers.add(socket);
        socket.on("close", () => subscribers.delete(socket));
        send(socket, snapshot());
        return;
    }
    try {
        const handler = handlers[req.cmd];
        if (!handler) throw new Error(`Unknown command "${req.cmd}"`);
        send(socket, { id: req.id, ok: true, result: await handler(req.args ?? {}) });
    } catch (e: any) {
        send(socket, { id: req.id, ok: false, error: e?.message ?? String(e) });
    }
}

async function clearStaleSocket() {
    if (!existsSync(SOCKET_PATH)) return;
    try {
        (await connectDaemon()).end();
        console.error(`omatterd is already running (${SOCKET_PATH})`);
        process.exit(1);
    } catch {
        unlinkSync(SOCKET_PATH);
    }
}

/** Re-applies the theme scene when the Omarchy theme changes, if it's the active scene. */
function watchTheme() {
    let timer: NodeJS.Timeout | undefined;
    try {
        watch(OMARCHY_CURRENT, () => {
            clearTimeout(timer);
            // Theme switches rewrite several files; wait for them to settle.
            timer = setTimeout(() => {
                if (activeScene !== THEME_SCENE) return;
                applyScene(THEME_SCENE).catch(e => console.error(`Theme scene: ${e.message}`));
            }, 1500);
        });
    } catch (e: any) {
        console.error(`Not following Omarchy theme changes: ${e.message}`);
    }
}

async function main() {
    mkdirSync(dirname(SOCKET_PATH), { recursive: true });
    await clearStaleSocket();
    loadConfig(); // Creates the default config on first run.

    await manager.start();

    const server = createServer(socket => {
        socket.on("error", () => subscribers.delete(socket));
        onLines(socket, req => void handle(socket, req));
    });
    server.listen(SOCKET_PATH, () => console.log(`omatterd listening on ${SOCKET_PATH}`));

    watchTheme();

    const shutdown = async () => {
        server.close();
        try {
            unlinkSync(SOCKET_PATH);
        } catch {}
        await manager.stop();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
