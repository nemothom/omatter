import assert from "node:assert/strict";
import { test } from "node:test";
import { roomList, sortDevices } from "../src/order.ts";

const devices = [
    { id: "1:1", name: "Floor lamp", room: "Living room" },
    { id: "2:1", name: "Ceiling", room: "Living room" },
    { id: "3:1", name: "Bedside", room: "Bedroom" },
    { id: "4:1", name: "Wardrobe", room: "Bedroom" },
    { id: "5:1", name: "Loose", room: null },
    { id: "6:1", name: "Porch", room: "Hallway" },
];

const ids = (list: { id: string }[]) => list.map(d => d.id);

test("default order: rooms alphabetical, no-room last, devices by name", () => {
    assert.deepEqual(roomList(devices), ["Bedroom", "Hallway", "Living room", ""]);
    assert.deepEqual(ids(sortDevices(devices)), ["3:1", "4:1", "6:1", "2:1", "1:1", "5:1"]);
});

test("room order puts placed rooms first, unplaced ones alphabetically after", () => {
    const prefs = { roomOrder: ["Living room"] };
    assert.deepEqual(roomList(devices, prefs), ["Living room", "Bedroom", "Hallway", ""]);
    assert.deepEqual(roomList(devices, { roomOrder: ["", "Living room"] }), ["", "Living room", "Bedroom", "Hallway"]);
});

test("device order applies within rooms; unplaced devices follow by name", () => {
    const prefs = { roomOrder: ["Living room", "Bedroom"], deviceOrder: ["1:1", "3:1"] };
    assert.deepEqual(ids(sortDevices(devices, prefs)), ["1:1", "2:1", "3:1", "4:1", "6:1", "5:1"]);
});

test("stale ids and rooms in the prefs are ignored", () => {
    const prefs = { roomOrder: ["Garage", "Living room"], deviceOrder: ["99:1", "2:1"] };
    assert.deepEqual(roomList(devices, prefs), ["Living room", "Bedroom", "Hallway", ""]);
    assert.equal(sortDevices(devices, prefs)[0].id, "2:1");
});
