/**
 * Global UI state.
 *
 * The Pixi scene never renders from React and React never renders per frame:
 * the scene pushes the handful of numbers the HUD needs into this store after
 * each placement, and the store is the only channel between them.
 */
import { useSyncExternalStore } from "react";
import { DEFAULT_PALETTE, type PaletteId } from "../game/art/palette.ts";
import type { RunStatus, RunSummary } from "../game/puzzle/run.ts";

export type MenuScreen = "main" | "atelier" | "daily-rewards" | "daily-quests" | "stats" | "settings";

export interface PendingPurchaseIntent {
    productId: string;
    catalogItemId: string;
    idempotencyKey: string;
    startedAt: number;
}

export interface AppState {
    /** Boot and navigation state */
    phase: "loading" | "menu" | "playing";
    loadProgress: number;
    /** Game is paused by host lifecycle */
    paused: boolean;
    menuScreen: MenuScreen;

    /** Live run, mirrored from the scene. Meaningless outside `phase: playing`. */
    runStatus: RunStatus;
    score: number;
    combo: number;
    runLines: number;
    /** Set when a run finishes; drives the results card. */
    runSummary: RunSummary | null;
    /** True while the player has armed the chisel and must tap a cell. */
    chiselArmed: boolean;
    /**
     * True while a cut is being carried. The carried cut is drawn on the Pixi
     * canvas, which sits BELOW the React rail, so anything dragged over the
     * rail disappears behind the buttons. The rail steps out of the way for the
     * moment the drag lasts.
     */
    dragging: boolean;
    /** The rewarded continue has not been used in this run. */
    secondFiringAvailable: boolean;
    /** The results-screen shard doubling has been taken for this run. */
    culletDoubled: boolean;

    /** Persisted progress */
    bestScore: number;
    shards: number;
    runsPlayed: number;
    linesFired: number;
    cleanPanes: number;
    bestCombo: number;
    ownedPalettes: PaletteId[];
    selectedPalette: PaletteId;

    /** Player settings mirrored from save */
    musicEnabled: boolean;
    musicVolume: number;
    sfxEnabled: boolean;
    sfxVolume: number;
    notificationsEnabled: boolean;
    notificationsConsent: "unknown" | "granted" | "denied";
    hapticsEnabled: boolean;
    reducedMotion: boolean;
    locale: string;
    quality: "high" | "low";

    /** One-time toasts surfaced from systems/purchases/helpers */
    toast: string | null;

    /** Retention state */
    dailyRewardLastClaimDay: string | null;
    dailyRewardStreak: number;
    dailyRewardClaimIds: string[];
    dailyQuestDay: string | null;
    dailyQuestProgress: Record<string, number>;
    dailyQuestClaimIds: string[];

    /** Commerce */
    pendingPurchaseIntent: PendingPurchaseIntent | null;

    runtimeReady: boolean;
    runtimeConfigVersion: string | null;
    trustedTimeReady: boolean;
}

const listeners = new Set<() => void>();

let state: AppState = {
    phase: "loading",
    loadProgress: 0,
    paused: false,
    menuScreen: "main",

    runStatus: "playing",
    score: 0,
    combo: 0,
    runLines: 0,
    runSummary: null,
    chiselArmed: false,
    dragging: false,
    secondFiringAvailable: false,
    culletDoubled: false,

    bestScore: 0,
    shards: 0,
    runsPlayed: 0,
    linesFired: 0,
    cleanPanes: 0,
    bestCombo: 0,
    ownedPalettes: [DEFAULT_PALETTE],
    selectedPalette: DEFAULT_PALETTE,

    musicEnabled: true,
    musicVolume: 0.4,
    sfxEnabled: true,
    sfxVolume: 0.72,
    notificationsEnabled: false,
    notificationsConsent: "unknown",
    hapticsEnabled: true,
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    locale: "English",
    quality: "high",

    toast: null,
    dailyRewardLastClaimDay: null,
    dailyRewardStreak: 0,
    dailyRewardClaimIds: [],
    dailyQuestDay: null,
    dailyQuestProgress: {},
    dailyQuestClaimIds: [],

    pendingPurchaseIntent: null,

    runtimeReady: false,
    runtimeConfigVersion: null,
    trustedTimeReady: false,
};

export const store = {
    get(): AppState {
        return state;
    },

    patch(partial: Partial<AppState>): void {
        state = { ...state, ...partial };
        for (const l of listeners) l();
    },

    subscribe(l: () => void): () => void {
        listeners.add(l);
        return () => listeners.delete(l);
    },
};

export function useStore<T = AppState>(selector: (s: AppState) => T = (s) => s as unknown as T): T {
    return useSyncExternalStore(store.subscribe, () => selector(state));
}
