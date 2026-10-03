// Matter controller: owns this PC's fabric, commissions lights shared from
// Apple Home (multi-admin), keeps subscriptions alive and runs commands.

import { mkdirSync } from "node:fs";
import { Environment, Logger, LogLevel } from "@matter/main";
import { BridgedDeviceBasicInformationClient } from "@matter/main/behaviors/bridged-device-basic-information";
import { BooleanStateClient } from "@matter/main/behaviors/boolean-state";
import { ColorControlClient } from "@matter/main/behaviors/color-control";
import { DescriptorClient } from "@matter/main/behaviors/descriptor";
import { IlluminanceMeasurementClient } from "@matter/main/behaviors/illuminance-measurement";
import { LevelControlClient } from "@matter/main/behaviors/level-control";
import { OccupancySensingClient } from "@matter/main/behaviors/occupancy-sensing";
import { OnOffClient } from "@matter/main/behaviors/on-off";
import { PowerSourceClient } from "@matter/main/behaviors/power-source";
import { RelativeHumidityMeasurementClient } from "@matter/main/behaviors/relative-humidity-measurement";
import { TemperatureMeasurementClient } from "@matter/main/behaviors/temperature-measurement";
import { WiFiNetworkDiagnosticsClient } from "@matter/main/behaviors/wi-fi-network-diagnostics";
import { GeneralCommissioning } from "@matter/main/clusters";
import { ManualPairingCodeCodec, NodeId, QrPairingCodeCodec } from "@matter/main/types";
import { CommissioningController } from "@project-chip/matter.js";
import { NodeStates } from "@project-chip/matter.js/device";
import type { Endpoint, PairedNode } from "@project-chip/matter.js/device";
import {
    hsvToRgb,
    kelvinToMireds,
    levelToPercent,
    matterHueSat,
    matterXy,
    miredsToKelvin,
    parseHex,
    percentToLevel,
    rgbToHsv,
    rgbToXy,
    toHex,
    xyToRgb,
} from "./color.ts";
import { DATA_DIR, loadConfig } from "./config.ts";

export type DeviceKind = "light" | "plug" | "switch";

export type Light = {
    id: string; // "<nodeId>:<endpoint>"
    kind: DeviceKind;
    nodeId: string;
    endpoint: number;
    name: string;
    room: string | null;
    product: string;
    reachable: boolean;
    on: boolean;
    brightness: number | null; // 0-100, null when not dimmable
    mode: "color" | "ct" | null;
    color: string | null; // #hex at full brightness
    kelvin: number | null;
    caps: { dim: boolean; color: boolean; ct: boolean; ctMin: number; ctMax: number };
};

export type Sensor = {
    id: string;
    nodeId: string;
    endpoint: number;
    name: string;
    room: string | null;
    product: string;
    reachable: boolean;
    readings: {
        temperature?: number; // °C
        humidity?: number; // %
        occupied?: boolean;
        illuminance?: number; // lux
        contact?: boolean; // true = closed
    };
    battery: number | null; // %
};

export type DeviceDetails = {
    id: string;
    nodeId: string;
    endpoint: number;
    vendor: string;
    product: string;
    firmware: string;
    hardware: string;
    serial: string | null;
    state: "connected" | "reconnecting" | "waiting" | "disconnected";
    lastSeenMs: number | null; // ms ago
    addresses: string[];
    rssi: number | null; // dBm
    battery: number | null; // %
    subscriptionIntervalSec: number | null;
};

/** A requested change; any subset may be set. */
export type LightChange = {
    on?: boolean;
    brightness?: number; // 0-100, 0 turns off
    hex?: string;
    kelvin?: number;
};

const TRANSITION = 4; // tenths of a second
const EXECUTE_IF_OFF = { optionsMask: { executeIfOff: true }, optionsOverride: { executeIfOff: true } };

// Matter device type ids.
const PLUG_TYPES = new Set([0x010a, 0x010b]); // On/Off and Dimmable Plug-in Unit
const SWITCH_TYPES = new Set([0x010f, 0x0110]); // Mounted On/Off and Dimmable Load Control

const SENSOR_CLIENTS = [
    TemperatureMeasurementClient,
    RelativeHumidityMeasurementClient,
    OccupancySensingClient,
    IlluminanceMeasurementClient,
    BooleanStateClient,
];

function deviceTypes(ep: Endpoint): number[] {
    const descriptor = ep.maybeStateOf(DescriptorClient) as any;
    return (descriptor?.deviceTypeList ?? []).map((d: any) => Number(d.deviceType));
}

function deviceKind(ep: Endpoint): DeviceKind {
    const types = deviceTypes(ep);
    if (types.some(t => PLUG_TYPES.has(t))) return "plug";
    if (types.some(t => SWITCH_TYPES.has(t))) return "switch";
    return "light";
}

const COLOR_MODE_HS = 0;
const COLOR_MODE_XY = 1;
const COLOR_MODE_CT = 2;

function explainPairingError(e: any): string {
    const raw = String(e?.message ?? e);
    if (/discover|no device|not found|timed? ?out|timeout/i.test(raw)) {
        return "Couldn't find the light on the network. Check that pairing mode is still on (it expires after a few minutes) and that this PC is on the same Wi-Fi.";
    }
    if (/pase|passcode|spake|verifier/i.test(raw)) {
        return "The light rejected the code. Double-check it, or turn pairing mode off and on again in Apple Home to get a fresh one.";
    }
    return `Pairing failed: ${raw}`;
}

export class LightManager {
    #controller!: CommissioningController;
    #nodes = new Map<string, PairedNode>();
    #onChange: () => void;
    #changeTimer: NodeJS.Timeout | undefined;
    #lastSeen = new Map<string, number>();

    constructor(onChange: () => void) {
        this.#onChange = onChange;
    }

    async start() {
        mkdirSync(DATA_DIR, { recursive: true });
        Logger.level = process.env.OMATTER_LOG_LEVEL ?? LogLevel.NOTICE;

        const environment = Environment.default;
        environment.vars.set("storage.path", DATA_DIR);

        this.#controller = new CommissioningController({
            environment: { environment, id: "omatter" },
            autoConnect: false,
            adminFabricLabel: "Omatter",
            autoSubscribe: true,
            subscribeMinIntervalFloorSeconds: 0,
            subscribeMaxIntervalCeilingSeconds: 60,
        });
        await this.#controller.start();

        for (const nodeId of this.#controller.getCommissionedNodes()) {
            await this.#attach(nodeId);
        }
    }

    async stop() {
        await this.#controller?.close();
    }

    #changed() {
        clearTimeout(this.#changeTimer);
        this.#changeTimer = setTimeout(this.#onChange, 80);
    }

    async #attach(nodeId: NodeId) {
        const key = String(nodeId);
        if (this.#nodes.has(key)) return this.#nodes.get(key)!;

        const node = await this.#controller.getNode(nodeId);
        const seen = () => {
            this.#lastSeen.set(key, Date.now());
        };
        node.events.attributeChanged.on(() => {
            seen();
            this.#changed();
        });
        node.events.connectionAlive.on(seen);
        node.events.stateChanged.on(state => {
            if (state === NodeStates.Connected) seen();
            this.#changed();
        });
        node.events.structureChanged.on(() => this.#changed());
        node.events.initialized.on(() => this.#changed());
        node.events.decommissioned.on(() => {
            this.#nodes.delete(key);
            this.#changed();
        });
        this.#nodes.set(key, node);
        if (!node.isConnected) node.connect();
        return node;
    }

    /** Every non-root endpoint, recursing into bridges. */
    #endpoints(node: PairedNode): Endpoint[] {
        const found: Endpoint[] = [];
        const walk = (endpoints: Endpoint[]) => {
            for (const ep of endpoints) {
                found.push(ep);
                walk(ep.getChildEndpoints());
            }
        };
        if (node.initialized) walk(node.getDevices());
        return found;
    }

    /** Endpoints that expose an OnOff server: lights, plugs and switches. */
    #lightEndpoints(node: PairedNode): Endpoint[] {
        return this.#endpoints(node).filter(ep => ep.maybeStateOf(OnOffClient) !== undefined);
    }

    /** Endpoints with a measurement/sensing server and no OnOff (pure sensors). */
    #sensorEndpoints(node: PairedNode): Endpoint[] {
        return this.#endpoints(node).filter(
            ep => ep.maybeStateOf(OnOffClient) === undefined && SENSOR_CLIENTS.some(c => ep.maybeStateOf(c) !== undefined),
        );
    }

    #info(node: PairedNode): Record<string, any> {
        try {
            return node.basicInformation ?? {};
        } catch {
            return {}; // Not initialised yet.
        }
    }

    /** Battery % from the endpoint's own PowerSource, else any PowerSource on the node. */
    #battery(node: PairedNode, ep?: Endpoint): number | null {
        const candidates = [ep, node.getRootEndpoint(), ...this.#endpoints(node)].filter(Boolean) as Endpoint[];
        for (const candidate of candidates) {
            const ps = candidate.maybeStateOf(PowerSourceClient) as any;
            if (typeof ps?.batPercentRemaining === "number") return Math.round(ps.batPercentRemaining / 2);
        }
        return null;
    }

    sensors(): Sensor[] {
        const config = loadConfig();
        const result: Sensor[] = [];
        for (const [nodeKey, node] of this.#nodes) {
            const endpoints = this.#sensorEndpoints(node);
            const info = this.#info(node);
            for (const ep of endpoints) {
                const endpoint = Number(ep.getNumber());
                const id = `${nodeKey}:${endpoint}`;
                const bridged = ep.maybeStateOf(BridgedDeviceBasicInformationClient) as any;
                let defaultName = bridged?.nodeLabel || info.nodeLabel || info.productName || `Sensor ${nodeKey}`;
                if (!bridged && endpoints.length > 1) defaultName += ` ${endpoint}`;

                const readings: Sensor["readings"] = {};
                const temp = ep.maybeStateOf(TemperatureMeasurementClient) as any;
                if (typeof temp?.measuredValue === "number") readings.temperature = temp.measuredValue / 100;
                const hum = ep.maybeStateOf(RelativeHumidityMeasurementClient) as any;
                if (typeof hum?.measuredValue === "number") readings.humidity = Math.round(hum.measuredValue / 100);
                const occ = ep.maybeStateOf(OccupancySensingClient) as any;
                if (occ?.occupancy) readings.occupied = !!occ.occupancy.occupied;
                const lux = ep.maybeStateOf(IlluminanceMeasurementClient) as any;
                if (typeof lux?.measuredValue === "number" && lux.measuredValue > 0) {
                    readings.illuminance = Math.round(10 ** ((lux.measuredValue - 1) / 10000));
                }
                const contact = ep.maybeStateOf(BooleanStateClient) as any;
                if (typeof contact?.stateValue === "boolean") readings.contact = contact.stateValue;

                result.push({
                    id,
                    nodeId: nodeKey,
                    endpoint,
                    name: config.lights[id]?.name ?? defaultName,
                    room: config.lights[id]?.room ?? null,
                    product: bridged?.productName || info.productName || "Matter sensor",
                    reachable: node.connectionState === NodeStates.Connected,
                    readings,
                    battery: this.#battery(node, ep),
                });
            }
        }
        return result.sort((a, b) => (a.room ?? "~").localeCompare(b.room ?? "~") || a.name.localeCompare(b.name));
    }

    details(id: string): DeviceDetails {
        const [nodeKey, epStr] = id.split(":");
        const node = this.#nodes.get(nodeKey);
        if (!node) throw new Error(`Unknown device ${id}`);
        const ep = this.#endpoints(node).find(e => Number(e.getNumber()) === Number(epStr));
        const info = this.#info(node);
        const bridged = ep?.maybeStateOf(BridgedDeviceBasicInformationClient) as any;
        const wifi = node.getRootEndpoint()?.maybeStateOf(WiFiNetworkDiagnosticsClient) as any;
        const addresses = ((node as any).state?.commissioning?.addresses ?? [])
            .filter((a: any) => a.ip)
            .map((a: any) => a.ip as string);
        const lastSeen = this.#lastSeen.get(nodeKey);
        const states: Record<number, DeviceDetails["state"]> = {
            [NodeStates.Connected]: "connected",
            [NodeStates.Reconnecting]: "reconnecting",
            [NodeStates.WaitingForDeviceDiscovery]: "waiting",
            [NodeStates.Disconnected]: "disconnected",
        };
        return {
            id,
            nodeId: nodeKey,
            endpoint: Number(epStr),
            vendor: bridged?.vendorName || info.vendorName || "Unknown",
            product: bridged?.productName || info.productName || "Unknown",
            firmware: bridged?.softwareVersionString || info.softwareVersionString || "Unknown",
            hardware: bridged?.hardwareVersionString || info.hardwareVersionString || "Unknown",
            serial: bridged?.serialNumber || info.serialNumber || null,
            state: states[node.connectionState] ?? "disconnected",
            lastSeenMs: lastSeen ? Date.now() - lastSeen : null,
            addresses: [...new Set<string>(addresses)],
            rssi: typeof wifi?.rssi === "number" ? wifi.rssi : null,
            battery: this.#battery(node, ep),
            subscriptionIntervalSec: node.currentSubscriptionIntervalSeconds ?? null,
        };
    }

    reconnect(id: string) {
        const node = this.#nodes.get(id.split(":")[0]);
        if (!node) throw new Error(`Unknown device ${id}`);
        node.triggerReconnect();
        this.#changed();
    }

    lights(): Light[] {
        const config = loadConfig();
        const result: Light[] = [];

        for (const [nodeKey, node] of this.#nodes) {
            const endpoints = this.#lightEndpoints(node);
            const reachable = node.connectionState === NodeStates.Connected;
            const info = this.#info(node);

            for (const ep of endpoints) {
                const endpoint = Number(ep.getNumber());
                const id = `${nodeKey}:${endpoint}`;
                const bridged = ep.maybeStateOf(BridgedDeviceBasicInformationClient) as any;
                const product = bridged?.productName || info.productName || "Matter device";
                let defaultName = bridged?.nodeLabel || info.nodeLabel || info.productName || `Device ${nodeKey}`;
                if (!bridged && endpoints.length > 1) defaultName += ` ${endpoint}`;

                const onOff = ep.maybeStateOf(OnOffClient) as any;
                const level = ep.maybeStateOf(LevelControlClient) as any;
                const cc = ep.maybeStateOf(ColorControlClient) as any;
                const capsBits = cc?.colorCapabilities ?? {};

                const kind = deviceKind(ep);
                const light: Light = {
                    id,
                    kind,
                    nodeId: nodeKey,
                    endpoint,
                    name: config.lights[id]?.name ?? defaultName,
                    room: config.lights[id]?.room ?? null,
                    product,
                    reachable,
                    on: !!onOff?.onOff,
                    brightness: level ? levelToPercent(level.currentLevel ?? 0) : null,
                    mode: null,
                    color: null,
                    kelvin: null,
                    caps: {
                        dim: !!level,
                        color: !!(capsBits.hueSaturation || capsBits.xy),
                        ct: !!capsBits.colorTemperature,
                        ctMin: miredsToKelvin(cc?.colorTempPhysicalMaxMireds ?? 0) || 2000,
                        ctMax: miredsToKelvin(cc?.colorTempPhysicalMinMireds ?? 0) || 6500,
                    },
                };

                if (cc) {
                    if (cc.colorMode === COLOR_MODE_CT && cc.colorTemperatureMireds) {
                        light.mode = "ct";
                        light.kelvin = miredsToKelvin(cc.colorTemperatureMireds);
                    } else if (cc.colorMode === COLOR_MODE_XY && cc.currentX !== undefined) {
                        light.mode = "color";
                        light.color = toHex(xyToRgb(cc.currentX / 65536, cc.currentY / 65536));
                    } else if (cc.colorMode === COLOR_MODE_HS && cc.currentHue !== undefined) {
                        light.mode = "color";
                        light.color = toHex(hsvToRgb((cc.currentHue / 254) * 360, cc.currentSaturation / 254, 1));
                    }
                }
                result.push(light);
            }
        }
        return result.sort((a, b) => (a.room ?? "~").localeCompare(b.room ?? "~") || a.name.localeCompare(b.name));
    }

    #endpoint(id: string): Endpoint {
        const [nodeKey, epStr] = id.split(":");
        const node = this.#nodes.get(nodeKey);
        if (!node) throw new Error(`Unknown light ${id}`);
        const ep = this.#lightEndpoints(node).find(e => Number(e.getNumber()) === Number(epStr));
        if (!ep) throw new Error(`Light ${id} is not available yet`);
        return ep;
    }

    async apply(id: string, change: LightChange) {
        const ep = this.#endpoint(id);
        const cc = ep.maybeStateOf(ColorControlClient) as any;
        const capsBits = cc?.colorCapabilities ?? {};

        if (change.kelvin !== undefined && cc && capsBits.colorTemperature) {
            let mireds = kelvinToMireds(change.kelvin);
            if (cc.colorTempPhysicalMinMireds) mireds = Math.max(cc.colorTempPhysicalMinMireds, mireds);
            if (cc.colorTempPhysicalMaxMireds) mireds = Math.min(cc.colorTempPhysicalMaxMireds, mireds);
            await (ep.commandsOf(ColorControlClient) as any).moveToColorTemperature({
                colorTemperatureMireds: mireds,
                transitionTime: TRANSITION,
                ...EXECUTE_IF_OFF,
            });
        } else if (change.hex !== undefined && cc && (capsBits.xy || capsBits.hueSaturation)) {
            const rgb = parseHex(change.hex);
            const commands = ep.commandsOf(ColorControlClient) as any;
            if (capsBits.xy) {
                const { x, y } = rgbToXy(rgb);
                await commands.moveToColor({ ...matterXy(x, y), transitionTime: TRANSITION, ...EXECUTE_IF_OFF });
            } else {
                const { h, s } = rgbToHsv(rgb);
                await commands.moveToHueAndSaturation({
                    ...matterHueSat(h, s),
                    transitionTime: TRANSITION,
                    ...EXECUTE_IF_OFF,
                });
            }
        }

        const dimmable = ep.maybeStateOf(LevelControlClient) !== undefined;
        if (change.brightness !== undefined && change.on !== false) {
            if (change.brightness <= 0) {
                await ep.commandsOf(OnOffClient).off();
            } else if (dimmable) {
                await (ep.commandsOf(LevelControlClient) as any).moveToLevelWithOnOff({
                    level: percentToLevel(change.brightness),
                    transitionTime: TRANSITION,
                    optionsMask: {},
                    optionsOverride: {},
                });
            } else {
                await ep.commandsOf(OnOffClient).on();
            }
        } else if (change.on === true) {
            // Re-sending On to a lit bulb makes some restart their fade, which
            // shows as a stutter right after a colour change.
            if (!ep.maybeStateOf(OnOffClient)?.onOff) await ep.commandsOf(OnOffClient).on();
        } else if (change.on === false) {
            await ep.commandsOf(OnOffClient).off();
        }
        this.#changed();
    }

    /** Commission a device shared from another ecosystem (e.g. Apple Home "Turn On Pairing Mode"). */
    async pair(code: string): Promise<string[]> {
        const trimmed = code.trim();
        let passcode: number;
        let identifierData: { shortDiscriminator: number } | { longDiscriminator: number };
        try {
            if (trimmed.toUpperCase().startsWith("MT:")) {
                const qr = QrPairingCodeCodec.decode(trimmed)[0];
                passcode = qr.passcode;
                identifierData = { longDiscriminator: qr.discriminator };
            } else {
                const manual = ManualPairingCodeCodec.decode(trimmed.replace(/\D/g, ""));
                passcode = manual.passcode;
                if (manual.shortDiscriminator === undefined) throw new Error("Pairing code has no discriminator");
                identifierData = { shortDiscriminator: manual.shortDiscriminator };
            }
        } catch {
            throw new Error("That doesn't look like a valid setup code. Use the 11-digit code from Apple Home.");
        }

        let nodeId: NodeId;
        try {
            nodeId = await this.#controller.commissionNode({
                commissioning: {
                    regulatoryLocation: GeneralCommissioning.RegulatoryLocationType.IndoorOutdoor,
                    regulatoryCountryCode: "XX",
                },
                discovery: { identifierData, discoveryCapabilities: { onIpNetwork: true } },
                passcode,
            });
        } catch (e: any) {
            throw new Error(explainPairingError(e));
        }

        const node = await this.#attach(nodeId);
        if (!node.initialized) await node.events.initialized;
        this.#changed();
        return [...this.#lightEndpoints(node), ...this.#sensorEndpoints(node)].map(
            ep => `${nodeId}:${Number(ep.getNumber())}`,
        );
    }

    /** Removes this PC's fabric from the device. Other controllers (Apple Home) keep it. */
    async forget(nodeKey: string) {
        const node = this.#nodes.get(nodeKey);
        if (!node) throw new Error(`Unknown node ${nodeKey}`);
        try {
            await node.decommission();
        } catch {
            await this.#controller.removeNode(NodeId(BigInt(nodeKey)), false);
        }
        this.#nodes.delete(nodeKey);
        this.#changed();
    }
}
