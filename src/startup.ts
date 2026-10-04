// Startup guards for omatterd: recover from a hard power-off and from being
// started before Wi‑Fi is up.

import { readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const LOCK_FILE = "matter.lock";
const PID_FILE = "matter.pid";

/** True when `pid` is a running omatterd (a node process running daemon.ts). */
export function isOmatterd(pid: number): boolean {
    try {
        const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
        return /daemon\.ts|omatterd/.test(cmdline);
    } catch {
        return false; // No such process.
    }
}

/**
 * Removes matter.js storage locks left behind when omatterd didn't shut down
 * cleanly (power cut, crash, SIGKILL). matter.js only checks that the lock's PID
 * is alive, and after a reboot that PID often belongs to an unrelated program,
 * which would block startup for good. A lock is kept only while its PID is a
 * running omatterd. Callers must first make sure no other omatterd is serving.
 *
 * Returns the storage directories whose lock was removed.
 */
export function clearStaleLocks(dataDir: string, isOwnerAlive: (pid: number) => boolean = isOmatterd): string[] {
    const cleared: string[] = [];
    let dirs: string[];
    try {
        dirs = [dataDir, ...readdirSync(dataDir).map(name => join(dataDir, name))];
    } catch {
        return cleared; // No storage yet.
    }
    for (const dir of dirs) {
        const lockPath = join(dir, LOCK_FILE);
        const pidPath = join(dir, PID_FILE);
        try {
            if (!statSync(dir).isDirectory()) continue;
            statSync(lockPath);
        } catch {
            continue; // No lock here.
        }
        let pid = NaN;
        try {
            pid = parseInt(readFileSync(pidPath, "utf8").trim().split(/\s+/)[0], 10);
        } catch {}
        if (Number.isFinite(pid) && pid > 0 && pid !== process.pid && isOwnerAlive(pid)) continue;
        for (const path of [lockPath, pidPath]) {
            try {
                unlinkSync(path);
            } catch {}
        }
        cleared.push(dir);
    }
    return cleared;
}

// Virtual interfaces exist without any real connection (Docker, VPNs, bridges).
const VIRTUAL_IFACE = /^(lo|docker|br-|veth|virbr|vnet|tun|tap|tailscale|wg|zt)/;

/** True once a real (non-virtual, non-loopback) interface has an address. */
export function hasNetwork(interfaces = networkInterfaces()): boolean {
    return Object.entries(interfaces).some(
        ([name, addrs]) => !VIRTUAL_IFACE.test(name) && (addrs ?? []).some(a => !a.internal),
    );
}

/**
 * Waits for a network interface, so mDNS can join its multicast group (it fails
 * with ENODEV when started before Wi‑Fi). Gives up after `timeoutMs` and lets
 * matter.js retry on its own.
 */
export async function waitForNetwork(timeoutMs = 60_000, log: (msg: string) => void = console.log): Promise<boolean> {
    if (hasNetwork()) return true;
    log("Waiting for a network connection…");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await sleep(1000);
        if (hasNetwork()) {
            await sleep(2000); // Let addresses (incl. IPv6 link-local) settle.
            log("Network is up");
            return true;
        }
    }
    log(`No network after ${Math.round(timeoutMs / 1000)}s; starting anyway`);
    return false;
}
