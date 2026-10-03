// The built-in "theme" scene: colours lights from the active Omarchy theme and
// re-applies itself when the theme changes (while it is the active scene).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hsvToRgb, parseHex, rgbToHsv, toHex } from "./color.ts";
import type { Light, LightChange } from "./matter.ts";

export const THEME_SCENE = "theme";

export const OMARCHY_CURRENT = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "omarchy", "current");

// Theme keys in order of preference; the accent leads.
const PALETTE_KEYS = [
    "accent",
    "blue",
    "magenta",
    "cyan",
    "green",
    "yellow",
    "red",
    "orange",
    "bright_blue",
    "bright_magenta",
    "bright_cyan",
    "bright_green",
    "bright_yellow",
    "bright_red",
];

export type ThemePalette = { name: string; dark: boolean; colors: string[] };

/** Minimal parser for the flat `key = "value"` colors.toml Omarchy generates. */
export function parseColorsToml(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
        const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"([^"]*)"/);
        if (m) out[m[1]] = m[2];
    }
    return out;
}

/**
 * Picks distinct, light-friendly colours from a theme: greys are skipped, hues
 * closer than 25° are merged, and saturation is lifted so bulbs don't wash out.
 */
export function paletteFrom(colors: Record<string, string>): string[] {
    const picked: { hue: number; hex: string }[] = [];
    for (const key of PALETTE_KEYS) {
        const value = colors[key];
        if (!value) continue;
        let hsv;
        try {
            hsv = rgbToHsv(parseHex(value));
        } catch {
            continue;
        }
        if (hsv.s < 0.18 || hsv.v < 0.15) continue;
        const near = picked.some(p => {
            const d = Math.abs(p.hue - hsv.h);
            return Math.min(d, 360 - d) < 25;
        });
        if (near) continue;
        picked.push({ hue: hsv.h, hex: toHex(hsvToRgb(hsv.h, Math.max(hsv.s, 0.7), 1)) });
    }
    return picked.map(p => p.hex);
}

export function readThemePalette(): ThemePalette {
    let name = "theme";
    try {
        name = readFileSync(join(OMARCHY_CURRENT, "theme.name"), "utf8").trim() || name;
    } catch {}
    let colors: Record<string, string>;
    try {
        colors = parseColorsToml(readFileSync(join(OMARCHY_CURRENT, "theme", "colors.toml"), "utf8"));
    } catch {
        throw new Error(`Can't read the Omarchy theme colours in ${OMARCHY_CURRENT}/theme/colors.toml`);
    }
    return { name, dark: (colors.mode ?? "dark") !== "light", colors: paletteFrom(colors) };
}

/** Colour lights cycle through the palette; white-only lights get a matching white. */
export function themePlan(lights: Light[], palette: ThemePalette): Map<string, LightChange> {
    const plan = new Map<string, LightChange>();
    const brightness = palette.dark ? 55 : 85;
    let i = 0;
    for (const light of lights) {
        if (light.kind !== "light" || !light.reachable) continue;
        const change: LightChange = { on: true };
        if (light.caps.dim) change.brightness = brightness;
        if (light.caps.color && palette.colors.length) change.hex = palette.colors[i++ % palette.colors.length];
        else if (light.caps.ct) change.kelvin = palette.dark ? 2700 : 4000;
        plan.set(light.id, change);
    }
    return plan;
}
