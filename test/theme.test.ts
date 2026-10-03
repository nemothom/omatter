import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHex, rgbToHsv } from "../src/color.ts";
import { paletteFrom, parseColorsToml, themePlan } from "../src/theme.ts";
import { resolveTargets } from "../src/targets.ts";

const TOML = `# Generated
mode = "dark"
accent = "#946cc8"
muted = "#9e9e9e"
background = "#121212"
blue = "#946cc8"
magenta = "#b963be"
cyan = "#e1a56c"
yellow = "#e3b582"
red = "#b87063"
`;

test("colors.toml parsing", () => {
    const c = parseColorsToml(TOML);
    assert.equal(c.mode, "dark");
    assert.equal(c.accent, "#946cc8");
    assert.equal(c.red, "#b87063");
});

test("palette skips greys, merges near hues, leads with the accent and saturates", () => {
    const palette = paletteFrom(parseColorsToml(TOML));
    assert.ok(palette.length >= 3 && palette.length <= 5, palette.join(","));
    const hues = palette.map(h => rgbToHsv(parseHex(h)));
    assert.ok(Math.abs(hues[0].h - rgbToHsv(parseHex("#946cc8")).h) < 2, "accent first");
    for (const h of hues) assert.ok(h.s >= 0.69 && h.v > 0.99, "vivid");
    for (let i = 0; i < hues.length; i++)
        for (let j = i + 1; j < hues.length; j++) {
            const d = Math.abs(hues[i].h - hues[j].h);
            assert.ok(Math.min(d, 360 - d) >= 25, "distinct hues");
        }
});

const caps = (color: boolean, ct: boolean) => ({ dim: true, color, ct, ctMin: 2000, ctMax: 6500 });
const lights: any[] = [
    { id: "1:1", kind: "light", name: "A", reachable: true, caps: caps(true, true) },
    { id: "2:1", kind: "light", name: "B", reachable: true, caps: caps(true, true) },
    { id: "3:1", kind: "light", name: "White", reachable: true, caps: caps(false, true) },
    { id: "4:1", kind: "plug", name: "Fridge", room: "Kitchen", reachable: true, caps: { ...caps(false, false), dim: false } },
    { id: "5:1", kind: "light", name: "Gone", reachable: false, caps: caps(true, true) },
];

test("theme plan colours colour lights, whitens CT lights and leaves plugs alone", () => {
    const plan = themePlan(lights, { name: "t", dark: true, colors: ["#ff0000", "#00ff00"] });
    assert.deepEqual(plan.get("1:1"), { on: true, brightness: 55, hex: "#ff0000" });
    assert.deepEqual(plan.get("2:1"), { on: true, brightness: 55, hex: "#00ff00" });
    assert.deepEqual(plan.get("3:1"), { on: true, brightness: 55, kelvin: 2700 });
    assert.equal(plan.has("4:1"), false);
    assert.equal(plan.has("5:1"), false);
});

test('"all" excludes plugs, but rooms and names still reach them', () => {
    assert.deepEqual(resolveTargets("all", lights), ["1:1", "2:1", "3:1", "5:1"]);
    assert.deepEqual(resolveTargets("kitchen", lights), ["4:1"]);
    assert.deepEqual(resolveTargets("fridge", lights), ["4:1"]);
});
