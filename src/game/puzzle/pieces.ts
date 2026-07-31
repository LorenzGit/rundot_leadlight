/**
 * The cut set — DESIGN.md §3.
 *
 * A piece is a bounding box plus the offsets it actually fills. Pieces never
 * rotate, so each orientation is its own entry with its own stable id: the id
 * is what the save, the analytics, and the simulation all agree on.
 *
 * Renderer-free on purpose. This module (and everything else under puzzle/)
 * imports nothing from Pixi, React, or the store, so `npm run simulate` runs
 * the real rules rather than a second implementation of them.
 */

export interface PieceCell {
    x: number;
    y: number;
}

export interface Piece {
    id: string;
    /** Bounding box, in cells. */
    width: number;
    height: number;
    /** Filled offsets inside that box, row-major. */
    cells: readonly PieceCell[];
    /** Filled cell count — `cells.length`, precomputed because it is hot. */
    size: number;
    /** Base draw weight before the crowding bias in `bag.ts`. */
    weight: number;
}

/**
 * Build a piece from an ASCII mask. `#` is glass, anything else is empty.
 * Rows are given top to bottom; ragged rows are padded, so the callers below
 * can stay readable.
 */
function piece(id: string, weight: number, rows: readonly string[]): Piece {
    const width = Math.max(...rows.map((row) => row.length));
    const cells: PieceCell[] = [];
    rows.forEach((row, y) => {
        for (let x = 0; x < width; x++) {
            if (row[x] === "#") cells.push({ x, y });
        }
    });
    if (cells.length === 0) throw new Error(`Piece ${id} has no cells`);
    return { id, width, height: rows.length, cells, size: cells.length, weight };
}

/** A solid w x h rectangle. */
function box(id: string, weight: number, width: number, height: number): Piece {
    return piece(
        id,
        weight,
        Array.from({ length: height }, () => "#".repeat(width)),
    );
}

export const PIECES: readonly Piece[] = [
    // Dot
    box("dot", 8, 1, 1),

    // Bars
    box("bar-h2", 14, 2, 1),
    box("bar-v2", 14, 1, 2),
    box("bar-h3", 13, 3, 1),
    box("bar-v3", 13, 1, 3),
    box("bar-h4", 8, 4, 1),
    box("bar-v4", 8, 1, 4),
    box("bar-h5", 4, 5, 1),
    box("bar-v5", 4, 1, 5),

    // Squares and rectangles
    box("square2", 14, 2, 2),
    box("square3", 3, 3, 3),
    box("rect-2x3", 6, 2, 3),
    box("rect-3x2", 6, 3, 2),

    // Small corners — a 2x2 with one cell missing.
    piece("corner-ne", 10, ["##", ".#"]),
    piece("corner-nw", 10, ["##", "#."]),
    piece("corner-se", 10, [".#", "##"]),
    piece("corner-sw", 10, ["#.", "##"]),

    // Big corners — a 3x3 with a 2x2 missing.
    piece("bigcorner-ne", 5, ["###", "..#", "..#"]),
    piece("bigcorner-nw", 5, ["###", "#..", "#.."]),
    piece("bigcorner-se", 5, ["..#", "..#", "###"]),
    piece("bigcorner-sw", 5, ["#..", "#..", "###"]),

    // Tees
    piece("tee-up", 5, [".#.", "###"]),
    piece("tee-down", 5, ["###", ".#."]),
    piece("tee-left", 5, [".#", "##", ".#"]),
    piece("tee-right", 5, ["#.", "##", "#."]),

    // Skews
    piece("skew-s-h", 4, [".##", "##."]),
    piece("skew-z-h", 4, ["##.", ".##"]),
    piece("skew-s-v", 4, ["#.", "##", ".#"]),
    piece("skew-z-v", 4, [".#", "##", "#."]),

    // Diagonals — rare, and the reason a board can look open and be closed.
    piece("diag-down", 2, ["#.", ".#"]),
    piece("diag-up", 2, [".#", "#."]),
];

const BY_ID = new Map(PIECES.map((entry) => [entry.id, entry]));

export function pieceById(id: string): Piece | undefined {
    return BY_ID.get(id);
}

export function requirePiece(id: string): Piece {
    const found = BY_ID.get(id);
    if (!found) throw new Error(`Unknown piece id: ${id}`);
    return found;
}
