/**
 * Development-only semantic browser contract for `scripts/visual-qa.mjs`.
 *
 * Two rules earned the hard way. The harness must ask the SCENE where things
 * are — computing tap positions from the viewport lands on empty bench, because
 * the SDK mock reports a phone-shaped safe area in `vite dev` and shifts the
 * whole layout. And every interaction assertion must prove something CHANGED
 * (`movesPlayed`), not merely that nothing threw.
 *
 * This surface may set up local test state. It must never fabricate a
 * successful RUN ad, purchase, entitlement, notification, or privileged
 * outcome, and it is stripped from production by the `import.meta.env.DEV`
 * gate around its installation.
 */
import packageJson from "../../package.json";
import { audioManager } from "../audio/audioManager.ts";
import { getPanelScene, getRunController } from "../game/GameCanvas.tsx";
import { rendererLifecycleSnapshot } from "../rendering/rendererLifecycle.ts";
import { getRunCapabilities } from "../sdk/runSdk.ts";
import { store } from "../state/store.ts";
import { adDiagnostics } from "../systems/ads.ts";
import { commerceDiagnostics } from "../systems/commerce.ts";
import { saveSystem } from "../systems/save.ts";

interface LeadlightQa {
    snapshot(): Record<string, unknown>;
    /** Real client-space positions of the tray and of one legal drop. */
    geometry(): Record<string, unknown> | null;
    startRun(): void;
    openScreen(screen: string): void;
    returnToMenu(): void;
    /** Grant shards so the helper surfaces can be exercised locally. */
    grantShards(amount: number): void;
    /** Force the run into the stuck state, to review that card. */
    forceStuck(): void;
    /** End the run locally, to review the results card. */
    forceResults(): void;
    /** Paint a full spread of glass so the lattice joins can be reviewed. */
    fillBoardForReview(): void;
    /** Play the firing choreography without needing a real line clear. */
    previewFiring(rows: number[], columns: number[], combo?: number): void;
    unlockAudio(): Promise<boolean>;
    setSetting(key: string, value: unknown): Promise<boolean>;
}

declare global {
    // Development-only semantic browser contract. Never present in production.
    var __gameQa: LeadlightQa | undefined;
}

export function installBrowserQaContract(): void {
    if (!import.meta.env.DEV || new URLSearchParams(window.location.search).get("qa") !== "1") return;
    document.documentElement.dataset.qaContract = "ready";
    globalThis.__gameQa = {
        snapshot() {
            const state = store.get();
            return {
                version: packageJson.version,
                phase: state.phase,
                menuScreen: state.menuScreen,
                paused: state.paused,
                runStatus: state.runStatus,
                score: state.score,
                combo: state.combo,
                shards: state.shards,
                bestScore: state.bestScore,
                runsPlayed: state.runsPlayed,
                selectedPalette: state.selectedPalette,
                reducedMotion: state.reducedMotion,
                hapticsEnabled: state.hapticsEnabled,
                musicEnabled: state.musicEnabled,
                sfxEnabled: state.sfxEnabled,
                quality: state.quality,
                locale: state.locale,
                movesPlayed: getPanelScene()?.movesPlayed ?? 0,
                effectsActive: getPanelScene()?.effectsActive ?? 0,
                renderer: document.documentElement.dataset.renderer ?? "pending",
                rendererLifecycle: rendererLifecycleSnapshot(),
                host: getRunCapabilities().host,
                audio: audioManager.debugSnapshot(),
                ads: adDiagnostics(),
                commerce: commerceDiagnostics(),
            };
        },
        geometry() {
            return getPanelScene()?.qaGeometry() ?? null;
        },
        startRun() {
            store.patch({
                phase: "playing",
                menuScreen: "main",
                score: 0,
                combo: 0,
                runLines: 0,
                runStatus: "playing",
                runSummary: null,
            });
        },
        openScreen(screen) {
            store.patch({ phase: "menu", menuScreen: screen as never });
        },
        returnToMenu() {
            store.patch({ phase: "menu", menuScreen: "main", runSummary: null });
        },
        grantShards(amount) {
            store.patch({ shards: Math.max(0, store.get().shards + Math.floor(amount)) });
        },
        forceStuck() {
            const controller = getRunController();
            if (!controller) return;
            // Fill the panel outright: nothing can fit, which is the definition
            // of stuck. This only ever runs against a local dev run.
            controller.puzzleRun.board.fill(1);
            controller.puzzleRun.recut();
            getPanelScene()?.refresh();
            store.patch({ runStatus: controller.puzzleRun.status });
        },
        forceResults() {
            const controller = getRunController();
            if (!controller) return;
            controller.puzzleRun.board.fill(1);
            controller.puzzleRun.recut();
            controller.finish();
        },
        fillBoardForReview() {
            const controller = getRunController();
            if (!controller) return;
            const board = controller.puzzleRun.board;
            // Every colour, in a pattern that puts each next to a different
            // neighbour, so the came between two filled cells is what shows.
            for (let i = 0; i < board.length; i++) board[i] = ((i * 3 + Math.floor(i / 8)) % 6) + 1;
            getPanelScene()?.refresh();
        },
        previewFiring(rows, columns, combo = 1) {
            getPanelScene()?.previewFiring(rows, columns, combo);
        },
        unlockAudio() {
            return audioManager.unlock();
        },
        async setSetting(key, value) {
            store.patch({ [key]: value } as never);
            if (key === "reducedMotion") document.documentElement.dataset.reducedMotion = String(value);
            return saveSystem.flush();
        },
    };
}
