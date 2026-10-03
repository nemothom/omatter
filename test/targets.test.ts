import assert from "node:assert/strict";
import { test } from "node:test";
import { expandScene, snapshotScene } from "../src/scenes.ts";
import { resolveTargets } from "../src/targets.ts";

const lights: any[] = [
    { id: "1:1", name: "Desk lamp", room: "Office", reachable: true, on: true, brightness: 40, mode: "ct", kelvin: 2700, color: null },
    { id: "2:1", name: "Desk strip", room: "Office", reachable: true, on: false, brightness: 10, mode: null, kelvin: null, color: null },
    { id: "3:1", name: "Ceiling", room: "Living", reachable: false, on: false, brightness: null, mode: null, kelvin: null, color: null },
];

test("targets resolve by all, id, name, room, prefix and lists", () => {
    assert.deepEqual(resolveTargets("all", lights), ["1:1", "2:1", "3:1"]);
    assert.deepEqual(resolveTargets("3:1", lights), ["3:1"]);
    assert.deepEqual(resolveTargets("desk LAMP", lights), ["1:1"]);
    assert.deepEqual(resolveTargets("office", lights), ["1:1", "2:1"]);
    assert.deepEqual(resolveTargets("ceil", lights), ["3:1"]);
    assert.deepEqual(resolveTargets("ceiling, desk lamp", lights), ["3:1", "1:1"]);
    assert.throws(() => resolveTargets("desk", lights), /ambiguous/);
    assert.throws(() => resolveTargets("garage", lights), /No light/);
});

test("scenes merge wildcard and specific entries", () => {
    const plan = expandScene({ "*": { on: true, brightness: 50, kelvin: 3000 }, "Desk lamp": { color: "red" }, gone: { on: false } }, lights);
    assert.deepEqual(plan.get("2:1"), { on: true, brightness: 50, kelvin: 3000 });
    assert.deepEqual(plan.get("1:1"), { on: true, brightness: 50, hex: "#ff0000" });
    assert.equal(plan.size, 3);
});

test("snapshots skip unreachable lights and keep only relevant fields", () => {
    assert.deepEqual(snapshotScene(lights), { "1:1": { on: true, brightness: 40, kelvin: 2700 }, "2:1": { on: false } });
});
