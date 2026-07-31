/**
 * The 512x512 store tile, rendered from the game's own art.
 *
 * It calls `drawPanel` and `drawGlassCell` — the exact functions the live board
 * uses — so the tile physically cannot show glass the game does not draw. The
 * only thing it adds is composition: a tighter crop and a wordmark, because a
 * tile is read at 80px in a grid, not at 512.
 *
 * Development-only: reached solely by `scripts/thumbnail.html`, which is never
 * part of the production build.
 */
import { drawBackdrop } from "../game/art/backdrop.ts";
import { context2d, createCanvas, drawFrame, drawGlassCell, drawPanel } from "../game/art/glass.ts";
import { colourPoolCanvas } from "../game/art/light.ts";
import { css, palette, shade } from "../game/art/palette.ts";
import { GAME_NAME } from "../game/constants.ts";

const SIZE = 512;

/**
 * A cut mid-drag over a partly-filled panel. The tile shows the actual verb of
 * the game — a piece about to land — rather than a still life of a full board.
 */
const TILE_BOARD: readonly number[] = [
    "20300250",
    "40220053",
    "44225614",
    "34115563",
    "33166562",
    "23164423",
    "25514226",
    "05340615",
]
    .join("")
    .split("")
    .map(Number);

export function renderThumbnail(): string {
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = context2d(canvas);
    const active = palette("atelier");

    // The bench, at the tile's own crop: panel large and slightly left, so the
    // wordmark has somewhere to sit that is not on top of the glass.
    drawBackdrop(ctx, {
        width: SIZE,
        height: SIZE,
        paletteId: "atelier",
        showPanel: false,
        vignette: 0.45,
    });

    // The hero panel, filling most of the tile — and the stain it throws onto
    // the bench, the same signature the live scene derives from the board.
    const panelSize = SIZE * 0.72;
    const panelX = (SIZE - panelSize) / 2;
    const panelY = SIZE * 0.1;
    const frame = panelSize * 0.062;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.5;
    const poolSize = panelSize * 1.5;
    ctx.drawImage(
        colourPoolCanvas(TILE_BOARD, active),
        panelX + panelSize / 2 - poolSize / 2,
        panelY + panelSize / 2 - poolSize / 2,
        poolSize,
        poolSize,
    );
    ctx.restore();
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(panelX - frame + 8, panelY - frame + 12, panelSize + frame * 2, panelSize + frame * 2);
    ctx.restore();
    drawFrame(ctx, panelX - frame, panelY - frame, panelSize + frame * 2, panelSize + frame * 2, frame, active);
    drawPanel(ctx, panelX, panelY, panelSize, TILE_BOARD, active);

    // The cut in the air, lifted and shadowed so it reads as being carried.
    const cell = panelSize / 8;
    const carried: ReadonlyArray<readonly [number, number]> = [
        [0, 0],
        [1, 0],
        [1, 1],
    ];
    const carryX = panelX + cell * 4.4;
    const carryY = panelY + cell * 0.55;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = cell * 0.7;
    ctx.shadowOffsetY = cell * 0.5;
    // Slightly oversized: a carried cut is nearer the eye than the panel.
    const lift = cell * 1.1;
    for (const [dx, dy] of carried) {
        // Full-bleed and seamless, like the tray in game: the cut is one pour
        // of glass, and the drop shadow is what lifts it.
        drawGlassCell(ctx, carryX + dx * lift, carryY + dy * lift, lift, active.glass[0] ?? 0xffffff, 0);
    }
    ctx.restore();

    // Wordmark over a soft fade rather than a hard caption bar — a solid band
    // across the bottom is what a stock-photo tile looks like.
    const fade = ctx.createLinearGradient(0, SIZE * 0.7, 0, SIZE);
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(1, css(shade(active.bench, -0.86), 0.96));
    ctx.fillStyle = fade;
    ctx.fillRect(0, SIZE * 0.7, SIZE, SIZE * 0.3);

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = '400 62px "Iowan Old Style", Palatino, Georgia, serif';
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillText(GAME_NAME, SIZE / 2 + 3, SIZE - 42 + 3);
    ctx.fillStyle = "#ffe9c0";
    ctx.fillText(GAME_NAME, SIZE / 2, SIZE - 42);
    ctx.font = '600 18px ui-rounded, "SF Pro Rounded", "Avenir Next", system-ui, sans-serif';
    ctx.fillStyle = "#a99e94";
    ctx.fillText("BLOCK PUZZLE IN GLASS", SIZE / 2, SIZE - 18);
    ctx.restore();

    return canvas.toDataURL("image/jpeg", 0.92);
}
