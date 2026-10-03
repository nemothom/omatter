// User config: friendly names, rooms and scenes. Lives in
// ~/.config/omatter/config.json and is re-read on every access so hand edits
// apply without restarting the daemon.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Target state for one light inside a scene. Omitted fields are left untouched. */
export type SceneState = {
    on?: boolean;
    brightness?: number; // 0-100
    color?: string; // #hex or colour name
    kelvin?: number;
};

/** Scene: light id/name/room (or "*" for every light) → state. */
export type Scene = Record<string, SceneState>;

/** Bar widget preferences, kept here so they survive shell restarts. */
export type UiPrefs = {
    collapsedRooms?: string[];
    favoriteColors?: string[];
    recentColors?: string[];
    roomOrder?: string[]; // room names, "" = no room
    deviceOrder?: string[]; // device ids
    icon?: string; // bar/panel icon style, see ICON_STYLES
};

export const ICON_STYLES = ["bulb", "house-outline", "house", "plug", "matter"];

export type Config = {
    lights: Record<string, { name?: string; room?: string }>;
    scenes: Record<string, Scene>;
    ui: UiPrefs;
};

const xdg = (envName: string, fallback: string) => process.env[envName] || join(homedir(), fallback);

export const CONFIG_PATH = process.env.OMATTER_CONFIG || join(xdg("XDG_CONFIG_HOME", ".config"), "omatter", "config.json");
export const DATA_DIR = process.env.OMATTER_DATA || join(xdg("XDG_DATA_HOME", ".local/share"), "omatter");
export const SOCKET_PATH =
    process.env.OMATTER_SOCKET || join(process.env.XDG_RUNTIME_DIR || `/tmp/omatter-${process.getuid?.()}`, "omatter.sock");

export const DEFAULT_SCENES: Record<string, Scene> = {
    bright: { "*": { on: true, brightness: 100, kelvin: 4000 } },
    relax: { "*": { on: true, brightness: 45, kelvin: 2700 } },
    movie: { "*": { on: true, brightness: 12, color: "#3a2bff" } },
    night: { "*": { on: true, brightness: 4, kelvin: 2200 } },
    off: { "*": { on: false } },
};

export function loadConfig(): Config {
    try {
        const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
        return { lights: raw.lights ?? {}, scenes: raw.scenes ?? {}, ui: raw.ui ?? {} };
    } catch (e: any) {
        if (e?.code !== "ENOENT") throw new Error(`Cannot read ${CONFIG_PATH}: ${e.message}`);
        const fresh: Config = { lights: {}, scenes: structuredClone(DEFAULT_SCENES), ui: {} };
        saveConfig(fresh);
        return fresh;
    }
}

export function saveConfig(config: Config) {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    const tmp = `${CONFIG_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
    renameSync(tmp, CONFIG_PATH);
}

export function updateConfig(fn: (config: Config) => void) {
    const config = loadConfig();
    fn(config);
    saveConfig(config);
}
