/**
 * Light: the part of a stained-glass workshop that is not glass.
 *
 * The signature of real leaded glass is not the glass — it is the coloured
 * light it throws onto everything behind it. `colourPool` is that: a blurred
 * smear of whatever is currently in the panel, painted onto the bench under the
 * frame in additive blend. It costs one 64x64 canvas per board change and is
 * the single biggest reason the bench stops looking like a brown rectangle.
 *
 * Same rule as the rest of `art/`: Canvas2D in, no Pixi, one generator.
 */

import { context2d, createCanvas } from "./glass.ts";
import { boost, css, type GlassPalette } from "./palette.ts";

/** Resolution of the colour pool before it is stretched over the bench. */
const POOL_PIXELS = 64;

/**
 * Margin around the pool texture, in the same pixels.
 *
 * Each cell's glow is a radial gradient wider than the cell, so a cell on an
 * edge of the board falls off PAST the board. Without this margin that falloff
 * hit the edge of the canvas and stopped dead — and because the sprite is then
 * blown up to well over the panel's size, the flat cut showed as a hard
 * straight line of light beside the board.
 */
const POOL_PAD = 14;
const POOL_CANVAS = POOL_PIXELS + POOL_PAD * 2;

/** How much bigger the texture is than the board it represents. */
export const POOL_OVERSCAN = POOL_CANVAS / POOL_PIXELS;

/**
 * A soft warm beam, drawn corner-to-corner so it can be rotated into place.
 * Deliberately very low contrast: this is additive, and a beam you can see the
 * edges of reads as a triangle sitting on the screen rather than as light.
 */
export function lightShaftCanvas(width: number, height: number): HTMLCanvasElement {
    // Drawn horizontally and rotated into place by the scene.
    const canvas = createCanvas(width, height);
    const ctx = context2d(canvas);
    // Across the beam: bright core with a soft shoulder either side. A single
    // wide ramp reads as a gradient overlay; a core with shoulders reads as a
    // shaft of light with air around it.
    const across = ctx.createLinearGradient(0, 0, 0, height);
    across.addColorStop(0, "rgba(255,238,205,0)");
    across.addColorStop(0.34, "rgba(255,240,212,0.28)");
    across.addColorStop(0.47, "rgba(255,248,228,0.85)");
    across.addColorStop(0.53, "rgba(255,248,228,0.85)");
    across.addColorStop(0.66, "rgba(255,238,206,0.26)");
    across.addColorStop(1, "rgba(255,232,190,0)");
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, width, height);

    // Along the beam: it enters strong and thins out as it crosses the room.
    const along = ctx.createLinearGradient(0, 0, width, 0);
    along.addColorStop(0, "rgba(0,0,0,1)");
    along.addColorStop(0.16, "rgba(0,0,0,0)");
    along.addColorStop(0.55, "rgba(0,0,0,0.25)");
    along.addColorStop(1, "rgba(0,0,0,1)");
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = along;
    ctx.fillRect(0, 0, width, height);
    return canvas;
}

/** A dust mote: a soft round dot with no hard edge at any scale. */
export function moteCanvas(size: number): HTMLCanvasElement {
    const canvas = createCanvas(size, size);
    const ctx = context2d(canvas);
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, "rgba(255,246,224,0.95)");
    gradient.addColorStop(0.4, "rgba(255,240,206,0.4)");
    gradient.addColorStop(1, "rgba(255,236,198,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return canvas;
}

/** A soft circular bloom, used for the burst under a firing. */
export function bloomCanvas(size: number): HTMLCanvasElement {
    const canvas = createCanvas(size, size);
    const ctx = context2d(canvas);
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, "rgba(255,250,235,0.9)");
    gradient.addColorStop(0.25, "rgba(255,238,200,0.42)");
    gradient.addColorStop(0.6, "rgba(255,226,170,0.12)");
    gradient.addColorStop(1, "rgba(255,220,160,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return canvas;
}

/**
 * The bench's own lighting: a warm pool where the panel sits, falling away to
 * near-black at the edges.
 *
 * Generated as a texture rather than drawn as Graphics because an ellipse fill
 * has a hard edge — on a dark bench that edge reads as a bright band smeared
 * across the middle of the screen, which is worse than no lighting at all.
 */
export function benchLightCanvas(width: number, height: number, focusY: number): HTMLCanvasElement {
    const canvas = createCanvas(width, height);
    const ctx = context2d(canvas);
    const short = Math.min(width, height);

    const pool = ctx.createRadialGradient(
        width * 0.5,
        height * focusY,
        short * 0.05,
        width * 0.5,
        height * focusY,
        short * 1.15,
    );
    pool.addColorStop(0, "rgba(255,224,170,0.2)");
    pool.addColorStop(0.42, "rgba(255,210,150,0.05)");
    pool.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = pool;
    ctx.fillRect(0, 0, width, height);

    // Corners fall away, so the panel is the only place the eye settles.
    const vignette = ctx.createRadialGradient(
        width * 0.5,
        height * focusY,
        short * 0.3,
        width * 0.5,
        height * focusY,
        Math.hypot(width, height) * 0.72,
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(0.55, "rgba(0,0,0,0.24)");
    vignette.addColorStop(1, "rgba(0,0,0,0.66)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
    return canvas;
}

/**
 * The colour the panel is currently throwing, as a blurred smear.
 *
 * Each filled cell contributes one radial blob of its own glass colour, boosted
 * well past its on-screen value because this is composited additively at low
 * alpha. Empty cells contribute nothing, so an empty panel throws no light —
 * which is exactly right, and is what makes filling the board feel like it is
 * lighting the room.
 *
 * @param cells `0` for empty, otherwise `1 + colourIndex`, row-major.
 */
export function colourPoolCanvas(cells: ArrayLike<number>, palette: GlassPalette, columns = 8): HTMLCanvasElement {
    const canvas = createCanvas(POOL_CANVAS, POOL_CANVAS);
    const ctx = context2d(canvas);
    const rows = Math.max(1, Math.ceil(cells.length / columns));
    const cellW = POOL_PIXELS / columns;
    const cellH = POOL_PIXELS / rows;
    // Blobs overlap by design: the overlap is the blur, and it costs nothing.
    const radius = Math.max(cellW, cellH) * 1.15;

    ctx.globalCompositeOperation = "lighter";
    for (let index = 0; index < columns * rows; index++) {
        const value = cells[index] ?? 0;
        if (value === 0) continue;
        const colour = palette.glass[(value - 1) % palette.glass.length] ?? palette.glass[0] ?? 0xffffff;
        const cx = POOL_PAD + (index % columns) * cellW + cellW / 2;
        const cy = POOL_PAD + Math.floor(index / columns) * cellH + cellH / 2;
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, css(boost(colour, 1.5), 0.55));
        gradient.addColorStop(0.45, css(colour, 0.16));
        gradient.addColorStop(1, css(colour, 0));
        ctx.fillStyle = gradient;
        ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    }
    return canvas;
}
