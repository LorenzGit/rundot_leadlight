/** LEADLIGHT identity and the handful of numbers everything else derives from. */

export const GAME_NAME = "LEADLIGHT";
export const GAME_TAGLINE = "STAINED GLASS ATELIER";

/** DESIGN.md §2.1 — the panel is 8x8 and nothing may assume otherwise. */
export const BOARD_SIZE = 8;
export const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;

/** DESIGN.md §2.2 — the tray always holds three cuts, refilled as a set. */
export const TRAY_SIZE = 3;

export type QualityPreset = "high" | "low";
