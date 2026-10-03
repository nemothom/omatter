// Scenes are stored client-side as per-light target states and applied in
// parallel. Keys may be "*", a room, a light name or a light id; later keys
// override earlier ones, so `{"*": {...}, "Desk lamp": {...}}` works.

import { resolveColor } from "./color.ts";
import type { Scene, SceneState } from "./config.ts";
import type { Light, LightChange } from "./matter.ts";
import { resolveTargets } from "./targets.ts";

export function sceneStateToChange(state: SceneState): LightChange {
    const change: LightChange = {};
    if (state.on !== undefined) change.on = state.on;
    if (state.brightness !== undefined) change.brightness = state.brightness;
    if (state.kelvin !== undefined) change.kelvin = state.kelvin;
    if (state.color !== undefined) Object.assign(change, resolveColor(state.color));
    return change;
}

export function expandScene(scene: Scene, lights: Light[]): Map<string, LightChange> {
    const plan = new Map<string, LightChange>();
    for (const [key, state] of Object.entries(scene)) {
        let ids: string[];
        try {
            ids = resolveTargets(key === "*" ? "all" : key, lights);
        } catch {
            continue; // A light named in the scene is gone; skip it.
        }
        const change = sceneStateToChange(state);
        for (const id of ids) {
            const merged = { ...plan.get(id), ...change };
            // A specific colour replaces an inherited temperature and vice versa.
            if (change.hex !== undefined) delete merged.kelvin;
            if (change.kelvin !== undefined) delete merged.hex;
            plan.set(id, merged);
        }
    }
    return plan;
}

export function snapshotScene(lights: Light[]): Scene {
    const scene: Scene = {};
    for (const light of lights) {
        if (!light.reachable) continue;
        const state: SceneState = { on: light.on };
        if (light.on) {
            if (light.brightness !== null) state.brightness = light.brightness;
            if (light.mode === "ct" && light.kelvin) state.kelvin = light.kelvin;
            if (light.mode === "color" && light.color) state.color = light.color;
        }
        scene[light.id] = state;
    }
    return scene;
}
