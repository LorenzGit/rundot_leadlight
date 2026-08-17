import { submitLeaderboardScore } from "../sdk/runSdk.ts";
/**
 * The bridge between the rules, the scene, and everything outside the canvas.
 *
 * `PuzzleRun` owns legality. `PanelScene` owns presentation. This owns the
 * consequences: what a placement does to the store, what a helper costs, what a
 * finished run pays, and which ad may be offered where.
 *
 * Every grant here is one-way: shards are debited before a helper runs, and an
 * ad reward is applied only on an SDK-confirmed completion.
 */
import { audioManager, type SfxCue } from "../audio/audioManager.ts";
import { analytics } from "../systems/analytics/analyticsConfig.ts";
import { store } from "../state/store.ts";
import { maybeShowInterstitial, recordCompletedRun, rewardedAvailable, showRewarded } from "../systems/ads.ts";
import { dailySystems } from "../systems/dailySystems.ts";
import { PLACEMENT } from "../systems/monetization/config.ts";
import { monetizationTelemetry } from "../systems/monetization/runtime.ts";
import { runtimeServices } from "../systems/runtimeServices.ts";
import { saveSystem } from "../systems/save.ts";
import { PALETTE_COLOURS } from "./art/palette.ts";
import { NoiseRandom } from "./noiseRandom.ts";
import { PuzzleRun, type RunSummary } from "./puzzle/run.ts";
import type { PanelScene, SceneSfx } from "./scene/panelScene.ts";

/** Helper prices — DESIGN.md §5.2. */
export const CHISEL_COST = 40;
export const RECUT_COST = 60;

const SFX_FOR_SCENE: Readonly<Record<SceneSfx, SfxCue>> = {
    pick: "pick",
    place: "place",
    reject: "reject",
    fire: "fire",
    combo: "combo",
    chisel: "chisel",
    clean: "clean",
};

export type HelperResult = "done" | "armed" | "cancelled" | "too-poor" | "unavailable";

export class RunController {
    private run: PuzzleRun;
    private scene: PanelScene | null = null;
    private startedAt = performance.now();
    private finished = false;

    constructor(seed?: number) {
        this.run = new PuzzleRun({ seed: seed ?? freshSeed(), paletteSize: PALETTE_COLOURS });
    }

    /** The run the scene must render. Handed to `PanelScene` at construction. */
    get puzzleRun(): PuzzleRun {
        return this.run;
    }

    attach(scene: PanelScene): void {
        this.scene = scene;
        this.publish();
        runtimeServices.track("run_started", {
            seed: this.run.seed,
            palette: store.get().selectedPalette,
        });
        analytics.funnelStep("leadlight_first_run", 2);
        analytics.funnelStep("leadlight_first_run_detail", 1);
    }

    detach(): void {
        this.scene = null;
    }

    // -----------------------------------------------------------------------
    // Scene callbacks
    // -----------------------------------------------------------------------

    readonly sceneCallbacks = {
        onPlaced: (): void => {
            analytics.funnelStep("leadlight_first_run_detail", 2);
            this.publish();
        },
        onChiselled: (): void => {
            // The shards were debited when the chisel was armed; this is the
            // strike that spends them for real.
            runtimeServices.track("helper_used", { kind: "chisel", shards_after: store.get().shards });
            this.publish();
            void saveSystem.flush();
        },
        onChiselModeChanged: (armed: boolean): void => {
            store.patch({ chiselArmed: armed });
        },
        onDragChanged: (active: boolean): void => {
            store.patch({ dragging: active });
        },
        sfx: (cue: SceneSfx): void => {
            audioManager.play(SFX_FOR_SCENE[cue]);
        },
        haptic: (style: Parameters<typeof runtimeServices.haptic>[0]): void => {
            void runtimeServices.haptic(style);
        },
    };

    /** Mirror the run into the store so the DOM HUD can render it. */
    private publish(): void {
        // Line milestones are read here rather than from a dedicated callback:
        // publish() is the single place run progress is mirrored out, and the
        // once-ever marks make repeat calls at the same count free.
        if (this.run.linesFired >= 1) analytics.funnelStep("leadlight_first_run_detail", 3);
        if (this.run.linesFired >= 5) analytics.funnelStep("leadlight_first_run_detail", 4);
        audioManager.setComboLevel(this.run.combo);
        store.patch({
            runStatus: this.run.status,
            score: this.run.score,
            combo: this.run.combo,
            runLines: this.run.linesFired,
            secondFiringAvailable: this.run.secondFiringAvailable && rewardedAvailable(PLACEMENT.secondFiring),
        });
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Arm (or disarm) the chisel. The shards are spent when a cell is struck. */
    toggleChisel(): HelperResult {
        const scene = this.scene;
        if (!scene || this.run.status === "over") return "unavailable";
        if (scene.chiselIsArmed) {
            this.cancelChisel();
            return "cancelled";
        }
        if (store.get().shards < CHISEL_COST) {
            store.patch({ toast: `THE CHISEL COSTS ${CHISEL_COST} SHARDS` });
            audioManager.play("reject");
            return "too-poor";
        }
        // Debit on arming, refund on cancel: charging on the strike would let a
        // player arm, background the game, and strike with a stale balance.
        this.spend(CHISEL_COST);
        scene.setChiselArmed(true);
        audioManager.play("pick");
        return "armed";
    }

    /** Cancelling an armed chisel gives the shards straight back. */
    cancelChisel(): void {
        const scene = this.scene;
        if (!scene?.chiselIsArmed) return;
        scene.setChiselArmed(false);
        this.grant(CHISEL_COST);
    }

    recut(): HelperResult {
        if (!this.scene || this.run.status === "over") return "unavailable";
        if (store.get().shards < RECUT_COST) {
            store.patch({ toast: `A RECUT COSTS ${RECUT_COST} SHARDS` });
            audioManager.play("reject");
            return "too-poor";
        }
        this.spend(RECUT_COST);
        this.run.recut();
        this.scene.refresh();
        audioManager.play("place");
        void runtimeServices.haptic("medium");
        runtimeServices.track("helper_used", { kind: "recut", shards_after: store.get().shards });
        this.publish();
        void saveSystem.flush();
        return "done";
    }

    // -----------------------------------------------------------------------
    // Rewarded continue
    // -----------------------------------------------------------------------

    /**
     * The rewarded Second Firing. Nothing changes unless the SDK confirms the
     * video actually completed.
     */
    async watchSecondFiring(): Promise<"granted" | "declined" | "unavailable"> {
        if (!this.run.secondFiringAvailable) return "unavailable";
        monetizationTelemetry.record("offer_shown", { placement_id: PLACEMENT.secondFiring });
        const result = await showRewarded(PLACEMENT.secondFiring);
        if (result !== "verified") {
            // A cancel is the player actively turning the offer down — the one
            // signal that separates a weak offer from missing ad inventory.
            if (result === "cancelled") {
                monetizationTelemetry.record("offer_dismissed", {
                    placement_id: PLACEMENT.secondFiring,
                    reason: "player_cancelled",
                });
            }
            this.publish();
            return result === "cancelled" ? "declined" : "unavailable";
        }

        const before = this.run.boardSnapshot();
        const cleared = this.run.secondFiring();
        if (!cleared) return "unavailable";
        monetizationTelemetry.record("reward_claimed", {
            placement_id: PLACEMENT.secondFiring,
            reward_id: "second_firing",
            cells_cleared: cleared.length,
        });
        this.scene?.refresh();
        this.scene?.celebrateSecondFiring(cleared, before);
        void runtimeServices.haptic("success");
        this.publish();
        return "granted";
    }

    // -----------------------------------------------------------------------
    // Finishing
    // -----------------------------------------------------------------------

    /** The player accepts the end of a stuck run. Idempotent. */
    finish(): RunSummary {
        const summary = this.run.status === "over" ? this.run.summary() : this.run.end();
        if (this.finished) return summary;
        this.finished = true;

        const state = store.get();
        // A beaten personal best is the progression beat that predicts a next
        // session; recording it separately from run_ended makes "did this run
        // matter to the player" answerable without reconstructing it from scores.
        if (summary.score > state.bestScore) {
            analytics.event("milestone_reached", {
                milestone: "best_score",
                value: summary.score,
                previous: state.bestScore,
            });
        }
        store.patch({
            runStatus: "over",
            runSummary: summary,
            culletDoubled: false,
            shards: state.shards + summary.shards,
            bestScore: Math.max(state.bestScore, summary.score),
            bestCombo: Math.max(state.bestCombo, summary.bestCombo),
            runsPlayed: state.runsPlayed + 1,
            linesFired: state.linesFired + summary.linesFired,
            cleanPanes: state.cleanPanes + summary.cleanPanes,
            chiselArmed: false,
        });

        dailySystems.recordQuestProgress("runs");
        dailySystems.recordQuestProgress("lines", summary.linesFired);
        if (summary.bestCombo >= 2) dailySystems.recordQuestProgress("combos");

        recordCompletedRun();
        audioManager.play(summary.score > state.bestScore && summary.score > 0 ? "reward" : "gameover");
        void runtimeServices.haptic(summary.score > state.bestScore ? "success" : "warning");
        // Boards were configured but nothing ever submitted, so they read as
        // "zero scored players". Fire-and-forget: never blocks results.
        void submitLeaderboardScore(summary.score, (performance.now() - this.startedAt) / 1000);
        // Canonical loop name alongside the game's own; only run_completed
        // reaches RUN's core-loop query.
        runtimeServices.track("run_completed", {
            score: summary.score,
            lines: summary.linesFired,
            duration_ms: Math.round(performance.now() - this.startedAt),
        });
        runtimeServices.track("run_ended", {
            score: summary.score,
            lines: summary.linesFired,
            best_combo: summary.bestCombo,
            clean_panes: summary.cleanPanes,
            pieces: summary.piecesPlaced,
            shards: summary.shards,
            second_firing_used: summary.secondFiringUsed,
            duration_ms: Math.round(performance.now() - this.startedAt),
        });
        analytics.funnelStep("leadlight_first_run", 3);
        analytics.funnelStep("leadlight_first_run_detail", 5, {
            lines: summary.linesFired,
            pieces: summary.piecesPlaced,
        });
        analytics.funnelStep("engagement", store.get().runsPlayed, { score: summary.score });
        void saveSystem.flush();
        return summary;
    }

    /**
     * Double the shards this run paid. Verified completion only, once per run.
     */
    async watchDoubleCullet(): Promise<"granted" | "declined" | "unavailable"> {
        const state = store.get();
        const summary = state.runSummary;
        if (!summary || state.culletDoubled || summary.shards <= 0) return "unavailable";
        monetizationTelemetry.record("offer_shown", { placement_id: PLACEMENT.doubleCullet });
        const result = await showRewarded(PLACEMENT.doubleCullet);
        if (result !== "verified") return result === "cancelled" ? "declined" : "unavailable";

        monetizationTelemetry.record("reward_claimed", {
            placement_id: PLACEMENT.doubleCullet,
            reward_id: "shards_double",
            amount: summary.shards,
        });
        store.patch({ culletDoubled: true, shards: store.get().shards + summary.shards });
        audioManager.play("clean");
        void runtimeServices.haptic("success");
        void saveSystem.flush();
        return "granted";
    }

    /** Dismissing the results card is the interstitial's only natural break. */
    async leaveResults(): Promise<void> {
        store.patch({ runSummary: null, phase: "menu", menuScreen: "main" });
        await saveSystem.flush();
        await maybeShowInterstitial();
    }

    // -----------------------------------------------------------------------

    private spend(amount: number): void {
        store.patch({ shards: Math.max(0, store.get().shards - amount) });
    }

    private grant(amount: number): void {
        store.patch({ shards: store.get().shards + amount });
    }
}

/**
 * Run seeds are ordinary game randomness, not a security identifier, but they
 * must differ per run — `NoiseRandom`'s default constructor seeds from the
 * clock, which is exactly what a fresh run wants.
 */
function freshSeed(): number {
    return new NoiseRandom().nextUint();
}
