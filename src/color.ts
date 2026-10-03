// Colour conversions between what people type (hex, names, Kelvin) and what
// Matter ColorControl speaks (CIE xy in 1/65536 units, hue/sat in 0-254, mireds).

export type Rgb = { r: number; g: number; b: number }; // 0-255

export const NAMED_COLORS: Record<string, string> = {
    red: "#ff0000",
    orange: "#ff7a00",
    amber: "#ffb000",
    yellow: "#ffe600",
    lime: "#a0ff00",
    green: "#00ff3c",
    teal: "#00ffb4",
    cyan: "#00e5ff",
    sky: "#3fa9ff",
    blue: "#1e3cff",
    indigo: "#4b1eff",
    purple: "#8c1eff",
    violet: "#b400ff",
    magenta: "#ff00d4",
    pink: "#ff4fa0",
    rose: "#ff1e5a",
};

// Names that mean a white temperature rather than an RGB colour.
export const NAMED_TEMPERATURES: Record<string, number> = {
    candle: 2000,
    warm: 2700,
    soft: 3000,
    neutral: 4000,
    white: 4000,
    cool: 5000,
    daylight: 6500,
};

export function parseHex(input: string): Rgb {
    let hex = input.trim().replace(/^#/, "");
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`Invalid colour "${input}" (use #rrggbb or a colour name)`);
    return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
    };
}

export function toHex({ r, g, b }: Rgb): string {
    const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
}

/** Resolves a user colour string to either an RGB hex or a Kelvin temperature. */
export function resolveColor(input: string): { hex: string } | { kelvin: number } {
    const key = input.trim().toLowerCase();
    if (key in NAMED_TEMPERATURES) return { kelvin: NAMED_TEMPERATURES[key] };
    if (key in NAMED_COLORS) return { hex: NAMED_COLORS[key] };
    return { hex: toHex(parseHex(input)) };
}

const gammaExpand = (c: number) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92);
const gammaCompress = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB → CIE 1931 xy (wide-gamut D65 matrix, as used by most Matter/Zigbee bulbs). */
export function rgbToXy({ r, g, b }: Rgb): { x: number; y: number } {
    const [R, G, B] = [r, g, b].map(v => gammaExpand(v / 255));
    const X = R * 0.664511 + G * 0.154324 + B * 0.162028;
    const Y = R * 0.283881 + G * 0.668433 + B * 0.047685;
    const Z = R * 0.000088 + G * 0.07231 + B * 0.986039;
    const sum = X + Y + Z;
    if (sum === 0) return { x: 0.3127, y: 0.329 }; // black → D65 white point
    return { x: X / sum, y: Y / sum };
}

/** CIE xy → sRGB at full brightness (brightness is LevelControl's job). */
export function xyToRgb(x: number, y: number): Rgb {
    if (y <= 0) return { r: 255, g: 255, b: 255 };
    const Y = 1;
    const X = (Y / y) * x;
    const Z = (Y / y) * (1 - x - y);
    let R = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
    let G = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
    let B = X * 0.051713 - Y * 0.121364 + Z * 1.01153;
    [R, G, B] = [R, G, B].map(v => Math.max(0, v));
    const max = Math.max(R, G, B, 1e-9);
    [R, G, B] = [R, G, B].map(v => gammaCompress(v / max));
    return { r: R * 255, g: G * 255, b: B * 255 };
}

export function rgbToHsv({ r, g, b }: Rgb): { h: number; s: number; v: number } {
    const [R, G, B] = [r / 255, g / 255, b / 255];
    const max = Math.max(R, G, B);
    const min = Math.min(R, G, B);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === R) h = ((G - B) / d) % 6;
        else if (max === G) h = (B - R) / d + 2;
        else h = (R - G) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): Rgb {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    const [r, g, b] =
        h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

// Matter wire-format helpers.

export const matterXy = (x: number, y: number) => ({
    colorX: Math.max(0, Math.min(0xfeff, Math.round(x * 65536))),
    colorY: Math.max(0, Math.min(0xfeff, Math.round(y * 65536))),
});

export const matterHueSat = (h: number, s: number) => ({
    hue: Math.max(0, Math.min(254, Math.round((h / 360) * 254))),
    saturation: Math.max(0, Math.min(254, Math.round(s * 254))),
});

export const kelvinToMireds = (k: number) => Math.round(1_000_000 / k);
export const miredsToKelvin = (m: number) => (m > 0 ? Math.round(1_000_000 / m) : 0);

/** LevelControl 1-254 ↔ percent 0-100. */
export const levelToPercent = (level: number) => Math.round((Math.max(0, Math.min(254, level)) / 254) * 100);
export const percentToLevel = (pct: number) => Math.max(1, Math.min(254, Math.round((pct / 100) * 254)));
