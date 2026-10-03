// User-defined ordering of rooms and devices. Anything not yet placed falls
// back to alphabetical order after the placed items; devices without a room
// come last unless "" has been placed explicitly.

export type Orderable = { id: string; name: string; room?: string | null };
export type OrderPrefs = { roomOrder?: string[]; deviceOrder?: string[] };

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function rankRoom(room: string, roomOrder: string[]): [number, number, string] {
    const i = roomOrder.indexOf(room);
    if (i >= 0) return [0, i, ""];
    return [room === "" ? 2 : 1, 0, room];
}

function compareRooms(a: string, b: string, roomOrder: string[]): number {
    const [ga, ia, na] = rankRoom(a, roomOrder);
    const [gb, ib, nb] = rankRoom(b, roomOrder);
    return ga - gb || ia - ib || collator.compare(na, nb);
}

/** Room keys ("" = no room) in display order. */
export function roomList(devices: Orderable[], prefs: OrderPrefs = {}): string[] {
    const rooms = [...new Set(devices.map(d => d.room ?? ""))];
    return rooms.sort((a, b) => compareRooms(a, b, prefs.roomOrder ?? []));
}

/** Devices grouped by room order, then by the user's device order, then by name. */
export function sortDevices<T extends Orderable>(devices: T[], prefs: OrderPrefs = {}): T[] {
    const roomOrder = prefs.roomOrder ?? [];
    const deviceOrder = prefs.deviceOrder ?? [];
    const rank = (d: T) => {
        const i = deviceOrder.indexOf(d.id);
        return i >= 0 ? i : Number.MAX_SAFE_INTEGER;
    };
    return [...devices].sort(
        (a, b) =>
            compareRooms(a.room ?? "", b.room ?? "", roomOrder) || rank(a) - rank(b) || collator.compare(a.name, b.name),
    );
}
