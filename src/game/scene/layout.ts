/**
 * Where everything sits, in design units.
 *
 * Pure geometry: no Pixi, no state. The scene lays itself out from this, and
 * the QA harness asks it for real tray and board positions rather than guessing
 * from the viewport — a harness that guesses taps empty bench.
 */
import { BOARD_SIZE } from "../constants.ts";
import type { Piece } from "../puzzle/pieces.ts";

export interface Insets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Design-unit room reserved for the DOM HUD above and helper bar below. */
const HUD_RESERVE = 176;
const HELPER_RESERVE = 158;
const SIDE_MARGIN = 26;
/** A mount, not a moulding: just enough to separate the panel from the stage. */
const FRAME_THICKNESS = 14;
const PANEL_TO_TRAY_GAP = 30;
const TRAY_HEIGHT = 186;
const TRAY_GUTTER = 14;
const MIN_PANEL = 232;

/**
 * The plank the cuts rest in extends past the pockets on every side. These live
 * here, not in the scene that paints it, because in landscape the plank has to
 * fit BETWEEN the two DOM reserves — a scene that adds its own overhang after
 * the fact pushes the plank under the helper buttons, and the buttons then sit
 * on top of the woodwork.
 */
/**
 * Clearance between the plank and the DOM clusters either side of it.
 *
 * The reserves alone put the plank's edge EXACTLY where the DOM ends, which is
 * arithmetically correct and still looks wrong: with no gap at all the plank's
 * rounded corner tucks under a button's shadow and the two read as
 * overlapping. The reserves keep the DOM off the tray; this is what makes that
 * separation visible.
 */
export const RAIL_GAP = 18;

export const SHELF_PAD_X = 18;
export const SHELF_PAD_TOP = 14;
export const SHELF_PAD_BOTTOM = 18;

export interface TraySlotBox {
    index: number;
    x: number;
    y: number;
    width: number;
    height: number;
    centreX: number;
    centreY: number;
}

export interface ShelfBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SceneLayout {
    width: number;
    height: number;
    /** Outer bounds of the oak frame. */
    frameX: number;
    frameY: number;
    frameSize: number;
    frameThickness: number;
    /** The 8x8 lattice inside the frame. */
    panelX: number;
    panelY: number;
    panelSize: number;
    cellSize: number;
    tray: TraySlotBox[];
    /** The plank the pockets are cut into. Already includes its own overhang. */
    shelf: ShelfBox;
    /** Largest cell size a tray cut may use, so cuts read smaller than the board. */
    trayCellCap: number;
}

/**
 * The composition never uses more than this much of the design space.
 *
 * Once the scale is capped (see stage.ts MAX_UNIT_PX) a desktop window hands
 * the scene MORE design units than a phone does, not fewer. Left to spread
 * into them the board would be exactly as gigantic as before — so the layout
 * works inside a box of the designed size, centred, and the extra units are
 * stage around it. That stage is painted, which is the whole point: no bands.
 */
const MAX_BOX_SHORT = 720;
const MAX_BOX_ASPECT = 2.2;

export interface ContentBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The centred region the composition is laid out in, in design units. */
export function contentBox(width: number, height: number): ContentBox {
    const landscape = width > height;
    const short = Math.min(landscape ? height : width, MAX_BOX_SHORT);
    const long = Math.min(landscape ? width : height, short * MAX_BOX_ASPECT);
    const boxWidth = landscape ? long : short;
    const boxHeight = landscape ? short : long;
    return { x: (width - boxWidth) / 2, y: (height - boxHeight) / 2, width: boxWidth, height: boxHeight };
}

export function computeLayout(width: number, height: number, insets: Insets = NO_INSETS): SceneLayout {
    const box = contentBox(width, height);
    if (width > height) return computeLandscapeLayout(box, insets, width, height);
    const designWidth = width;
    const designHeight = height;

    const boxWidth = box.width;
    const boxHeight = box.height;
    const top = insets.top + HUD_RESERVE;
    const bottom = insets.bottom + HELPER_RESERVE;
    const sideMargin = Math.max(SIDE_MARGIN, insets.left, insets.right);

    // The tray is anchored to the bottom, directly above the helper bar, and
    // the panel takes what is left. Centring the whole block instead leaves the
    // spare space UNDER the tray, which both looks broken and puts the thing
    // you drag furthest from the thumb.
    // Anchor the PLANK to the reserve, not the row inside it: the plank
    // overhangs its pockets, so anchoring the row put that overhang — and on a
    // device whose helper bar runs tall, a good deal more — under the buttons.
    const trayY =
        box.y +
        Math.max(top + MIN_PANEL + PANEL_TO_TRAY_GAP, boxHeight - bottom - TRAY_HEIGHT - SHELF_PAD_BOTTOM - RAIL_GAP);

    const byWidth = boxWidth - sideMargin * 2 - FRAME_THICKNESS * 2;
    const byHeight = trayY - box.y - PANEL_TO_TRAY_GAP - top - FRAME_THICKNESS * 2;
    const panelSize = Math.max(MIN_PANEL, Math.min(byWidth, byHeight));

    const frameSize = panelSize + FRAME_THICKNESS * 2;
    const frameX = box.x + (boxWidth - frameSize) / 2;
    // Centre the panel in the room above the tray.
    const frameY = box.y + top + Math.max(0, (trayY - box.y - PANEL_TO_TRAY_GAP - top - frameSize) / 2);

    // The tray belongs to the panel, not to the screen. On a wide viewport a
    // full-width tray flings the three cuts to the far edges, so the drag from
    // tray to panel crosses most of the display.
    const trayWidth = Math.min(boxWidth - sideMargin * 2, frameSize * 1.15);
    const trayLeft = box.x + (boxWidth - trayWidth) / 2;
    const slotWidth = (trayWidth - TRAY_GUTTER * 2) / 3;
    const tray: TraySlotBox[] = [0, 1, 2].map((index) => {
        const x = trayLeft + index * (slotWidth + TRAY_GUTTER);
        return {
            index,
            x,
            y: trayY,
            width: slotWidth,
            height: TRAY_HEIGHT,
            centreX: x + slotWidth / 2,
            centreY: trayY + TRAY_HEIGHT / 2,
        };
    });

    return {
        width: designWidth,
        height: designHeight,
        frameX,
        frameY,
        frameSize,
        frameThickness: FRAME_THICKNESS,
        panelX: frameX + FRAME_THICKNESS,
        panelY: frameY + FRAME_THICKNESS,
        panelSize,
        cellSize: panelSize / BOARD_SIZE,
        tray,
        // Portrait has room above and below the row, so the plank simply
        // overhangs its pockets.
        shelf: {
            x: trayLeft - SHELF_PAD_X,
            y: trayY - SHELF_PAD_TOP,
            width: trayWidth + SHELF_PAD_X * 2,
            height: TRAY_HEIGHT + SHELF_PAD_TOP + SHELF_PAD_BOTTOM,
        },
        trayCellCap: (panelSize / BOARD_SIZE) * 0.8,
    };
}

/** Top-left of a board cell, in design units. */
export function cellOrigin(layout: SceneLayout, x: number, y: number): { x: number; y: number } {
    return { x: layout.panelX + x * layout.cellSize, y: layout.panelY + y * layout.cellSize };
}

/** Centre of a board cell, in design units. */
export function cellCentre(layout: SceneLayout, x: number, y: number): { x: number; y: number } {
    return {
        x: layout.panelX + (x + 0.5) * layout.cellSize,
        y: layout.panelY + (y + 0.5) * layout.cellSize,
    };
}

/** Board coordinates under a design-unit point, or null when off the panel. */
export function cellAtPoint(layout: SceneLayout, pointX: number, pointY: number): { x: number; y: number } | null {
    const x = Math.floor((pointX - layout.panelX) / layout.cellSize);
    const y = Math.floor((pointY - layout.panelY) / layout.cellSize);
    if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return null;
    return { x, y };
}

/** Cell size a cut is drawn at inside its tray slot. */
export function trayCellSize(layout: SceneLayout, piece: Piece): number {
    const slot = layout.tray[0];
    if (!slot) return layout.trayCellCap;
    const byWidth = (slot.width * 0.86) / piece.width;
    const byHeight = (slot.height * 0.72) / piece.height;
    return Math.min(layout.trayCellCap, byWidth, byHeight);
}

/**
 * Landscape is its own composition, not a squeezed portrait column. Every DOM
 * control moves into a right-hand rail, so nothing reserves horizontal strips
 * above or below the panel. The rail holds, top to bottom: the DOM score
 * cluster (score + shards, then combo + gear + menu), the tray as a column of
 * three, and the DOM helper row. The tray column lives between those two DOM
 * clusters, which is what the reserves are for.
 *
 * THESE FOUR NUMBERS ARE MIRRORED IN app.css as `--rail-width`, `--rail-hud`
 * and `--rail-helper` (each `100dvh * n / 720`, because the landscape design
 * scale is viewport-height / 720). Change one, change the other: the reserves
 * are the ONLY thing keeping the DOM off the tray, and a HUD that outgrows its
 * reserve lands on top of the first cut.
 */
/** 215 / 720 — two compact rows: score + shards, then combo + gear + menu. */
const HUD_RESERVE_LANDSCAPE = 215;
/** 105 / 720 — one row of helper buttons, above the bottom safe inset. */
const HELPER_RESERVE_LANDSCAPE = 105;
/** 400 / 720 — the rail every DOM control is confined to. */
const RAIL_WIDTH_LANDSCAPE = 400;
const PANEL_MARGIN_LANDSCAPE = 16;
const RAIL_PANEL_GAP = 28;
const TRAY_COLUMN_GUTTER = 16;

function computeLandscapeLayout(
    box: ContentBox,
    insets: Insets,
    designWidth: number,
    designHeight: number,
): SceneLayout {
    const width = box.width;
    const height = box.height;
    const marginTop = Math.max(PANEL_MARGIN_LANDSCAPE, insets.top);
    const marginBottom = Math.max(PANEL_MARGIN_LANDSCAPE, insets.bottom);
    const marginLeft = Math.max(SIDE_MARGIN, insets.left);
    const marginRight = Math.max(SIDE_MARGIN, insets.right);

    const railX = box.x + width - marginRight - RAIL_WIDTH_LANDSCAPE;
    const roomLeftOfRail = railX - RAIL_PANEL_GAP - (box.x + marginLeft);

    // The square wants the full height, but on a 4:3-ish landscape (a tablet on
    // its side) the height it wants is wider than the room left of the rail.
    // Sizing by height alone there pushed the frame straight under the score
    // card, so the width has a vote too.
    const panelSize = Math.max(
        MIN_PANEL,
        Math.min(height - marginTop - marginBottom - FRAME_THICKNESS * 2, roomLeftOfRail - FRAME_THICKNESS * 2),
    );
    const frameSize = panelSize + FRAME_THICKNESS * 2;
    const frameY = box.y + marginTop + Math.max(0, (height - marginTop - marginBottom - frameSize) / 2);
    const frameX = box.x + marginLeft + Math.max(0, (roomLeftOfRail - frameSize) / 2);

    // In landscape the plank IS the rail: same width and same edges as the DOM
    // clusters above and below it, so the three read as one column rather than
    // as a thin strip stranded between two much wider boxes. It is sized first
    // and the pockets are cut out of it — the other way round, the plank's
    // overhang lands outside the band and the helper buttons sit on the wood.
    const shelf: ShelfBox = {
        x: railX,
        y: box.y + insets.top + HUD_RESERVE_LANDSCAPE + RAIL_GAP,
        width: RAIL_WIDTH_LANDSCAPE,
        height: Math.max(
            0,
            height - insets.bottom - HELPER_RESERVE_LANDSCAPE - insets.top - HUD_RESERVE_LANDSCAPE - RAIL_GAP * 2,
        ),
    };

    const trayY = shelf.y + SHELF_PAD_TOP;
    const slotHeight = Math.max(0, (shelf.height - SHELF_PAD_TOP - SHELF_PAD_BOTTOM - TRAY_COLUMN_GUTTER * 2) / 3);
    // The plank spans the rail, but a pocket that does too leaves every cut
    // adrift in a wide empty recess: a cut is sized by whichever axis runs out
    // first, and in a stacked column that is always the height. Keep the pocket
    // near the shape of what it holds, and centre it in the plank.
    const innerWidth = shelf.width - SHELF_PAD_X * 2;
    const slotWidth = Math.min(innerWidth, Math.max(slotHeight * 1.7, innerWidth * 0.6));
    const trayX = shelf.x + (shelf.width - slotWidth) / 2;

    const tray: TraySlotBox[] = [0, 1, 2].map((index) => {
        const y = trayY + index * (slotHeight + TRAY_COLUMN_GUTTER);
        return {
            index,
            x: trayX,
            y,
            width: slotWidth,
            height: slotHeight,
            centreX: trayX + slotWidth / 2,
            centreY: y + slotHeight / 2,
        };
    });

    return {
        width: designWidth,
        height: designHeight,
        frameX,
        frameY,
        frameSize,
        frameThickness: FRAME_THICKNESS,
        panelX: frameX + FRAME_THICKNESS,
        panelY: frameY + FRAME_THICKNESS,
        panelSize,
        cellSize: panelSize / BOARD_SIZE,
        tray,
        shelf,
        trayCellCap: (panelSize / BOARD_SIZE) * 0.8,
    };
}
