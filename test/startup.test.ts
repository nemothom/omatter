import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { clearStaleLocks, hasNetwork, isOmatterd } from "../src/startup.ts";

function storage(pidLine: string | null) {
    const root = mkdtempSync(join(tmpdir(), "omatter-lock-"));
    const dir = join(root, "omatter");
    mkdirSync(dir);
    writeFileSync(join(dir, "matter.lock"), "");
    if (pidLine !== null) writeFileSync(join(dir, "matter.pid"), pidLine);
    return { root, dir };
}

test("lock held by a PID reused by another program is removed (the post-reboot case)", () => {
    const { root, dir } = storage("1242 101273876eacfa14");
    assert.deepEqual(clearStaleLocks(root, () => false), [dir]);
    assert.equal(existsSync(join(dir, "matter.lock")), false);
    assert.equal(existsSync(join(dir, "matter.pid")), false);
    rmSync(root, { recursive: true });
});

test("lock held by a running omatterd is kept", () => {
    const { root, dir } = storage("1242 abc");
    assert.deepEqual(clearStaleLocks(root, pid => pid === 1242), []);
    assert.equal(existsSync(join(dir, "matter.lock")), true);
    rmSync(root, { recursive: true });
});

test("lock without a PID file, or with our own PID, is stale", () => {
    const a = storage(null);
    assert.deepEqual(clearStaleLocks(a.root, () => true), [a.dir]);
    const b = storage(`${process.pid} old-token`);
    assert.deepEqual(clearStaleLocks(b.root, () => true), [b.dir]);
    rmSync(a.root, { recursive: true });
    rmSync(b.root, { recursive: true });
});

test("missing storage directory is fine", () => {
    assert.deepEqual(clearStaleLocks(join(tmpdir(), "omatter-does-not-exist")), []);
});

test("isOmatterd rejects other processes", () => {
    assert.equal(isOmatterd(process.pid), false); // node --test, not daemon.ts
    assert.equal(isOmatterd(999_999_999), false);
});

test("hasNetwork ignores loopback and virtual interfaces", () => {
    const addr = (internal: boolean) => ({ internal, address: "x", family: "IPv6" }) as any;
    assert.equal(hasNetwork({ lo: [addr(true)], docker0: [addr(false)], "br-1a2b": [addr(false)] }), false);
    assert.equal(hasNetwork({ lo: [addr(true)], wlo1: [addr(false)] }), true);
});
