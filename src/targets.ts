// Resolves a user-supplied target ("all", a light name, a room, an id, or a
// comma-separated list of those) to a set of device ids. "all" covers lights
// only; plugs and switches must be named or targeted by room.

export type TargetLight = { id: string; name: string; room?: string | null; kind?: string };

const norm = (s: string) => s.trim().toLowerCase();

export function resolveTargets(target: string, lights: TargetLight[]): string[] {
    const parts = target.split(",").map(norm).filter(Boolean);
    if (parts.length === 0) throw new Error("No target given");

    const ids = new Set<string>();
    for (const part of parts) {
        if (part === "all" || part === "*") {
            // "all" means lights: plugs and switches may power things that must stay on.
            lights.filter(l => !l.kind || l.kind === "light").forEach(l => ids.add(l.id));
            continue;
        }
        const exact = lights.filter(l => norm(l.id) === part || norm(l.name) === part);
        if (exact.length) {
            exact.forEach(l => ids.add(l.id));
            continue;
        }
        const room = lights.filter(l => l.room && norm(l.room) === part);
        if (room.length) {
            room.forEach(l => ids.add(l.id));
            continue;
        }
        const prefix = lights.filter(l => norm(l.name).startsWith(part));
        if (prefix.length === 1) {
            ids.add(prefix[0].id);
            continue;
        }
        if (prefix.length > 1) {
            throw new Error(`"${part}" is ambiguous: ${prefix.map(l => l.name).join(", ")}`);
        }
        throw new Error(`No light or room called "${part}"`);
    }
    return [...ids];
}
