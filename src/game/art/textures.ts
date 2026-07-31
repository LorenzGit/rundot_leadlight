/**
 * Pixi textures, generated from the Canvas2D art in `glass.ts`.
 *
 * One cache per palette. Everything is drawn once at a fixed resolution and
 * scaled by the stage, which is why the numbers below are generous: a cell is
 * about 87 device pixels on a 2x phone, so 128 leaves headroom for a tablet
 * without paying for a texture nobody sees.
 *
 * The cache owns its textures and must be destroyed with the scene — a leaked
 * atlas survives a route change and quietly doubles on the next mount.
 */
import { Texture } from "pixi.js";
import { benchGrainCanvas, GLASS_VARIANTS, glassCellCanvas, shardCanvas, wellCanvas } from "./glass.ts";
import { type GlassPalette, type PaletteId, palette } from "./palette.ts";

const CELL_PIXELS = 128;
const SHARD_PIXELS = 48;
/**
 * The bench is one fitted texture, not a tile, so it is generated at the
 * viewport's aspect and capped: past this the extra pixels buy nothing but
 * memory on a soft, low-contrast surface.
 */
const BENCH_MAX_PIXELS = 640;

export interface GlassTextures {
    readonly palette: GlassPalette;
    /** Glass cell for a colour index and jitter variant. `seamless` drops the
        bevel: tray and carried cuts read as one pour, panel cells keep it. */
    cell(colourIndex: number, variant: number, seamless?: boolean): Texture;
    well(): Texture;
    shard(colourIndex: number, variant: number): Texture;
    /** A whole bench at the given aspect. Regenerated only when it changes. */
    bench(width: number, height: number): Texture;
    destroy(): void;
}

export function createGlassTextures(paletteId: PaletteId): GlassTextures {
    const active = palette(paletteId);
    const cache = new Map<string, Texture>();

    const remember = (key: string, create: () => HTMLCanvasElement): Texture => {
        const existing = cache.get(key);
        if (existing) return existing;
        const texture = Texture.from(create());
        cache.set(key, texture);
        return texture;
    };

    const colourAt = (index: number): number => {
        const colours = active.glass;
        return colours[((index % colours.length) + colours.length) % colours.length] ?? 0xffffff;
    };

    return {
        palette: active,
        // `seamless` is vestigial: a tile is now drawn the same whether it is
        // on the board, in a pocket or under the finger. Kept on the interface
        // so the call sites still read as intent, ignored here.
        cell(colourIndex, variant) {
            const bucket = ((variant % GLASS_VARIANTS) + GLASS_VARIANTS) % GLASS_VARIANTS;
            return remember(`cell:${colourIndex}:${bucket}`, () =>
                glassCellCanvas(CELL_PIXELS, colourAt(colourIndex), bucket),
            );
        },
        well() {
            return remember("well", () => wellCanvas(CELL_PIXELS, active));
        },
        shard(colourIndex, variant) {
            const bucket = ((variant % 4) + 4) % 4;
            return remember(`shard:${colourIndex}:${bucket}`, () =>
                shardCanvas(SHARD_PIXELS, colourAt(colourIndex), bucket),
            );
        },
        bench(width, height) {
            // Snap to a coarse bucket: a resize that moves by a few pixels must
            // not throw away a 640x1138 texture and redraw it.
            const aspect = Math.max(0.2, Math.min(5, height / Math.max(1, width)));
            const bucket = Math.round(aspect * 8) / 8;
            const benchWidth = aspect >= 1 ? BENCH_MAX_PIXELS : Math.round(BENCH_MAX_PIXELS / bucket);
            const benchHeight = aspect >= 1 ? Math.round(BENCH_MAX_PIXELS * bucket) : BENCH_MAX_PIXELS;
            return remember(`bench:${bucket}`, () => benchGrainCanvas(benchWidth, benchHeight, active));
        },
        destroy() {
            for (const texture of cache.values()) texture.destroy(true);
            cache.clear();
        },
    };
}
