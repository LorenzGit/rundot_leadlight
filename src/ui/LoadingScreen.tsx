/**
 * Loading screen shown while warmAssets() runs. Rendered by React, revealed
 * when the boot cover lifts, driven by store.loadProgress.
 *
 * The mark is a small leaded rose in CSS — the same motif the menu backdrop is
 * built around, so the first thing the player sees is already the game.
 */

import { GAME_NAME, GAME_TAGLINE } from "../game/constants.ts";
import { useStore } from "../state/store.ts";
import { t } from "../systems/localization.ts";

/** Sixteen cells of the rose motif, each with a stable id of its own. */
const ROSE: ReadonlyArray<{ id: string; colour: string; delay: number }> = [
    ["", "amber", "cobalt", ""],
    ["viridian", "rose", "plum", "ochre"],
    ["ochre", "plum", "rose", "viridian"],
    ["", "cobalt", "amber", ""],
].flatMap((row, y) => row.map((colour, x) => ({ id: `r${y}c${x}`, colour, delay: (x + y) * 90 })));

export default function LoadingScreen() {
    const progress = useStore((s) => s.loadProgress);
    const pct = Math.round(progress * 100);
    return (
        <main className="loading-screen pt-safe-top pb-safe-bottom">
            <div className="loading-mark" aria-hidden="true">
                {ROSE.map((cell) => (
                    <span
                        key={cell.id}
                        className={cell.colour ? `loading-cell ${cell.colour}` : "loading-cell empty"}
                        style={{ animationDelay: `${cell.delay}ms` }}
                    />
                ))}
            </div>
            <div className="loading-title">
                <strong>{GAME_NAME}</strong>
                <span>{GAME_TAGLINE}</span>
            </div>
            <div className="loading-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="loading-fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="loading-copy">
                {t("LoadingCopy")} {pct}%
            </p>
        </main>
    );
}
