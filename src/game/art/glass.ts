/**
 * Every piece of glass art in LEADLIGHT, as Canvas2D drawing functions.
 *
 * This is the single generator (DESIGN.md §8). The Pixi textures in
 * `textures.ts`, the palette swatches on the Atelier screen, and the 512x512
 * store tile all call the functions below, so the tile physically cannot show
 * glass the game does not draw.
 *
 * Every function draws into a caller-supplied context at a caller-supplied
 * rect. Nothing here allocates a canvas except the explicit `*Canvas` helpers
 * at the bottom, and nothing here knows about Pixi.
 */
import { boost, css, type GlassPalette, jitter, mix, shade } from "./palette.ts";

/** How many jitter variants each glass colour is drawn in. */
export const GLASS_VARIANTS = 4;

/**
 * Per-cell hue and lightness jitter. Deterministic and tiny: enough that a
 * four-cell bar stops reading as four identical stamps, not enough to look
 * like four different colours.
 */
const VARIANTS: ReadonlyArray<{ hue: number; light: number }> = [
    { hue: -6, light: 0.05 },
    { hue: 5, light: -0.045 },
    { hue: -2, light: -0.07 },
    { hue: 7, light: 0.025 },
];

export function variantColour(base: number, variant: number): number {
    const entry = VARIANTS[((variant % GLASS_VARIANTS) + GLASS_VARIANTS) % GLASS_VARIANTS];
    return entry ? jitter(base, entry.hue, entry.light) : base;
}

/** Stable variant for a board cell, so re-rendering never reshuffles the panel. */
export function variantForCell(index: number): number {
    return (index * 7 + ((index / 8) | 0) * 3) % GLASS_VARIANTS;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

// ---------------------------------------------------------------------------
// One cell of glass
// ---------------------------------------------------------------------------

/**
 * A single tile of glass.
 *
 * Premium casual is not flat — it is meticulously DIMENSIONAL. Every tile is
 * an object with real thickness lit from one direction: a bright top face, a
 * darker extruded edge along the bottom, one soft specular, and a hairline of
 * lead to seat it. That thickness is the whole reason a tile reads as
 * expensive rather than as a coloured rectangle, and it is what the flat pass
 * before this one threw away along with the muddy bevels it was right to cut.
 *
 * Tiles stay DISTINCT inside a multi-cell cut rather than melting into one
 * pour. Every game in this genre does it that way, it lets you count the cells
 * of a piece at a glance, and a pour cannot carry an extrusion.
 *
 * @param variant 0..3 — the jitter bucket, or -1 for the unjittered colour.
 */
export function drawGlassCell(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    baseColour: number,
    variant = -1,
): void {
    const base = variant < 0 ? baseColour : variantColour(baseColour, variant);
    // No gap. Cells of a cut must TOUCH: any inset at all leaves a channel of
    // background between them and the piece reads as loose squares rather than
    // as one block. The corner radius is small for the same reason — at a big
    // radius, two neighbours meeting leaves a lens of background at the join,
    // which is the same gap by another name.
    const inner = size;
    const left = x;
    const top = y;
    const radius = inner * 0.12;
    /** The extruded side wall. Enough to read as an object at phone scale. */
    const depth = Math.max(2, inner * 0.11);
    const bucket = ((variant % GLASS_VARIANTS) + GLASS_VARIANTS) % GLASS_VARIANTS;

    ctx.save();

    // 1. The side wall, drawn first and covered by the face — so only the
    //    bottom sliver of it survives, which is exactly the extrusion.
    roundRect(ctx, left, top + depth, inner, inner - depth, radius);
    ctx.fillStyle = css(shade(base, -0.42));
    ctx.fill();

    // 2. The top face.
    const faceHeight = inner - depth;
    const face = ctx.createLinearGradient(left, top, left, top + faceHeight);
    face.addColorStop(0, css(boost(base, 1.22)));
    face.addColorStop(1, css(base));
    roundRect(ctx, left, top, inner, faceHeight, radius);
    ctx.fillStyle = face;
    ctx.fill();

    ctx.save();
    ctx.clip();

    // 3. One specular, top-left, from the single light every tile shares.
    ctx.beginPath();
    ctx.ellipse(left + inner * 0.3, top + faceHeight * 0.26, inner * 0.26, faceHeight * 0.2, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fill();

    // A pinpoint glint, placed by variant so a run of tiles is not one stamp.
    const glints: ReadonlyArray<readonly [number, number]> = [
        [0.68, 0.24],
        [0.74, 0.32],
        [0.62, 0.2],
        [0.78, 0.26],
    ];
    const glint = glints[bucket] ?? glints[0];
    if (glint) {
        ctx.beginPath();
        ctx.arc(left + inner * glint[0], top + faceHeight * glint[1], Math.max(1, inner * 0.05), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.42)";
        ctx.fill();
    }

    // The face turns down into the wall: a soft contact along its lower edge.
    const seat = ctx.createLinearGradient(left, top + faceHeight * 0.6, left, top + faceHeight);
    seat.addColorStop(0, "rgba(0,0,0,0)");
    seat.addColorStop(1, "rgba(0,0,0,0.16)");
    ctx.fillStyle = seat;
    ctx.fillRect(left, top, inner, faceHeight);
    ctx.restore();

    ctx.restore();
}

/**
 * The lattice between cells.
 *
 * The lit-and-shaded round-section came and the solder blobs at the joins were
 * describing a physical material at a scale where none of it resolved; what it
 * actually produced was a busy grid competing with the glass. It is now a
 * single flat line at low contrast — enough to read the 8x8 structure, quiet
 * enough that a placed run of glass is the only thing the eye lands on.
 */
export function drawCameLattice(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    palette: GlassPalette,
    columns = 8,
): void {
    // Every cell — full or empty — now draws its own rounded tile with its own
    // gap, so the grid is legible without a lattice on top of it. All this
    // needs to be is the tray the tiles sit in.
    ctx.save();
    roundRect(ctx, x, y, size, size, (size / columns) * 0.24);
    ctx.fillStyle = css(shade(palette.bench, -0.12));
    ctx.fill();
    ctx.restore();
}

/**
 * An empty cell: absent glass, not a hole.
 *
 * The gradient body, the inner shadow along two edges and the came stroke were
 * three passes drawing a recess. One flat fill, edge to edge, says the same
 * thing — and it has to be edge to edge: inset and rounded, it drew a second
 * outline inside every lattice square and the board read as a spreadsheet.
 */
export function drawWell(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    palette: GlassPalette,
): void {
    const gap = size * 0.025;
    const inner = size - gap * 2;
    if (inner <= 0) return;
    const left = x + gap;
    const top = y + gap;
    const radius = inner * 0.17;

    ctx.save();
    roundRect(ctx, left, top, inner, inner, radius);
    ctx.fillStyle = css(shade(palette.empty, 0.08));
    ctx.fill();
    // The recess is sold by one soft inner shadow at the top: the same light the
    // tiles are lit by, read in negative. Any harder and it is a black hole.
    ctx.save();
    ctx.clip();
    const sink = ctx.createLinearGradient(left, top, left, top + inner);
    sink.addColorStop(0, "rgba(0,0,0,0.16)");
    sink.addColorStop(0.5, "rgba(0,0,0,0)");
    ctx.fillStyle = sink;
    ctx.fillRect(left, top, inner, inner);
    ctx.restore();
    ctx.restore();
}

/** A falling fragment of fired glass. Four irregular silhouettes. */
export function drawShard(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    colour: number,
    variant: number,
): void {
    const shapes: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
        [
            [0.5, 0],
            [1, 0.42],
            [0.62, 1],
            [0.08, 0.6],
        ],
        [
            [0.18, 0.04],
            [0.94, 0.26],
            [0.72, 0.92],
            [0, 0.68],
        ],
        [
            [0.46, 0.02],
            [0.98, 0.58],
            [0.3, 0.98],
        ],
        [
            [0.06, 0.2],
            [0.86, 0],
            [1, 0.74],
            [0.34, 1],
        ],
    ];
    const shape = shapes[((variant % shapes.length) + shapes.length) % shapes.length] ?? shapes[0];
    if (!shape) return;

    ctx.save();
    ctx.beginPath();
    shape.forEach(([px, py], index) => {
        const cx = x + px * size;
        const cy = y + py * size;
        if (index === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
    });
    ctx.closePath();
    // `boost`, not `shade`: mixing a shard toward white turns flying glass into
    // flying gravel. Same bug the cells had.
    const fill = ctx.createLinearGradient(x, y, x + size, y + size);
    fill.addColorStop(0, css(boost(colour, 1.75)));
    fill.addColorStop(0.55, css(boost(colour, 1.15)));
    fill.addColorStop(1, css(shade(colour, -0.18)));
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.72)";
    ctx.lineWidth = Math.max(1, size * 0.09);
    ctx.stroke();
    ctx.restore();
}

// ---------------------------------------------------------------------------
// The bench
// ---------------------------------------------------------------------------

/**
 * Oak grain, drawn to fit a rect rather than tiled.
 *
 * Tiling a square grain texture was the first attempt and it seamed visibly
 * across the bench: any lighting or plank feature that meets the tile edge
 * produces a hard line every N pixels, and no amount of wrapping the features
 * hides the discontinuity in the strokes themselves. Drawing the whole bench
 * once costs one texture and has no seams by construction.
 *
 * Deliberately seedless — the grain is a fixed function of the rect, so it
 * renders identically in the game, in a screenshot, and in the store tile.
 */
/**
 * The stage the panel sits on.
 *
 * This used to be rendered oak: sine-wave grain, plank seams with lit lips,
 * and three elliptical knots. It was the loudest thing on screen after the
 * glass and it is exactly the vocabulary that dates a game — a drawn material
 * standing in for art direction. The stage is now a near-black field with one
 * very large, very soft warm gradient in it, so it reads as depth and lighting
 * rather than as a surface, and the glass is the only thing with texture.
 */
export function drawBenchGrain(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    palette: GlassPalette,
): void {
    ctx.save();
    const wash = ctx.createLinearGradient(0, 0, width * 0.35, height);
    wash.addColorStop(0, css(shade(palette.bench, 0.16)));
    wash.addColorStop(0.55, css(palette.bench));
    wash.addColorStop(1, css(shade(palette.bench, -0.26)));
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, width, height);

    // One warm key, high and left, matching the light every tile is lit by.
    const unit = Math.max(width, height);
    const key = ctx.createRadialGradient(width * 0.32, height * 0.24, 0, width * 0.32, height * 0.24, unit * 0.75);
    key.addColorStop(0, "rgba(255,236,206,0.14)");
    key.addColorStop(0.5, "rgba(255,232,198,0.05)");
    key.addColorStop(1, "rgba(255,232,198,0)");
    ctx.fillStyle = key;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
}

/** A slot in the tray sill, relative to the shelf rect. */
export interface ShelfSlot {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Where the cuts wait.
 *
 * Formerly an oiled plank: gradient body, a sheen sweep, a rim light along the
 * top and a lit lower lip on every pocket. All of that is rendered material,
 * and rendered material is what makes a puzzle game look a decade old. What is
 * left is the only part that was doing real work — a surface a shade above the
 * stage, and three recesses a shade below it, so the cuts are held rather than
 * floating. Value does the whole job; there is no light source to believe.
 */
export function drawTrayShelf(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    slots: readonly ShelfSlot[],
    palette: GlassPalette,
): void {
    const radius = Math.min(width, height) * 0.11;
    const depth = Math.max(2, height * 0.018);
    ctx.save();

    // A raised surface: side wall under a lit face, same light as everything.
    roundRect(ctx, 0, depth, width, height - depth, radius);
    ctx.fillStyle = css(shade(palette.frame, -0.34));
    ctx.fill();
    const face = ctx.createLinearGradient(0, 0, 0, height - depth);
    face.addColorStop(0, css(shade(palette.frame, 0.16)));
    face.addColorStop(1, css(palette.frame));
    roundRect(ctx, 0, 0, width, height - depth, radius);
    ctx.fillStyle = face;
    ctx.fill();

    // Pockets: the same recess as an empty board cell, at a bigger radius.
    for (const slot of slots) {
        const pocketRadius = Math.min(slot.width, slot.height) * 0.16;
        roundRect(ctx, slot.x, slot.y, slot.width, slot.height, pocketRadius);
        ctx.fillStyle = css(shade(palette.bench, -0.14));
        ctx.fill();
        ctx.save();
        ctx.clip();
        const sink = ctx.createLinearGradient(0, slot.y, 0, slot.y + slot.height * 0.5);
        sink.addColorStop(0, "rgba(0,0,0,0.28)");
        sink.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = sink;
        ctx.fillRect(slot.x, slot.y, slot.width, slot.height);
        ctx.restore();
    }
    ctx.restore();
}

/**
 * The panel's surround.
 *
 * Was an oak frame: vertical gradient, a dark mitred rebate and a lit top
 * edge. Now it is one flat surface a shade above the stage, with a generous
 * radius — a mount, not a moulding. The board reads as the only object in the
 * composition instead of as a picture hung in furniture.
 */
export function drawFrame(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    thickness: number,
    palette: GlassPalette,
): void {
    ctx.save();
    roundRect(ctx, x, y, width, height, thickness * 1.1);
    ctx.fillStyle = css(palette.frame);
    ctx.fill();
    ctx.restore();
}

// ---------------------------------------------------------------------------
// Composite: a whole panel. Used by the store tile and the Atelier swatches.
// ---------------------------------------------------------------------------

/**
 * Draw an 8x8 panel of `cells` (0 = empty, otherwise `1 + colourIndex`) into
 * the given square. This is the composition the store tile is made of, and it
 * calls exactly the same cell functions the live board does.
 */
export function drawPanel(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    cells: ArrayLike<number>,
    palette: GlassPalette,
    columns = 8,
): void {
    const rows = Math.ceil(cells.length / columns);
    const cell = size / columns;

    // Grid FIRST, glass over it — the same order the live scene layers them in.
    // Drawn afterwards it slices every placed run into separate tiles, and the
    // store tile would then advertise a board the game does not render.
    drawCameLattice(ctx, x, y, size, palette, columns);

    for (let index = 0; index < columns * rows; index++) {
        const cx = x + (index % columns) * cell;
        const cy = y + Math.floor(index / columns) * cell;
        const value = cells[index] ?? 0;
        if (value === 0) {
            drawWell(ctx, cx, cy, cell, palette);
        } else {
            const colour = palette.glass[(value - 1) % palette.glass.length] ?? palette.glass[0] ?? 0xffffff;
            drawGlassCell(ctx, cx, cy, cell, colour, variantForCell(index));
        }
    }
}

// ---------------------------------------------------------------------------
// Canvas factories
// ---------------------------------------------------------------------------

export function createCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
}

export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas is unavailable");
    return ctx;
}

function render(size: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
    const canvas = createCanvas(size, size);
    draw(context2d(canvas));
    return canvas;
}

export function glassCellCanvas(size: number, colour: number, variant: number): HTMLCanvasElement {
    return render(size, (ctx) => drawGlassCell(ctx, 0, 0, size, colour, variant));
}

export function wellCanvas(size: number, palette: GlassPalette) {
    return render(size, (ctx) => drawWell(ctx, 0, 0, size, palette));
}

export function shardCanvas(size: number, colour: number, variant: number) {
    return render(size, (ctx) => drawShard(ctx, 0, 0, size, colour, variant));
}

export function benchGrainCanvas(width: number, height: number, palette: GlassPalette): HTMLCanvasElement {
    const canvas = createCanvas(width, height);
    drawBenchGrain(context2d(canvas), width, height, palette);
    return canvas;
}

export function trayShelfCanvas(
    width: number,
    height: number,
    slots: readonly ShelfSlot[],
    palette: GlassPalette,
): HTMLCanvasElement {
    const canvas = createCanvas(width, height);
    drawTrayShelf(context2d(canvas), width, height, slots, palette);
    return canvas;
}

/**
 * A palette swatch for the Atelier screen: a 4x2 scrap of every glass colour in
 * the palette, drawn with the real cell art rather than with CSS chips.
 */
export function paletteSwatchDataUrl(palette: GlassPalette, cell = 34): string {
    const columns = 3;
    const rows = 2;
    const canvas = createCanvas(cell * columns, cell * rows);
    const ctx = context2d(canvas);
    ctx.fillStyle = css(mix(palette.bench, 0x000000, 0.35));
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    palette.glass.slice(0, columns * rows).forEach((colour, index) => {
        drawGlassCell(
            ctx,
            (index % columns) * cell,
            Math.floor(index / columns) * cell,
            cell,
            colour,
            index % GLASS_VARIANTS,
        );
    });
    return canvas.toDataURL("image/png");
}
