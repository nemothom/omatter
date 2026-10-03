// Newline-delimited JSON over a Unix socket.
//   request:  {"id": 1, "cmd": "set", "args": {...}}
//   response: {"id": 1, "ok": true, "result": ...} | {"id": 1, "ok": false, "error": "..."}
//   push:     {"event": "state", "lights": [...], "scenes": [...]}   (after "subscribe")

import { connect, type Socket } from "node:net";
import { SOCKET_PATH } from "./config.ts";

export type Request = { id: number; cmd: string; args?: Record<string, any> };
export type Response = { id: number; ok: boolean; result?: any; error?: string };

export function onLines(socket: Socket, handler: (msg: any) => void) {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            try {
                handler(JSON.parse(line));
            } catch {
                // Ignore malformed lines.
            }
        }
    });
}

export const send = (socket: Socket, msg: unknown) => socket.write(JSON.stringify(msg) + "\n");

export function connectDaemon(): Promise<Socket> {
    return new Promise((resolve, reject) => {
        const socket = connect(SOCKET_PATH);
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
    });
}

/** One-shot request. */
export async function request(cmd: string, args: Record<string, any> = {}, timeoutMs = 15_000): Promise<any> {
    const socket = await connectDaemon();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error(`Timed out waiting for omatterd (${cmd})`));
        }, timeoutMs);
        onLines(socket, (msg: Response) => {
            if (msg.id !== 1) return;
            clearTimeout(timer);
            socket.end();
            msg.ok ? resolve(msg.result) : reject(new Error(msg.error));
        });
        send(socket, { id: 1, cmd, args });
    });
}
