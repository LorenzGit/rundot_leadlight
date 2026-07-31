/**
 * The glass palettes — DESIGN.md §5.3 and §8.
 *
 * Six colours per palette, because the bag tints each cut with one of them.
 * Palettes are purely cosmetic: nothing here reaches the rules.
 *
 * The value structure matters more than the hues. Every palette is built as
 * mid-value stage < lighter surround << bright saturated glass, so the glass is
 * still the brightest thing on screen and the eye goes straight to the board.
 *
 * The stage is MID-VALUE and saturated, not near-black. A black stage with a
 * few small tiles on it reads as an empty screen no matter how clean the rest
 * is; this genre lights its stage so the tiles sit on something. What the
 * stage must never be is a rendered MATERIAL — no wood grain, no oiled
 * highlights. Value and hue do the work, and the tiles stay the brightest,
 * most saturated thing in the frame.
 *
 * Colour maths lives here too, so `glass.ts` can talk about "the facet" and
 * "the bevel" rather than about RGB.
 */

export type PaletteId = "atelier" | "verdant" | "nocturne" | "aurora" | "cathedral" | "ember";

export interface GlassPalette {
    id: PaletteId;
    name: string;
    /** One line of flavour, shown on the Atelier card. */
    blurb: string;
    /** Exactly six glass colours. */
    glass: readonly number[];
    /** The lead came between cells. */
    came: number;
    /** The pewter highlight that catches light along the top of the came. */
    cameLight: number;
    /** The stage this palette is cut on. Mid-value and lit: see below. */
    bench: number;
    /** The panel's mount and the tray plank. Above the stage, never a material. */
    frame: number;
    /** Colour of an empty cell — absent glass, not a hole. */
    empty: number;
}

export const PALETTES: readonly GlassPalette[] = [
    {
        id: "atelier",
        name: "ATELIER",
        blurb: "The house glass. Amber, cobalt and viridian, cut on plain oak.",
        glass: [0xffb02e, 0x3d7bff, 0x21d18d, 0xff4f87, 0xa95cff, 0xff6a3d],
        came: 0x2f2438,
        cameLight: 0x9a8fb0,
        bench: 0x3b2a46,
        frame: 0x513a5e,
        empty: 0x2c1f36,
    },
    {
        id: "verdant",
        name: "VERDANT",
        blurb: "Bottle greens and moss, the colour of a glasshouse in July.",
        glass: [0x9bd83c, 0x1fc9a0, 0x2f9e5c, 0xd6e34a, 0x35e8b4, 0x77b93a],
        came: 0x233a2c,
        cameLight: 0x8fb094,
        bench: 0x24402f,
        frame: 0x33583f,
        empty: 0x1b3123,
    },
    {
        id: "nocturne",
        name: "NOCTURNE",
        blurb: "Indigo and silver. Night glass, cut by lamplight.",
        glass: [0x4f63e8, 0x7f92b5, 0x3a55ff, 0xc2d2e8, 0x8f6dff, 0x4d84b5],
        came: 0x27305a,
        cameLight: 0x8f9cd0,
        bench: 0x2a3260,
        frame: 0x3c477f,
        empty: 0x1f2648,
    },
    {
        id: "aurora",
        name: "AURORA",
        blurb: "Cold pinks and mint, the light off a northern sky.",
        glass: [0xff6fb5, 0x4dffd0, 0xb98cff, 0x4fd8ff, 0xffa06b, 0xd0f556],
        came: 0x2e2a5c,
        cameLight: 0xa79fe0,
        bench: 0x352d63,
        frame: 0x483d85,
        empty: 0x27214a,
    },
    {
        id: "cathedral",
        name: "CATHEDRAL",
        blurb: "Liturgical reds and leaf gold. Heavy glass, heavy lead.",
        glass: [0xe03a34, 0xf5bb3a, 0xb02a52, 0xff7333, 0xffd35e, 0xc4372c],
        came: 0x3a241c,
        cameLight: 0xb08a5e,
        bench: 0x4a2a1e,
        frame: 0x63382a,
        empty: 0x371e16,
    },
    {
        id: "ember",
        name: "EMBER",
        blurb: "Furnace orange over cold iron. Cut straight off the kiln.",
        glass: [0xff7526, 0x8f7a6d, 0xefb84f, 0x5c504a, 0xf03a1e, 0xc4b09c],
        came: 0x36241d,
        cameLight: 0xb08874,
        bench: 0x422a20,
        frame: 0x59392b,
        empty: 0x30201a,
    },
];

const BY_ID = new Map(PALETTES.map((entry) => [entry.id, entry]));

export const DEFAULT_PALETTE: PaletteId = "atelier";

export function isPaletteId(value: unknown): value is PaletteId {
    return typeof value === "string" && BY_ID.has(value as PaletteId);
}

export function palette(id: PaletteId | string): GlassPalette {
    return BY_ID.get(id as PaletteId) ?? (BY_ID.get(DEFAULT_PALETTE) as GlassPalette);
}

/** Every palette holds six colours; the bag relies on this being stable. */
export const PALETTE_COLOURS = 6;

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------

export interface Rgb {
    r: number;
    g: number;
    b: number;
}

export function toRgb(hex: number): Rgb {
    return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}

export function fromRgb({ r, g, b }: Rgb): number {
    const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
    return (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
}

/** CSS colour string, optionally with alpha. Canvas2D wants strings. */
export function css(hex: number, alpha = 1): string {
    const { r, g, b } = toRgb(hex);
    return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

/** Positive lightens toward white, negative darkens toward black. */
export function shade(hex: number, amount: number): number {
    const { r, g, b } = toRgb(hex);
    const target = amount >= 0 ? 255 : 0;
    const t = Math.min(1, Math.abs(amount));
    return fromRgb({ r: r + (target - r) * t, g: g + (target - g) * t, b: b + (target - b) * t });
}

/**
 * Raise value without touching hue or saturation ratio.
 *
 * `shade(c, +x)` mixes toward WHITE, which is right for a highlight on an
 * opaque surface and wrong for glass: it desaturates, and pastel glass reads as
 * plastic. Scaling the channels and clamping keeps amber amber all the way up
 * to its clipping point.
 */
export function boost(hex: number, factor: number): number {
    const { r, g, b } = toRgb(hex);
    return fromRgb({ r: r * factor, g: g * factor, b: b * factor });
}

export function mix(a: number, b: number, t: number): number {
    const from = toRgb(a);
    const to = toRgb(b);
    const k = Math.max(0, Math.min(1, t));
    return fromRgb({
        r: from.r + (to.r - from.r) * k,
        g: from.g + (to.g - from.g) * k,
        b: from.b + (to.b - from.b) * k,
    });
}

/**
 * Rotate hue by `degrees` and scale lightness. Used for the per-cell jitter in
 * §8: a placed four-cell bar must not read as four identical stamps.
 */
export function jitter(hex: number, degrees: number, lightness: number): number {
    const { r, g, b } = toRgb(hex);
    const [h, s, l] = rgbToHsl(r, g, b);
    return hslToHex((h + degrees / 360 + 1) % 1, s, Math.max(0, Math.min(1, l * (1 + lightness))));
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h: number;
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    return [h / 6, s, l];
}

function hslToHex(h: number, s: number, l: number): number {
    if (s === 0) return fromRgb({ r: l * 255, g: l * 255, b: l * 255 });
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channel = (t: number): number => {
        let v = t;
        if (v < 0) v += 1;
        if (v > 1) v -= 1;
        if (v < 1 / 6) return p + (q - p) * 6 * v;
        if (v < 1 / 2) return q;
        if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6;
        return p;
    };
    return fromRgb({ r: channel(h + 1 / 3) * 255, g: channel(h) * 255, b: channel(h - 1 / 3) * 255 });
}
