/**
 * Drawing the tray — DESIGN.md §3.1.
 *
 * Three rules: weights bend toward small cuts as the panel crowds, a drawn set
 * must contain at least one piece that fits somewhere, and three identical
 * shapes is not a set. All of it is driven by the run's seeded `NoiseRandom`,
 * so a seed replays exactly.
 */

import { BOARD_CELLS } from "../constants.ts";
import type { NoiseRandom } from "../noiseRandom.ts";
import { anyPlacement, type Board, filledCount } from "./board.ts";
import { PIECES, type Piece } from "./pieces.ts";

/** How hard crowding pushes the draw toward small pieces. */
const CROWDING_EXPONENT = 0.55;
const MAX_DRAW_ATTEMPTS = 8;

export interface Cut {
    piece: Piece;
    /** Index into the active palette's colour ramp. */
    colourIndex: number;
}

/** Salts keep the shape roll and the colour roll independent at one position. */
const SALT_SHAPE = 0x5ea1;
const SALT_COLOUR = 0xc01a;

function crowdedWeight(piece: Piece, openFraction: number): number {
    if (piece.size <= 1) return piece.weight;
    return piece.weight * openFraction ** ((piece.size - 1) * CROWDING_EXPONENT);
}

function pickPiece(random: NoiseRandom, openFraction: number): Piece {
    let total = 0;
    for (const entry of PIECES) total += crowdedWeight(entry, openFraction);
    // `total` can only reach zero if every piece is larger than one cell, which
    // the set forbids, but a fallback beats an infinite loop.
    if (total <= 0) return PIECES[0] as Piece;

    let roll = Math.min(random.float(0, total, SALT_SHAPE), total - Number.EPSILON);
    for (const entry of PIECES) {
        roll -= crowdedWeight(entry, openFraction);
        if (roll < 0) return entry;
    }
    return PIECES[PIECES.length - 1] as Piece;
}

/** The largest piece that currently fits, or `undefined` on a full panel. */
function largestFitting(board: Board): Piece | undefined {
    let best: Piece | undefined;
    for (const entry of PIECES) {
        if ((best && entry.size <= best.size) || !anyPlacement(board, entry)) continue;
        best = entry;
    }
    return best;
}

/**
 * Draw a fresh set of cuts for the given board.
 *
 * The returned set always contains at least one placeable piece whenever the
 * panel has room for anything at all: the run ends because of what the player
 * placed, never because of what the bag handed them.
 */
export function drawTray(board: Board, random: NoiseRandom, paletteSize: number): Cut[] {
    const openFraction = Math.max(0.02, 1 - filledCount(board) / BOARD_CELLS);

    let chosen: Piece[] = [];
    for (let attempt = 0; attempt < MAX_DRAW_ATTEMPTS; attempt++) {
        chosen = [pickPiece(random, openFraction), pickPiece(random, openFraction), pickPiece(random, openFraction)];
        const identical = chosen.every((entry) => entry.id === chosen[0]?.id);
        // The final attempt accepts whatever it rolled; the solvability repair
        // below is what actually guarantees a usable tray.
        const lastAttempt = attempt === MAX_DRAW_ATTEMPTS - 1;
        if (identical && !lastAttempt) continue;
        if (chosen.some((entry) => anyPlacement(board, entry))) break;
    }

    if (!chosen.some((entry) => anyPlacement(board, entry))) {
        const repair = largestFitting(board);
        if (repair) chosen[0] = repair;
    }

    return chosen.map((piece) => ({
        piece,
        colourIndex: random.int(0, Math.max(1, paletteSize), SALT_COLOUR),
    }));
}
