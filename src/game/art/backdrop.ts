/**
 * The menu backdrop, composed from the game's own glass.
 *
 * The template ships PNG menu art to set a quality bar and explicitly forbids
 * regressing to anonymous CSS gradients. LEADLIGHT keeps the bar and drops the
 * PNGs: the backdrop is drawn at boot by the same `drawPanel` the live board
 * uses, so the menu is literally a photograph of the game's own bench, at any
 * resolution, in whichever palette the player has selected.
 */
import { context2d, createCanvas, drawBenchGrain, drawFrame, drawPanel } from "./glass.ts";
import { colourPoolCanvas } from "./light.ts";
import { css, type PaletteId, palette, shade } from "./palette.ts";

/**
 * A rose window: symmetric, and readable at the thumbnail sizes the menu
 * crops to. Values are `1 + colourIndex`, `0` is empty.
 */
/**
 * Rows of `1 + colourIndex`, `0` for empty. Written as strings so the shape
 * stays legible — a flat number array is reflowed by the formatter into an
 * unreadable block, and this motif is meant to be edited by eye.
 */
export const ROSE_MOTIF: readonly number[] = [
    "00122100",
    "03455430",
    "14611641",
    "25133152",
    "25133152",
    "14611641",
    "03455430",
    "00122100",
]
    .join("")
    .split("")
    .map(Number);

export interface BackdropOptions {
    width: number;
    height: number;
    paletteId: PaletteId;
    /** Fraction of the short edge the panel occupies. */
    panelScale?: number;
    /** Where the panel's centre sits, as fractions of width/height. */
    centreX?: number;
    centreY?: number;
    /** Radians. A hair off-square reads as a panel resting on a bench. */
    tilt?: number;
    /**
     * Draw the rose panel. The store tile composes its own hero panel, so it
     * asks for the bench and the light without this one.
     */
    showPanel?: boolean;
    /**
     * How hard the vignette bites, 0..1. The menu wants a deep one so UI has
     * somewhere dark to sit; the store tile wants a light one so the glass is
     * still luminous at 80px in a grid.
     */
    vignette?: number;
}

export function drawBackdrop(ctx: CanvasRenderingContext2D, options: BackdropOptions): void {
    const { width, height } = options;
    const active = palette(options.paletteId);
    const short = Math.min(width, height);

    // 1. Bench: the grain drawn once at full size. Tiling a square texture
    //    seams visibly, and the seam is what the eye finds first.
    drawBenchGrain(ctx, width, height, active);

    // 2. Studio light: a warm pool from above, falling off into the corners.
    const bite = Math.max(0, Math.min(1, options.vignette ?? 1));
    const light = ctx.createRadialGradient(
        width * 0.5,
        height * 0.2,
        short * 0.05,
        width * 0.5,
        height * 0.34,
        short * 1.05,
    );
    light.addColorStop(0, "rgba(255,241,214,0.32)");
    light.addColorStop(0.45, "rgba(255,224,180,0.08)");
    light.addColorStop(1, `rgba(10,6,4,${0.55 * bite})`);
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, width, height);

    // 3. The panel itself, tilted, with its oak frame.
    const panelSize = short * (options.panelScale ?? 0.66);
    const frameThickness = panelSize * 0.075;
    if (options.showPanel !== false) {
        const centreX = width * (options.centreX ?? 0.5);
        const centreY = height * (options.centreY ?? 0.44);

        // The stain the rose throws onto the bench around it — the signature
        // of leaded glass, and what ties the menu to the live bench, where the
        // same pool is derived from the player's own board.
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.5;
        const poolSize = panelSize * 1.85;
        ctx.translate(centreX, centreY);
        ctx.rotate(options.tilt ?? -0.045);
        ctx.drawImage(colourPoolCanvas(ROSE_MOTIF, active), -poolSize / 2, -poolSize / 2, poolSize, poolSize);
        ctx.restore();

        ctx.save();
        ctx.translate(centreX, centreY);
        ctx.rotate(options.tilt ?? -0.045);

        // Cast shadow, so the panel sits ON the bench rather than floating over it.
        ctx.save();
        ctx.translate(panelSize * 0.03, panelSize * 0.05);
        ctx.filter = "blur(0px)";
        ctx.fillStyle = "rgba(0,0,0,0.42)";
        ctx.fillRect(
            -panelSize / 2 - frameThickness,
            -panelSize / 2 - frameThickness,
            panelSize + frameThickness * 2,
            panelSize + frameThickness * 2,
        );
        ctx.restore();

        drawFrame(
            ctx,
            -panelSize / 2 - frameThickness,
            -panelSize / 2 - frameThickness,
            panelSize + frameThickness * 2,
            panelSize + frameThickness * 2,
            frameThickness,
            active,
        );
        drawPanel(ctx, -panelSize / 2, -panelSize / 2, panelSize, ROSE_MOTIF, active);
        ctx.restore();
    }

    // 4. Compositing, in the order the light actually happens.
    const centreY = options.centreY ?? 0.44;

    // Bloom around the panel — centred on where the panel actually IS, not on a
    // fixed fraction of the frame.
    const bloom = ctx.createRadialGradient(
        width * (options.centreX ?? 0.5),
        height * centreY,
        0,
        width * (options.centreX ?? 0.5),
        height * centreY,
        panelSize * 0.9,
    );
    bloom.addColorStop(0, "rgba(255,246,222,0.18)");
    bloom.addColorStop(1, "rgba(255,246,222,0)");
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, width, height);

    // A flat scrim over the whole composition. The backdrop is atmosphere: once
    // the glass got its real saturation the rose window started competing with
    // the menu for the same pixels, and a scrim keeps the art rich while putting
    // it firmly behind the UI.
    ctx.fillStyle = `rgba(10,7,5,${0.46 * bite})`;
    ctx.fillRect(0, 0, width, height);

    // A low pool of warmth, AFTER the scrim — before it, the scrim eats it and
    // the bottom of the frame is a black void behind the button stack.
    const floor = ctx.createRadialGradient(
        width * 0.5,
        height * 1.04,
        0,
        width * 0.5,
        height * 1.04,
        Math.max(width, height) * 0.9,
    );
    floor.addColorStop(0, "rgba(255,222,172,0.26)");
    floor.addColorStop(0.5, "rgba(255,214,160,0.07)");
    floor.addColorStop(1, "rgba(255,214,160,0)");
    ctx.fillStyle = floor;
    ctx.fillRect(0, 0, width, height);

    // Top and bottom fall away so UI always has somewhere dark to sit. The
    // bottom stop is deliberately gentler than the top: the button stack lives
    // there and it should read as lit bench, not as the edge of the world.
    const vignette = ctx.createLinearGradient(0, 0, 0, height);
    vignette.addColorStop(0, css(shade(active.bench, -0.72), 0.5 * bite));
    vignette.addColorStop(0.36, "rgba(0,0,0,0)");
    vignette.addColorStop(1, css(shade(active.bench, -0.78), 0.28 * bite));
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
}

export function backdropDataUrl(options: BackdropOptions): string {
    const canvas = createCanvas(options.width, options.height);
    drawBackdrop(context2d(canvas), options);
    return canvas.toDataURL("image/jpeg", 0.86);
}
