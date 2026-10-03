// Fake omatterd for working on the bar widget without touching real devices.
// Serves a fixed snapshot (lights, a plug, sensors, scenes, favourites) on the
// real socket and answers every command with ok (details gets fake data).
//
//   systemctl --user stop omatterd
//   node dev/mock-daemon.mjs            # Ctrl+C to stop
//   systemctl --user start omatterd
//
// Commands are logged, so you can see exactly what the widget sends.

import { unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

const SOCKET = process.env.OMATTER_SOCKET || join(process.env.XDG_RUNTIME_DIR || "/tmp", "omatter.sock");
const caps = { dim: true, color: true, ct: true, ctMin: 2000, ctMax: 6500 };
const noCaps = { dim: false, color: false, ct: false, ctMin: 2000, ctMax: 6500 };
const light = (id, name, room, extra) => ({
    id, kind: "light", nodeId: id.split(":")[0], endpoint: 1, name, room, product: "Mock bulb",
    reachable: true, on: true, brightness: 60, mode: "ct", color: null, kelvin: 2700, caps, ...extra,
});

const lights = [
    light("1:1", "Desk lamp", "Office"),
    light("2:1", "LED strip", "Office", { mode: "color", color: "#8c1eff", kelvin: null, brightness: 30 }),
    light("3:1", "Ceiling", "Living room", { on: false }),
    light("4:1", "Floor lamp", "Living room", { reachable: false, on: false }),
    light("5:1", "Coffee machine", "Kitchen", { kind: "plug", brightness: null, mode: null, kelvin: null, caps: noCaps }),
];
const sensors = [
    { id: "6:1", nodeId: "6", endpoint: 1, name: "Climate", room: "Living room", product: "Mock sensor", reachable: true, readings: { temperature: 21.4, humidity: 48 }, battery: 87 },
    { id: "7:1", nodeId: "7", endpoint: 1, name: "Front door", room: "Kitchen", product: "Mock contact", reachable: true, readings: { contact: false }, battery: 15 },
];
const all = [...lights, ...sensors];
const snapshot = {
    event: "state",
    lights,
    sensors,
    rooms: ["Office", "Living room", "Kitchen"],
    order: all.map(d => d.id),
    scenes: ["bright", "relax", "night", "theme"],
    builtinScenes: ["theme"],
    activeScene: "relax",
    ui: { collapsedRooms: [], favoriteColors: ["#8c1eff", "#ffa34d"], recentColors: ["#ff00d4", "#00e5ff"], icon: "bulb" },
};

const details = id => ({
    id, nodeId: id.split(":")[0], endpoint: 1, vendor: "Mock", product: "Mock device", firmware: "1.2.3",
    hardware: "1", serial: "MOCK0001", state: "connected", lastSeenMs: 4200, addresses: ["fe80::1%wlo1"],
    rssi: -61, battery: null, subscriptionIntervalSec: 60,
});

try { unlinkSync(SOCKET); } catch {}
createServer(socket => {
    socket.on("error", () => {});
    let buffer = "";
    socket.on("data", chunk => {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
            const msg = JSON.parse(buffer.slice(0, nl));
            buffer = buffer.slice(nl + 1);
            console.log("←", JSON.stringify(msg));
            if (msg.cmd === "subscribe") socket.write(JSON.stringify(snapshot) + "\n");
            else if (msg.cmd === "status") socket.write(JSON.stringify({ id: msg.id, ok: true, result: snapshot }) + "\n");
            else if (msg.cmd === "details") socket.write(JSON.stringify({ id: msg.id, ok: true, result: details(msg.args.target) }) + "\n");
            else socket.write(JSON.stringify({ id: msg.id, ok: true, result: {} }) + "\n");
        }
    });
}).listen(SOCKET, () => console.log(`mock omatterd on ${SOCKET}`));

process.on("SIGINT", () => {
    try { unlinkSync(SOCKET); } catch {}
    process.exit(0);
});
