/**
 * The run machine — DESIGN.md §2, §4, §5.2, §6.2.
 *
 * Owns the board, the tray, the score, and the combo, and reports every state
 * change as a plain result object the scene can choreograph from. It knows
 * nothing about Pixi, React, the store, shards, or ads: the caller decides
 * whether a helper is affordable, this decides whether it is legal.
 *
 * `status` has three values, and the middle one matters. When no tray piece
 * fits, the run goes **stuck**, not over — from there the player can recut,
 * chisel, or take the rewarded Second Firing. Only `end()` makes it over.
 */

import { TRAY_SIZE } from "../constants.ts";
import { NoiseRandom } from "../noiseRandom.ts";
import { type Cut, drawTray } from "./bag.ts";
import {
    anyPlacement,
    type Board,
    canPlace,
    clearLines,
    cloneBoard,
    createBoard,
    densestRows,
    filledCount,
    fullLines,
    indexOf,
    isEmpty,
    type LineSet,
    place,
    removeCell,
} from "./board.ts";
import { type PlacementScore, runShards, scorePlacement } from "./scoring.ts";

export type RunStatus = "playing" | "stuck" | "over";

/** How many rows the rewarded Second Firing clears. */
export const SECOND_FIRING_ROWS = 3;

export type TraySlot = Cut | null;

export interface PlacementResult {
    slot: number;
    cut: Cut;
    origin: { x: number; y: number };
    /** Board indices this piece filled, in the piece's own cell order. */
    filled: number[];
    lines: LineSet;
    /** Board indices the firing cleared. Empty when nothing fired. */
    cleared: number[];
    linesFired: number;
    combo: number;
    cleanPane: boolean;
    score: PlacementScore;
    totalScore: number;
    /** True when this placement emptied the tray and a new set was drawn. */
    refilled: boolean;
    status: RunStatus;
}

export interface ChiselResult {
    index: number;
    x: number;
    y: number;
    status: RunStatus;
}

export interface RunSummary {
    score: number;
    linesFired: number;
    cleanPanes: number;
    bestCombo: number;
    piecesPlaced: number;
    shards: number;
    secondFiringUsed: boolean;
}

export interface RunOptions {
    seed: number;
    /** Number of colours in the active palette; cuts are tinted from it. */
    paletteSize: number;
    /** Starting position in the noise sequence — non-zero only on replay. */
    position?: number;
}

export class PuzzleRun {
    readonly seed: number;
    private readonly random: NoiseRandom;
    private readonly paletteSize: number;

    private _board: Board = createBoard();
    private _tray: TraySlot[] = [];
    private _status: RunStatus = "playing";
    private _score = 0;
    private _combo = 0;
    private _bestCombo = 0;
    private _linesFired = 0;
    private _cleanPanes = 0;
    private _piecesPlaced = 0;
    private _secondFiringUsed = false;

    constructor(options: RunOptions) {
        this.seed = options.seed >>> 0;
        this.paletteSize = Math.max(1, Math.floor(options.paletteSize));
        this.random = new NoiseRandom(this.seed, options.position ?? 0);
        this.refillTray();
    }

    /** Live board. Read-only by convention — mutate it only through this class. */
    get board(): Board {
        return this._board;
    }

    get tray(): readonly TraySlot[] {
        return this._tray;
    }

    get status(): RunStatus {
        return this._status;
    }

    get score(): number {
        return this._score;
    }

    get combo(): number {
        return this._combo;
    }

    get bestCombo(): number {
        return this._bestCombo;
    }

    get linesFired(): number {
        return this._linesFired;
    }

    get cleanPanes(): number {
        return this._cleanPanes;
    }

    get filled(): number {
        return filledCount(this._board);
    }

    get secondFiringAvailable(): boolean {
        return !this._secondFiringUsed && this._status === "stuck";
    }

    /** Position in the noise sequence, so a run can be resumed or replayed. */
    get randomPosition(): number {
        return this.random.position;
    }

    boardSnapshot(): Board {
        return cloneBoard(this._board);
    }

    summary(): RunSummary {
        return {
            score: this._score,
            linesFired: this._linesFired,
            cleanPanes: this._cleanPanes,
            bestCombo: this._bestCombo,
            piecesPlaced: this._piecesPlaced,
            shards: runShards(this._score, this._cleanPanes),
            secondFiringUsed: this._secondFiringUsed,
        };
    }

    canPlaceAt(slot: number, x: number, y: number): boolean {
        if (this._status === "over") return false;
        const cut = this._tray[slot];
        return cut ? canPlace(this._board, cut.piece, x, y) : false;
    }

    /** True while at least one tray piece fits somewhere. */
    hasAnyMove(): boolean {
        return this._tray.some((cut) => cut !== null && anyPlacement(this._board, cut.piece));
    }

    /**
     * Place the piece in `slot` with its bounding box origin at `(x, y)`.
     * Returns `null` when the placement is illegal — callers use that to spring
     * the piece back rather than to throw.
     */
    place(slot: number, x: number, y: number): PlacementResult | null {
        if (this._status === "over") return null;
        const cut = this._tray[slot];
        if (!cut || !canPlace(this._board, cut.piece, x, y)) return null;

        const filled = place(this._board, cut.piece, x, y, cut.colourIndex);
        this._tray[slot] = null;
        this._piecesPlaced += 1;

        const lines = fullLines(this._board);
        const linesFired = lines.rows.length + lines.cols.length;
        const cleared = linesFired > 0 ? clearLines(this._board, lines) : [];

        if (linesFired > 0) {
            this._combo += 1;
            this._bestCombo = Math.max(this._bestCombo, this._combo);
            this._linesFired += linesFired;
        } else {
            this._combo = 0;
        }

        const cleanPane = linesFired > 0 && isEmpty(this._board);
        if (cleanPane) this._cleanPanes += 1;

        const score = scorePlacement({
            cellsPlaced: cut.piece.size,
            linesFired,
            combo: this._combo,
            cleanPane,
        });
        this._score += score.total;

        const refilled = this._tray.every((entry) => entry === null);
        if (refilled) this.refillTray();
        this.evaluateStatus();

        return {
            slot,
            cut,
            origin: { x, y },
            filled,
            lines,
            cleared,
            linesFired,
            combo: this._combo,
            cleanPane,
            score,
            totalScore: this._score,
            refilled,
            status: this._status,
        };
    }

    /**
     * Remove one filled cell (DESIGN.md §5.2). A chisel can never complete a
     * line — it only ever empties one — so it scores nothing and leaves the
     * combo alone.
     */
    chisel(x: number, y: number): ChiselResult | null {
        if (this._status === "over") return null;
        if (!removeCell(this._board, x, y)) return null;
        this.evaluateStatus();
        return { index: indexOf(x, y), x, y, status: this._status };
    }

    /** Discard the tray and draw a fresh set. The combo survives. */
    recut(): boolean {
        if (this._status === "over") return false;
        this.refillTray();
        this.evaluateStatus();
        return true;
    }

    /**
     * The rewarded continue. Clears the fullest rows, redraws, resets the
     * combo, and awards nothing — it buys room, not points, so it cannot be
     * farmed. Legal only once per run and only from `stuck`.
     */
    secondFiring(): number[] | null {
        if (!this.secondFiringAvailable) return null;
        this._secondFiringUsed = true;
        const rows = densestRows(this._board, SECOND_FIRING_ROWS);
        const cleared = clearLines(this._board, { rows, cols: [] });
        this._combo = 0;
        this.refillTray();
        this.evaluateStatus();
        return cleared;
    }

    /** The player accepts the end of a stuck run. */
    end(): RunSummary {
        this._status = "over";
        return this.summary();
    }

    private refillTray(): void {
        this._tray = drawTray(this._board, this.random, this.paletteSize).slice(0, TRAY_SIZE);
        while (this._tray.length < TRAY_SIZE) this._tray.push(null);
    }

    private evaluateStatus(): void {
        if (this._status === "over") return;
        this._status = this.hasAnyMove() ? "playing" : "stuck";
    }
}
