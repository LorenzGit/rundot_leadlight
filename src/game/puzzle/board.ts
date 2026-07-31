/**
 * The panel — DESIGN.md §2.1–§2.3.
 *
 * A board is a flat `Uint8Array` of 64 cells. `0` is empty; any other value is
 * `1 + colourIndex`, so the palette colour a cell was cut from survives until
 * the cell is fired. Flat and typed because `anyPlacement` runs it 64 times per
 * piece per placement, and the simulation runs that hundreds of thousands of
 * times.
 */
import { BOARD_CELLS, BOARD_SIZE } from "../constants.ts";
import type { Piece } from "./pieces.ts";

export type Board = Uint8Array;

export interface LineSet {
    rows: number[];
    cols: number[];
}

export function createBoard(): Board {
    return new Uint8Array(BOARD_CELLS);
}

export function cloneBoard(board: Board): Board {
    return new Uint8Array(board);
}

export function indexOf(x: number, y: number): number {
    return y * BOARD_SIZE + x;
}

export function cellAt(board: Board, x: number, y: number): number {
    if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return 0;
    return board[indexOf(x, y)] ?? 0;
}

export function filledCount(board: Board): number {
    let filled = 0;
    for (let i = 0; i < BOARD_CELLS; i++) if (board[i] !== 0) filled += 1;
    return filled;
}

export function isEmpty(board: Board): boolean {
    for (let i = 0; i < BOARD_CELLS; i++) if (board[i] !== 0) return false;
    return true;
}

/** True when every cell of `piece` lands inside the panel on an empty cell. */
export function canPlace(board: Board, piece: Piece, originX: number, originY: number): boolean {
    if (originX < 0 || originY < 0) return false;
    if (originX + piece.width > BOARD_SIZE || originY + piece.height > BOARD_SIZE) return false;
    for (const cell of piece.cells) {
        if (board[indexOf(originX + cell.x, originY + cell.y)] !== 0) return false;
    }
    return true;
}

/** True when the piece fits anywhere at all. This is the game-over test. */
export function anyPlacement(board: Board, piece: Piece): boolean {
    const maxX = BOARD_SIZE - piece.width;
    const maxY = BOARD_SIZE - piece.height;
    for (let y = 0; y <= maxY; y++) {
        for (let x = 0; x <= maxX; x++) {
            if (canPlace(board, piece, x, y)) return true;
        }
    }
    return false;
}

/** Every legal origin for a piece, top-left first. Used by the hint/QA seams. */
export function placements(board: Board, piece: Piece): Array<{ x: number; y: number }> {
    const found: Array<{ x: number; y: number }> = [];
    const maxX = BOARD_SIZE - piece.width;
    const maxY = BOARD_SIZE - piece.height;
    for (let y = 0; y <= maxY; y++) {
        for (let x = 0; x <= maxX; x++) {
            if (canPlace(board, piece, x, y)) found.push({ x, y });
        }
    }
    return found;
}

/**
 * Write a piece into the board. Caller must have checked `canPlace`; this
 * throws rather than silently corrupting the panel.
 *
 * @returns the board indices that were filled, in the piece's own cell order.
 */
export function place(board: Board, piece: Piece, originX: number, originY: number, colourIndex: number): number[] {
    if (!canPlace(board, piece, originX, originY)) {
        throw new Error(`Illegal placement of ${piece.id} at ${originX},${originY}`);
    }
    const value = (colourIndex % 250) + 1;
    const filled: number[] = [];
    for (const cell of piece.cells) {
        const index = indexOf(originX + cell.x, originY + cell.y);
        board[index] = value;
        filled.push(index);
    }
    return filled;
}

/** Remove one filled cell. Returns false when the cell was already empty. */
export function removeCell(board: Board, x: number, y: number): boolean {
    const index = indexOf(x, y);
    if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE || board[index] === 0) return false;
    board[index] = 0;
    return true;
}

export function fullLines(board: Board): LineSet {
    const rows: number[] = [];
    const cols: number[] = [];
    for (let y = 0; y < BOARD_SIZE; y++) {
        let complete = true;
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (board[indexOf(x, y)] === 0) {
                complete = false;
                break;
            }
        }
        if (complete) rows.push(y);
    }
    for (let x = 0; x < BOARD_SIZE; x++) {
        let complete = true;
        for (let y = 0; y < BOARD_SIZE; y++) {
            if (board[indexOf(x, y)] === 0) {
                complete = false;
                break;
            }
        }
        if (complete) cols.push(x);
    }
    return { rows, cols };
}

/**
 * Clear the given rows and columns at once. A cell in both a full row and a
 * full column is reported once, which is what makes the score in §4 correct.
 *
 * @returns the cleared board indices, ascending.
 */
export function clearLines(board: Board, lines: LineSet): number[] {
    const cleared = new Set<number>();
    for (const y of lines.rows) {
        for (let x = 0; x < BOARD_SIZE; x++) cleared.add(indexOf(x, y));
    }
    for (const x of lines.cols) {
        for (let y = 0; y < BOARD_SIZE; y++) cleared.add(indexOf(x, y));
    }
    const indices = [...cleared].sort((a, b) => a - b);
    for (const index of indices) board[index] = 0;
    return indices;
}

/**
 * The three rows holding the most glass, fullest first, ties resolved topmost.
 * This is what the rewarded Second Firing clears (DESIGN.md §6.2) — it is the
 * choice that frees the most room without ever being worth points.
 */
export function densestRows(board: Board, count: number): number[] {
    const scored: Array<{ row: number; filled: number }> = [];
    for (let y = 0; y < BOARD_SIZE; y++) {
        let filled = 0;
        for (let x = 0; x < BOARD_SIZE; x++) if (board[indexOf(x, y)] !== 0) filled += 1;
        scored.push({ row: y, filled });
    }
    scored.sort((a, b) => b.filled - a.filled || a.row - b.row);
    return scored
        .slice(0, Math.max(0, count))
        .filter((entry) => entry.filled > 0)
        .map((entry) => entry.row);
}
