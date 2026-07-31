/**
 * Scoring — DESIGN.md §4.
 *
 * Kept apart from the run machine so the numbers can be asserted directly by
 * `npm run simulate`. A wrong score still looks like a plausible score on
 * screen, so this is the only place that can catch it.
 */

export const CLEAN_PANE_BONUS = 250;
export const MAX_COMBO_MULTIPLIER = 4;

/** Score for firing `lines` lines at once, before the combo multiplier. */
export function lineScore(lines: number): number {
    if (lines <= 0) return 0;
    return (10 * lines * (lines + 1)) / 2;
}

/**
 * The combo multiplier for a placement that fires. `combo` is the counter
 * AFTER incrementing, so the first firing of a streak passes 1 and gets x1.
 */
export function comboMultiplier(combo: number): number {
    if (combo <= 1) return 1;
    return Math.min(1 + 0.25 * (combo - 1), MAX_COMBO_MULTIPLIER);
}

export interface PlacementScore {
    /** Points for the cells placed. Never multiplied. */
    placement: number;
    /** Points for the lines fired, after the combo multiplier. */
    firing: number;
    /** Clean-pane bonus, after the combo multiplier. */
    cleanPane: number;
    total: number;
    multiplier: number;
}

export function scorePlacement(input: {
    cellsPlaced: number;
    linesFired: number;
    combo: number;
    cleanPane: boolean;
}): PlacementScore {
    const multiplier = input.linesFired > 0 ? comboMultiplier(input.combo) : 1;
    const firing = Math.floor(lineScore(input.linesFired) * multiplier);
    const cleanPane = input.cleanPane ? Math.floor(CLEAN_PANE_BONUS * multiplier) : 0;
    return {
        placement: input.cellsPlaced,
        firing,
        cleanPane,
        multiplier,
        total: input.cellsPlaced + firing + cleanPane,
    };
}

/**
 * Shards paid out by a finished run — DESIGN.md §5.1.
 *
 * The divisor is set so a median run funds roughly half a Recut: the helpers
 * are a real choice every run rather than a thing you save up for. It also
 * keeps a Recut deliberately loss-making — `npm run balance` shows one buys
 * about 210 points, or 14 shards, against its 60-shard price. Helpers buy a
 * higher score, never a profit, so no amount of banked shards runs away.
 */
export function runShards(score: number, cleanPanes: number): number {
    return Math.floor(Math.max(0, score) / 15) + 10 * Math.max(0, cleanPanes);
}
