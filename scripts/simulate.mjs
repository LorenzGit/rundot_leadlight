#!/usr/bin/env node
/**
 * Deterministic headless proof for LEADLIGHT.
 *
 * `src/game/puzzle/` imports nothing from Pixi, React, or the store, so it runs
 * here exactly as it runs in the browser (Node 22+ strips the types on import).
 * Two jobs:
 *
 *   1. `npm run simulate` — assert the rules and the arithmetic. A wrong score
 *      still looks like a plausible score on screen, and a bag that quietly
 *      hands out dead trays just feels like bad luck, so neither is catchable
 *      by playing.
 *   2. `npm run balance` — play many seeded runs with a greedy player and print
 *      the score distribution, so a change to the weights, the crowding bias,
 *      or the combo curve can be judged before anyone plays it.
 */
import process from "node:process";
import { BOARD_SIZE } from "../src/game/constants.ts";
import {
    anyPlacement,
    canPlace,
    clearLines,
    createBoard,
    densestRows,
    filledCount,
    fullLines,
    indexOf,
    isEmpty,
    place,
    placements,
} from "../src/game/puzzle/board.ts";
import { PIECES, requirePiece } from "../src/game/puzzle/pieces.ts";
import { drawTray } from "../src/game/puzzle/bag.ts";
import { PuzzleRun } from "../src/game/puzzle/run.ts";
import { comboMultiplier, lineScore, runShards, scorePlacement } from "../src/game/puzzle/scoring.ts";
import { NoiseRandom } from "../src/game/noiseRandom.ts";

const PALETTE_SIZE = 6;
let failures = 0;

function check(condition, message) {
    if (condition) return;
    failures += 1;
    console.error(`  FAIL  ${message}`);
}

// ---------------------------------------------------------------------------
// The cut set
// ---------------------------------------------------------------------------

function checkPieces() {
    const ids = new Set();
    for (const piece of PIECES) {
        check(!ids.has(piece.id), `duplicate piece id ${piece.id}`);
        ids.add(piece.id);
        check(piece.size === piece.cells.length, `${piece.id} size disagrees with its cells`);
        check(piece.weight > 0, `${piece.id} has a non-positive weight`);
        check(
            piece.width <= BOARD_SIZE && piece.height <= BOARD_SIZE,
            `${piece.id} cannot fit on an empty board (${piece.width}x${piece.height})`,
        );
        // Every piece must touch both extremes of its bounding box, or the box
        // is padded and the drag preview would sit off-centre.
        const maxX = Math.max(...piece.cells.map((c) => c.x));
        const maxY = Math.max(...piece.cells.map((c) => c.y));
        const minX = Math.min(...piece.cells.map((c) => c.x));
        const minY = Math.min(...piece.cells.map((c) => c.y));
        check(minX === 0 && minY === 0, `${piece.id} does not start at its bounding-box origin`);
        check(maxX === piece.width - 1, `${piece.id} bounding width ${piece.width} is padded`);
        check(maxY === piece.height - 1, `${piece.id} bounding height ${piece.height} is padded`);
        // Every piece must be placeable on an empty board.
        check(anyPlacement(createBoard(), piece), `${piece.id} does not fit an empty board`);
    }
    check(PIECES.length === 31, `expected 31 cuts, found ${PIECES.length}`);
}

// ---------------------------------------------------------------------------
// Board mechanics
// ---------------------------------------------------------------------------

function checkBoard() {
    const board = createBoard();

    // Overlap and overhang are both illegal.
    const bar = requirePiece("bar-h4");
    check(canPlace(board, bar, 0, 0), "a 4-bar must fit an empty row");
    check(!canPlace(board, bar, 5, 0), "a 4-bar must not hang off the right edge");
    place(board, bar, 0, 0, 0);
    check(!canPlace(board, bar, 0, 0), "a placed cell must block a second placement");
    check(canPlace(board, bar, 4, 0), "the rest of the row must remain free");

    // Fill a whole row and prove exactly that row fires.
    place(board, bar, 4, 0, 1);
    const rowLines = fullLines(board);
    check(rowLines.rows.length === 1 && rowLines.rows[0] === 0, "a filled top row must be the only full line");
    check(rowLines.cols.length === 0, "one filled row must not report a full column");
    const cleared = clearLines(board, rowLines);
    check(cleared.length === BOARD_SIZE, `clearing one row must clear ${BOARD_SIZE} cells, cleared ${cleared.length}`);
    check(isEmpty(board), "clearing the only filled row must empty the panel");

    // A row and a column that cross must clear their shared cell exactly once.
    const cross = createBoard();
    for (let x = 0; x < BOARD_SIZE; x++) cross[indexOf(x, 3)] = 1;
    for (let y = 0; y < BOARD_SIZE; y++) cross[indexOf(3, y)] = 1;
    const crossLines = fullLines(cross);
    check(crossLines.rows.length === 1 && crossLines.cols.length === 1, "the cross must report one row and one column");
    const crossCleared = clearLines(cross, crossLines);
    check(
        crossCleared.length === BOARD_SIZE * 2 - 1,
        `a crossing row and column share one cell: expected ${BOARD_SIZE * 2 - 1}, got ${crossCleared.length}`,
    );
    check(new Set(crossCleared).size === crossCleared.length, "cleared indices must not repeat");

    // densestRows ranks by fill and breaks ties topmost-first.
    const dense = createBoard();
    for (let x = 0; x < 8; x++) dense[indexOf(x, 5)] = 1;
    for (let x = 0; x < 8; x++) dense[indexOf(x, 2)] = 1;
    for (let x = 0; x < 3; x++) dense[indexOf(x, 7)] = 1;
    const ranked = densestRows(dense, 3);
    check(
        ranked.length === 3 && ranked[0] === 2 && ranked[1] === 5 && ranked[2] === 7,
        `densestRows ranked ${JSON.stringify(ranked)}, expected [2,5,7]`,
    );
    check(densestRows(createBoard(), 3).length === 0, "an empty panel has no dense rows to clear");
}

// ---------------------------------------------------------------------------
// Scoring — DESIGN.md §4
// ---------------------------------------------------------------------------

function checkScoring() {
    check(lineScore(0) === 0, "firing nothing scores nothing");
    for (const [lines, expected] of [
        [1, 10],
        [2, 30],
        [3, 60],
        [4, 100],
        [5, 150],
    ]) {
        check(lineScore(lines) === expected, `lineScore(${lines}) should be ${expected}, was ${lineScore(lines)}`);
    }

    check(comboMultiplier(0) === 1, "no combo is x1");
    check(comboMultiplier(1) === 1, "the first firing of a streak is x1");
    check(comboMultiplier(2) === 1.25, "the second consecutive firing is x1.25");
    check(comboMultiplier(13) === 4, "a 13-firing streak caps at x4");
    check(comboMultiplier(40) === 4, "the multiplier must stay capped at x4");

    // Placement points are never multiplied.
    const combo = scorePlacement({ cellsPlaced: 4, linesFired: 2, combo: 3, cleanPane: false });
    check(combo.placement === 4, "placement points must equal the cells placed");
    check(combo.multiplier === 1.5, `expected x1.5 at combo 3, got x${combo.multiplier}`);
    check(combo.firing === 45, `2 lines at x1.5 should be 45, was ${combo.firing}`);
    check(combo.total === 49, `total should be 49, was ${combo.total}`);

    const plain = scorePlacement({ cellsPlaced: 3, linesFired: 0, combo: 0, cleanPane: false });
    check(plain.multiplier === 1 && plain.total === 3, "a placement that fires nothing scores only its cells");

    const clean = scorePlacement({ cellsPlaced: 1, linesFired: 1, combo: 2, cleanPane: true });
    check(clean.cleanPane === 312, `a clean pane at x1.25 should be 312, was ${clean.cleanPane}`);

    check(runShards(0, 0) === 0, "a zero run pays no shards");
    check(runShards(450, 0) === 30, "450 points should pay 30 shards");
    check(runShards(454, 2) === 50, "450-odd points plus two clean panes should pay 50 shards");
    check(runShards(-100, -3) === 0, "a nonsense run must never pay negative shards");
}

// ---------------------------------------------------------------------------
// The bag — DESIGN.md §3.1
// ---------------------------------------------------------------------------

function checkBag() {
    // Every draw on an empty board is solvable, and colours stay in range.
    for (let seed = 1; seed <= 400; seed++) {
        const random = new NoiseRandom(seed, 0);
        const tray = drawTray(createBoard(), random, PALETTE_SIZE);
        check(tray.length === 3, `draw ${seed} produced ${tray.length} cuts`);
        for (const cut of tray) {
            check(
                cut.colourIndex >= 0 && cut.colourIndex < PALETTE_SIZE,
                `colour index ${cut.colourIndex} is outside the palette`,
            );
        }
    }

    // The hard case: a nearly-full panel with only scattered single holes. Only
    // the dot fits, and the bag must still find it every single time.
    for (let seed = 1; seed <= 300; seed++) {
        const board = createBoard();
        board.fill(1);
        board[indexOf(0, 0)] = 0;
        board[indexOf(7, 7)] = 0;
        board[indexOf(4, 2)] = 0;
        const tray = drawTray(board, new NoiseRandom(seed, 0), PALETTE_SIZE);
        check(
            tray.some((cut) => anyPlacement(board, cut.piece)),
            `seed ${seed} drew a dead tray onto a panel that still had room`,
        );
    }

    // A completely full panel has nothing to repair with; the draw must still
    // return three cuts rather than throwing.
    const full = createBoard();
    full.fill(1);
    check(drawTray(full, new NoiseRandom(7, 0), PALETTE_SIZE).length === 3, "a full panel must still yield a tray");

    // Crowding bias: large cuts must get rarer as the panel fills.
    const bigOnEmpty = countLargeCuts(createBoard(), 3_000);
    const crowded = createBoard();
    for (let i = 0; i < 44; i++) crowded[i] = 1;
    const bigOnCrowded = countLargeCuts(crowded, 3_000);
    check(
        bigOnCrowded < bigOnEmpty * 0.75,
        `crowding must thin out 4+ cell cuts: empty ${bigOnEmpty}, crowded ${bigOnCrowded}`,
    );
}

function countLargeCuts(board, draws) {
    let large = 0;
    for (let seed = 1; seed <= draws; seed++) {
        for (const cut of drawTray(board, new NoiseRandom(seed, 0), PALETTE_SIZE)) {
            if (cut.piece.size >= 4) large += 1;
        }
    }
    return large;
}

// ---------------------------------------------------------------------------
// The run machine — DESIGN.md §2.4, §5.2, §6.2
// ---------------------------------------------------------------------------

function checkRun() {
    // Determinism: the same seed replays exactly, through helpers and all.
    const a = playGreedy(12_345);
    const b = playGreedy(12_345);
    check(a.score === b.score && a.trace === b.trace, "the same seed must replay to the same run");
    const c = playGreedy(12_346);
    check(a.trace !== c.trace, "different seeds must produce different runs");

    // A fresh run is playable and the tray is full.
    const run = new PuzzleRun({ seed: 99, paletteSize: PALETTE_SIZE });
    check(run.status === "playing", "a fresh run must be playable");
    check(run.tray.filter(Boolean).length === 3, "a fresh run must hold three cuts");
    check(run.score === 0 && run.combo === 0, "a fresh run starts at zero");

    // An illegal placement must be refused, not thrown.
    check(run.place(0, -1, 0) === null, "an off-panel placement must be refused");
    check(run.place(7, 0, 0) === null, "a placement into an empty slot must be refused");

    // The tray refills only when all three slots are empty.
    const refill = new PuzzleRun({ seed: 4, paletteSize: PALETTE_SIZE });
    let placed = 0;
    for (let slot = 0; slot < 3; slot++) {
        const cut = refill.tray[slot];
        const spot = placements(refill.board, cut.piece)[0];
        const result = refill.place(slot, spot.x, spot.y);
        check(result !== null, `placement ${slot} of the opening tray should be legal`);
        placed += 1;
        check(result.refilled === (placed === 3), `the tray must refill only after the third placement (slot ${slot})`);
    }

    // Chisel scores nothing, keeps the combo, and refuses an empty cell.
    const chiselRun = new PuzzleRun({ seed: 21, paletteSize: PALETTE_SIZE });
    const firstCut = chiselRun.tray[0];
    const firstSpot = placements(chiselRun.board, firstCut.piece)[0];
    chiselRun.place(0, firstSpot.x, firstSpot.y);
    const scoreBefore = chiselRun.score;
    const target = firstCut.piece.cells[0];
    check(chiselRun.chisel(firstSpot.x + target.x, firstSpot.y + target.y) !== null, "chiselling glass must work");
    check(chiselRun.score === scoreBefore, "a chisel must not change the score");
    check(chiselRun.chisel(firstSpot.x + target.x, firstSpot.y + target.y) === null, "chiselling a hole must refuse");

    checkStuckAndSecondFiring();
    checkCleanPane();
}

/**
 * Drive a run into the stuck state deliberately, then prove each of the four
 * exits behaves. This is the part of §2.4 that no amount of play would reach
 * reliably.
 */
function checkStuckAndSecondFiring() {
    const run = new PuzzleRun({ seed: 5, paletteSize: PALETTE_SIZE });
    // Leave a single hole in the top-left corner and fill everything else, so
    // only the dot can be placed. `board` is the live array by design.
    run.board.fill(1);
    run.board[indexOf(0, 0)] = 0;
    run.recut();

    // Force the stuck state: no holes at all.
    run.board[indexOf(0, 0)] = 1;
    check(run.chisel(0, 0) !== null, "chiselling the corner should succeed");
    run.board[indexOf(0, 0)] = 1;
    check(run.recut() === true, "recut must be legal");
    // With a completely full panel nothing can fit, whatever was drawn.
    check(run.status === "stuck", `a full panel must leave the run stuck, was ${run.status}`);
    check(run.hasAnyMove() === false, "a stuck run must report no available move");

    // Second Firing: clears the three fullest rows, awards nothing, resumes.
    const scoreBefore = run.score;
    const cleared = run.secondFiring();
    check(cleared !== null && cleared.length === BOARD_SIZE * 3, `Second Firing must clear three full rows`);
    check(run.score === scoreBefore, "Second Firing must not award any score");
    check(run.combo === 0, "Second Firing must reset the combo");
    check(run.status === "playing", "Second Firing must resume the run");
    check(run.secondFiringAvailable === false, "Second Firing must be available only once per run");
    check(run.secondFiring() === null, "a second Second Firing must be refused");

    // Chisel as the stuck exit.
    const chiselExit = new PuzzleRun({ seed: 6, paletteSize: PALETTE_SIZE });
    chiselExit.board.fill(1);
    chiselExit.recut();
    check(chiselExit.status === "stuck", "a full panel must be stuck");
    chiselExit.chisel(3, 3);
    check(chiselExit.status === "playing", "chiselling a hole must resume a stuck run");

    // Finishing.
    const finishing = new PuzzleRun({ seed: 7, paletteSize: PALETTE_SIZE });
    finishing.board.fill(1);
    finishing.recut();
    const summary = finishing.end();
    check(finishing.status === "over", "end() must finish the run");
    check(
        summary.shards === runShards(summary.score, summary.cleanPanes),
        "the summary must pay the documented shards",
    );
    check(finishing.place(0, 0, 0) === null, "a finished run must refuse further placements");
    check(finishing.recut() === false, "a finished run must refuse a recut");
}

/** A clean pane is a firing that empties the panel, and it pays the bonus. */
function checkCleanPane() {
    const run = new PuzzleRun({ seed: 31, paletteSize: PALETTE_SIZE });
    // Leave exactly one empty cell in an otherwise empty top row, and nothing
    // else on the panel: placing a dot there fires the row and empties it.
    run.board.fill(0);
    for (let x = 1; x < BOARD_SIZE; x++) run.board[indexOf(x, 0)] = 1;

    const slot = run.tray.findIndex((cut) => cut && cut.piece.id === "dot");
    const dotSlot = slot >= 0 ? slot : forceDotIntoTray(run);
    const before = run.score;
    const result = run.place(dotSlot, 0, 0);
    check(result !== null, "the dot must be placeable into the last hole of the row");
    check(result.linesFired === 1, `expected one line fired, got ${result.linesFired}`);
    check(result.cleanPane === true, "emptying the panel must count as a clean pane");
    // 1 cell + 10 for the line + 250 clean pane, all at x1 for a first firing.
    check(result.score.total === 261, `a clean single line should score 261, scored ${result.score.total}`);
    check(run.score === before + 261, "the run total must include the clean-pane bonus");
    check(run.cleanPanes === 1, "the clean pane must be counted");
}

/** Recut until a dot appears; the bag always offers it on a nearly-full panel. */
function forceDotIntoTray(run) {
    for (let attempt = 0; attempt < 60; attempt++) {
        run.recut();
        const slot = run.tray.findIndex((cut) => cut && cut.piece.id === "dot");
        if (slot >= 0) return slot;
    }
    failures += 1;
    console.error("  FAIL  could not obtain a dot in 60 recuts");
    return 0;
}

// ---------------------------------------------------------------------------
// A greedy player, used for determinism and for the balance sweep
// ---------------------------------------------------------------------------

/**
 * Places the move that fires the most lines, breaking ties toward the placement
 * that leaves the panel emptiest around it. Not a good player — a consistent
 * one, which is what a balance sweep needs.
 */
function playGreedy(seed, { useHelpers = false } = {}) {
    const run = new PuzzleRun({ seed, paletteSize: PALETTE_SIZE });
    const trace = [];
    let budget = useHelpers ? 400 : 0;
    let recuts = 0;
    let guard = 0;

    while (run.status !== "over" && guard++ < 4_000) {
        if (run.status === "stuck") {
            if (useHelpers && budget >= RECUT_COST) {
                budget -= RECUT_COST;
                recuts += 1;
                run.recut();
                if (run.status === "stuck") run.end();
                continue;
            }
            run.end();
            break;
        }

        const best = bestMove(run);
        if (!best) {
            run.end();
            break;
        }
        const result = run.place(best.slot, best.x, best.y);
        if (!result) {
            run.end();
            break;
        }
        trace.push(`${best.slot}:${best.x},${best.y}:${result.totalScore}`);
    }

    const summary = run.summary();
    return { ...summary, recuts, trace: trace.join("|") };
}

function bestMove(run) {
    let best = null;
    for (let slot = 0; slot < run.tray.length; slot++) {
        const cut = run.tray[slot];
        if (!cut) continue;
        for (const spot of placements(run.board, cut.piece)) {
            const probe = run.boardSnapshot();
            place(probe, cut.piece, spot.x, spot.y, cut.colourIndex);
            const lines = fullLines(probe);
            const fired = lines.rows.length + lines.cols.length;
            if (fired > 0) clearLines(probe, lines);
            const score = fired * 1_000 - filledCount(probe);
            if (!best || score > best.score) best = { slot, x: spot.x, y: spot.y, score };
        }
    }
    return best;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const RECUT_COST = 60;

function sweep() {
    const runs = 400;
    const earnings = [];
    for (const useHelpers of [false, true]) {
        const scores = [];
        let lines = 0;
        let cleanPanes = 0;
        let shards = 0;
        let recuts = 0;
        for (let seed = 1; seed <= runs; seed++) {
            const result = playGreedy(seed, { useHelpers });
            scores.push(result.score);
            lines += result.linesFired;
            cleanPanes += result.cleanPanes;
            shards += result.shards;
            recuts += result.recuts;
        }
        scores.sort((x, y) => x - y);
        const at = (q) => scores[Math.min(scores.length - 1, Math.floor(scores.length * q))];
        const mean = Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length);
        earnings.push({ shards: shards / runs, score: mean, recuts: recuts / runs });
        console.log(
            `  ${useHelpers ? "with helpers   " : "no helpers     "} ` +
                `mean ${String(mean).padStart(5)}  p10 ${String(at(0.1)).padStart(5)}  ` +
                `p50 ${String(at(0.5)).padStart(5)}  p90 ${String(at(0.9)).padStart(5)}  ` +
                `max ${String(scores[scores.length - 1]).padStart(5)}  ` +
                `lines/run ${(lines / runs).toFixed(1)}  ` +
                `shards/run ${(shards / runs).toFixed(1)}  clean panes ${cleanPanes}`,
        );
    }

    // The economy guardrail from DESIGN.md §5.1: a Recut must cost more shards
    // than the shards it earns back, or a banked player could play forever and
    // the score ceiling would be set by patience instead of skill.
    const [plain, helped] = earnings;
    const perRecut = (helped.shards - plain.shards) / Math.max(0.001, helped.recuts);
    console.log(
        `  recut economics  buys ${((helped.score - plain.score) / Math.max(0.001, helped.recuts)).toFixed(0)} pts ` +
            `= ${perRecut.toFixed(1)} shards for ${RECUT_COST} shards ` +
            `→ ${perRecut < RECUT_COST ? "loss-making (correct)" : "PROFITABLE — ECONOMY RUNS AWAY"}`,
    );
    check(perRecut < RECUT_COST, `a Recut must not pay for itself (returns ${perRecut.toFixed(1)} shards)`);
}

console.log("LEADLIGHT simulation");
checkPieces();
checkBoard();
checkScoring();
checkBag();
checkRun();

if (process.argv.includes("--sweep")) sweep();

if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
}
console.log("Simulation passed: cut set, panel, firing, scoring, bag solvability, and the run machine are intact.");
