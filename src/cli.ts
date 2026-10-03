// omatter: command-line client for omatterd.

import { setTimeout as sleep } from "node:timers/promises";
import { CONFIG_PATH } from "./config.ts";
import type { Socket } from "node:net";
import { connectDaemon, onLines, request, send } from "./ipc.ts";
import type { DeviceDetails, Light, Sensor } from "./matter.ts";

const USAGE = `omatter — control Matter lights

  omatter list                          lights and their state (--json for raw)
  omatter on|off|toggle [target]        target: light, room, id, "a,b" or all (default)
  omatter brightness <target> <0-100|+N|-N>
  omatter color <target> <#hex|name>    names: red orange amber yellow lime green teal cyan
                                        sky blue indigo purple violet magenta pink rose
  omatter temp <target> <kelvin|warm|neutral|cool|daylight>
  omatter scene <name>                  apply a scene ("theme" = colours of your Omarchy theme)
  omatter scene list | save <name> [target] | rename <name> <new> | rm <name>
  omatter pair <code> [--name N] [--room R]
                                        code from Apple Home › light › Turn On Pairing Mode
  omatter rename <target> <new name>
  omatter room <target> <room>          ("" to clear)
  omatter forget <target>               remove this PC as a controller of that device
  omatter order rooms <room,room,...>   set room order ("" or - = no room); order reset to clear
  omatter details <target>              firmware, address, signal, battery, last seen
  omatter reconnect <target>            force a reconnect to a flaky device
  omatter watch                         stream state as JSON lines (used by the bar widget)

Config & scenes: ${CONFIG_PATH}`;

function flag(args: string[], name: string): string | undefined {
    const i = args.indexOf(`--${name}`);
    if (i < 0) return undefined;
    const [, value] = args.splice(i, 2);
    return value;
}

function need(value: string | undefined, what: string): string {
    if (value === undefined || value === "") throw new Error(`Missing ${what}\n\n${USAGE}`);
    return value;
}

function sensorSummary(s: Sensor): string {
    const r = s.readings;
    const parts: string[] = [];
    if (r.temperature !== undefined) parts.push(`${r.temperature.toFixed(1)}°C`);
    if (r.humidity !== undefined) parts.push(`${r.humidity}%RH`);
    if (r.occupied !== undefined) parts.push(r.occupied ? "occupied" : "clear");
    if (r.illuminance !== undefined) parts.push(`${r.illuminance} lx`);
    if (r.contact !== undefined) parts.push(r.contact ? "closed" : "open");
    if (s.battery !== null) parts.push(`🔋${s.battery}%`);
    return parts.join("  ") || "no readings yet";
}

function printSensors(sensors: Sensor[]) {
    if (sensors.length === 0) return;
    console.log("\nSENSORS");
    for (const s of sensors) {
        const state = s.reachable ? sensorSummary(s) : "unreachable";
        console.log(`  ◇ ${s.name.padEnd(24)} ${state.padEnd(24)} ${s.id}${s.room ? `  (${s.room})` : ""}`);
    }
}

function printDetails(d: DeviceDetails) {
    const ago = (ms: number | null) =>
        ms === null ? "never" : ms < 60_000 ? `${Math.round(ms / 1000)}s ago` : `${Math.round(ms / 60_000)} min ago`;
    const rows: [string, string][] = [
        ["Device", d.product.startsWith(d.vendor) ? d.product : `${d.vendor} ${d.product}`],
        ["State", d.state],
        ["Last seen", ago(d.lastSeenMs)],
        ["Firmware", d.firmware],
        ["Hardware", d.hardware],
        ["Serial", d.serial ?? "—"],
        ["Address", d.addresses.join(", ") || "—"],
        ["Wi-Fi signal", d.rssi === null ? "—" : `${d.rssi} dBm`],
        ["Battery", d.battery === null ? "—" : `${d.battery}%`],
        ["Report interval", d.subscriptionIntervalSec === null ? "—" : `${d.subscriptionIntervalSec}s`],
        ["Id", d.id],
    ];
    for (const [k, v] of rows) console.log(`  ${k.padEnd(16)} ${v}`);
}

function printLights(lights: Light[]) {
    if (lights.length === 0) {
        console.log("No lights yet. Pair one with: omatter pair <code> --name \"Desk lamp\"");
        return;
    }
    let room: string | null | undefined;
    for (const l of lights) {
        if (l.room !== room) {
            room = l.room;
            console.log(`\n${(room ?? "No room").toUpperCase()}`);
        }
        const state = !l.reachable
            ? "unreachable"
            : !l.on
              ? "off"
              : [
                    "on",
                    l.brightness !== null ? `${l.brightness}%` : "",
                    l.mode === "ct" ? `${l.kelvin}K` : l.mode === "color" ? l.color : "",
                ]
                    .filter(Boolean)
                    .join("  ");
        const kind = l.kind === "light" ? "" : `  [${l.kind}]`;
        console.log(`  ${l.on && l.reachable ? "●" : "○"} ${l.name.padEnd(24)} ${state.padEnd(24)} ${l.id}${kind}`);
    }
}

async function watch() {
    // Reconnects forever; emits a "daemon" event so the widget can show offline state.
    // Also forwards {"cmd": ..., "args": ...} lines from stdin, so the widget can
    // drive sliders without spawning a process per change.
    let current: Socket | null = null;
    let nextId = 2;
    const pending = new Map<number, string>(); // request id → cmd, to label replies
    let stdinBuffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
        stdinBuffer += chunk;
        const lines = stdinBuffer.split("\n");
        stdinBuffer = lines.pop() ?? "";
        for (const line of lines) {
            try {
                const { cmd, args } = JSON.parse(line);
                if (!current || !cmd) continue;
                pending.set(nextId, cmd);
                send(current, { id: nextId++, cmd, args });
            } catch {
                // Ignore malformed input.
            }
        }
    });
    process.stdin.on("end", () => process.exit(0));

    let announcedDown = false;
    for (;;) {
        try {
            const socket = await connectDaemon();
            current = socket;
            announcedDown = false;
            console.log(JSON.stringify({ event: "daemon", up: true }));
            onLines(socket, msg => {
                if (msg.event) {
                    console.log(JSON.stringify(msg));
                    return;
                }
                const cmd = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.ok === false) console.log(JSON.stringify({ event: "error", cmd, error: msg.error }));
                else if (cmd) console.log(JSON.stringify({ event: "result", cmd, result: msg.result }));
            });
            send(socket, { id: 1, cmd: "subscribe" });
            await new Promise(resolve => socket.once("close", resolve));
            current = null;
        } catch {
            // Daemon not running.
        }
        if (!announcedDown) console.log(JSON.stringify({ event: "daemon", up: false }));
        announcedDown = true;
        await sleep(3000);
    }
}

async function main() {
    const args = process.argv.slice(2);
    const json = args.includes("--json");
    if (json) args.splice(args.indexOf("--json"), 1);
    const [cmd, ...rest] = args;

    const show = (result: any) => (json ? console.log(JSON.stringify(result, null, 2)) : undefined);

    switch (cmd) {
        case "list":
        case "status": {
            const state = await request("status");
            if (json) show({ lights: state.lights, sensors: state.sensors });
            else {
                printLights(state.lights);
                printSensors(state.sensors ?? []);
            }
            break;
        }
        case "on":
        case "off":
            show(await request("set", { target: rest.join(" ") || "all", on: cmd === "on" }));
            break;
        case "toggle":
            show(await request("set", { target: rest.join(" ") || "all", toggle: true }));
            break;
        case "brightness":
        case "bri":
        case "dim": {
            const target = need(rest[0], "target");
            const value = need(rest[1], "brightness");
            const isDelta = /^[+-]/.test(value);
            if (!/^[+-]?\d+%?$/.test(value)) throw new Error(`Invalid brightness "${value}"`);
            const n = parseInt(value, 10);
            show(await request("set", { target, ...(isDelta ? { brightnessDelta: n } : { brightness: n }) }));
            break;
        }
        case "color":
        case "colour":
            show(await request("set", { target: need(rest[0], "target"), color: need(rest[1], "colour") }));
            break;
        case "temp":
        case "temperature": {
            const target = need(rest[0], "target");
            const value = need(rest[1], "temperature").replace(/k$/i, "");
            show(await request("set", /^\d+$/.test(value) ? { target, kelvin: Number(value) } : { target, color: value }));
            break;
        }
        case "scene": {
            const [sub, name, target] = rest;
            if (!sub || sub === "list") {
                if (json) show(await request("scene.list"));
                else {
                    const state = await request("status");
                    for (const name of state.scenes) {
                        const tags = [state.builtinScenes?.includes(name) && "built-in", state.activeScene === name && "active"];
                        const suffix = tags.filter(Boolean).join(", ");
                        console.log(suffix ? `${name}  (${suffix})` : name);
                    }
                }
            } else if (sub === "save") {
                const r = await request("scene.save", { name: need(name, "scene name"), target });
                console.log(`Saved scene "${r.saved}" (${r.lights} lights)`);
            } else if (sub === "rename" || sub === "mv") {
                await request("scene.rename", { name: need(name, "scene name"), to: need(rest.slice(2).join(" "), "new name") });
            } else if (sub === "rm" || sub === "delete") {
                await request("scene.rm", { name: need(name, "scene name") });
            } else {
                show(await request("scene.apply", { name: rest.join(" ") }));
            }
            break;
        }
        case "pair": {
            const name = flag(rest, "name");
            const room = flag(rest, "room");
            const code = need(rest.join(""), "pairing code");
            console.error("Pairing… (this can take up to a couple of minutes)");
            const lights: Light[] = await request("pair", { code, name, room }, 300_000);
            json ? show(lights) : printLights(lights);
            break;
        }
        case "rename":
            await request("rename", { target: need(rest[0], "target"), name: need(rest.slice(1).join(" "), "new name") });
            break;
        case "room":
            await request("room", { target: need(rest[0], "target"), room: rest.slice(1).join(" ") });
            break;
        case "forget":
            show(await request("forget", { target: need(rest[0], "target") }, 60_000));
            break;
        case "order": {
            const [sub, ...list] = rest;
            if (sub === "rooms") {
                const rooms = list.join(" ").split(",").map(r => r.trim()).map(r => (r === "-" ? "" : r));
                if (rooms.length === 0 || (rooms.length === 1 && rooms[0] === "")) throw new Error("Give rooms, e.g. omatter order rooms Kitchen,Bedroom");
                show(await request("order.set", { rooms }));
            } else if (sub === "reset") {
                show(await request("order.set", { rooms: [], devices: [] }));
            } else {
                throw new Error("Usage: omatter order rooms <room,room,...> | omatter order reset\n(Device order is easiest from the bar widget's arrange mode.)");
            }
            break;
        }
        case "details":
        case "info": {
            const d = await request("details", { target: need(rest.join(" "), "target") });
            json ? show(d) : printDetails(d);
            break;
        }
        case "reconnect":
            show(await request("reconnect", { target: need(rest.join(" "), "target") }));
            break;
        case "watch":
            await watch();
            break;
        case undefined:
        case "help":
        case "-h":
        case "--help":
            console.log(USAGE);
            break;
        default:
            throw new Error(`Unknown command "${cmd}"\n\n${USAGE}`);
    }
}

main().catch((e: any) => {
    if (e?.code === "ENOENT" || e?.code === "ECONNREFUSED") {
        console.error("omatterd is not running. Start it with: systemctl --user start omatterd");
    } else {
        console.error(`omatter: ${e?.message ?? e}`);
    }
    process.exit(1);
});
