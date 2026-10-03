import assert from "node:assert/strict";
import { test } from "node:test";
import {
    hsvToRgb, kelvinToMireds, levelToPercent, parseHex, percentToLevel, resolveColor, rgbToHsv, rgbToXy, toHex, xyToRgb,
} from "../src/color.ts";

test("hex parsing and formatting round-trips", () => {
    assert.deepEqual(parseHex("#f80"), { r: 255, g: 136, b: 0 });
    assert.equal(toHex(parseHex("3a2bff")), "#3a2bff");
    assert.throws(() => parseHex("nope"));
});

test("names resolve to colours or temperatures", () => {
    assert.deepEqual(resolveColor("Red"), { hex: "#ff0000" });
    assert.deepEqual(resolveColor("warm"), { kelvin: 2700 });
    assert.deepEqual(resolveColor("#00FF00"), { hex: "#00ff00" });
});

test("xy round-trip keeps the hue", () => {
    for (const hex of ["#ff0000", "#00ff3c", "#1e3cff", "#ff00d4", "#ffb000"]) {
        const { x, y } = rgbToXy(parseHex(hex));
        const back = rgbToHsv(xyToRgb(x, y));
        const orig = rgbToHsv(parseHex(hex));
        const dh = Math.min(Math.abs(back.h - orig.h), 360 - Math.abs(back.h - orig.h));
        assert.ok(dh < 4, `${hex}: hue drift ${dh}`);
    }
});

test("white maps near the D65 white point", () => {
    const { x, y } = rgbToXy({ r: 255, g: 255, b: 255 });
    assert.ok(Math.abs(x - 0.3227) < 0.02 && Math.abs(y - 0.329) < 0.02, `${x},${y}`);
});

test("hsv round-trip", () => {
    assert.equal(toHex(hsvToRgb(...(Object.values(rgbToHsv(parseHex("#8c1eff"))) as [number, number, number]))), "#8c1eff");
});

test("level and mired conversions", () => {
    assert.equal(levelToPercent(254), 100);
    assert.equal(percentToLevel(100), 254);
    assert.equal(percentToLevel(0), 1);
    assert.equal(levelToPercent(percentToLevel(50)), 50);
    assert.equal(kelvinToMireds(2700), 370);
});
