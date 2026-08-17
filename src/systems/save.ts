/**
 * Versioned persistence — DESIGN.md §9.
 *
 * RUN app storage when the host provides it, `localStorage` otherwise, and a
 * migrator that drops anything it does not recognise instead of trusting it.
 *
 * Ownership is deliberately absent from this file. Which palettes the player
 * BOUGHT is read from Entitlements every session; the save only remembers
 * which palette they earned with shards and which one they selected.
 */
import { DEFAULT_PALETTE, isPaletteId, PALETTES, type PaletteId } from "../game/art/palette.ts";
import { getRunCapabilities, readAppStorage, writeAppStorage } from "../sdk/runSdk.ts";
import { type AppState, type PendingPurchaseIntent, store } from "../state/store.ts";

const SAVE_KEY = "leadlight:save";
export const SAVE_VERSION = 1;

/** Quest ids the migrator will accept; anything else is discarded. */
const QUEST_IDS = ["runs", "lines", "combos"] as const;

export interface GameSaveV1 {
    version: 1;
    settings: Pick<
        AppState,
        | "musicEnabled"
        | "musicVolume"
        | "sfxEnabled"
        | "sfxVolume"
        | "notificationsEnabled"
        | "notificationsOptOut"
        | "notificationsConsent"
        | "hapticsEnabled"
        | "reducedMotion"
        | "locale"
        | "quality"
    >;
    progress: Pick<
        AppState,
        | "bestScore"
        | "shards"
        | "runsPlayed"
        | "linesFired"
        | "cleanPanes"
        | "bestCombo"
        | "ownedPalettes"
        | "selectedPalette"
    >;
    retention: Pick<
        AppState,
        | "dailyRewardLastClaimDay"
        | "dailyRewardStreak"
        | "dailyRewardClaimIds"
        | "dailyQuestDay"
        | "dailyQuestProgress"
        | "dailyQuestClaimIds"
    >;
    commerce: { pendingPurchaseIntent: PendingPurchaseIntent | null };
}

export type SaveSource = "run" | "local" | "defaults";

function clamp01(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(number))) : fallback;
}

function dayKeyOrNull(value: unknown): string | null {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function recentStrings(value: unknown, limit: number): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === "string" && entry.length <= 160).slice(-limit);
}

/** Earned palettes only. A palette the player bought is proven by entitlement. */
function paletteList(value: unknown): PaletteId[] {
    const known = new Set(PALETTES.map((entry) => entry.id));
    const list = Array.isArray(value) ? value.filter((entry): entry is PaletteId => isPaletteId(entry)) : [];
    const unique = [...new Set([DEFAULT_PALETTE, ...list])].filter((entry) => known.has(entry));
    return unique;
}

function pendingIntent(value: unknown): PendingPurchaseIntent | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<PendingPurchaseIntent>;
    if (
        typeof candidate.productId !== "string" ||
        typeof candidate.catalogItemId !== "string" ||
        typeof candidate.idempotencyKey !== "string" ||
        candidate.idempotencyKey.length === 0
    ) {
        return null;
    }
    return {
        productId: candidate.productId.slice(0, 64),
        catalogItemId: candidate.catalogItemId.slice(0, 128),
        idempotencyKey: candidate.idempotencyKey.slice(0, 128),
        startedAt: nonNegativeInteger(candidate.startedAt),
    };
}

function snapshot(): GameSaveV1 {
    const s = store.get();
    return {
        version: SAVE_VERSION,
        settings: {
            musicEnabled: s.musicEnabled,
            musicVolume: s.musicVolume,
            sfxEnabled: s.sfxEnabled,
            sfxVolume: s.sfxVolume,
            notificationsEnabled: s.notificationsEnabled,
            notificationsOptOut: s.notificationsOptOut,
            notificationsConsent: s.notificationsConsent,
            hapticsEnabled: s.hapticsEnabled,
            reducedMotion: s.reducedMotion,
            locale: s.locale,
            quality: s.quality,
        },
        progress: {
            bestScore: s.bestScore,
            shards: s.shards,
            runsPlayed: s.runsPlayed,
            linesFired: s.linesFired,
            cleanPanes: s.cleanPanes,
            bestCombo: s.bestCombo,
            ownedPalettes: s.ownedPalettes,
            selectedPalette: s.selectedPalette,
        },
        retention: {
            dailyRewardLastClaimDay: s.dailyRewardLastClaimDay,
            dailyRewardStreak: s.dailyRewardStreak,
            dailyRewardClaimIds: s.dailyRewardClaimIds,
            dailyQuestDay: s.dailyQuestDay,
            dailyQuestProgress: s.dailyQuestProgress,
            dailyQuestClaimIds: s.dailyQuestClaimIds,
        },
        commerce: { pendingPurchaseIntent: s.pendingPurchaseIntent },
    };
}

function migrate(raw: unknown): GameSaveV1 | null {
    if (!raw || typeof raw !== "object") return null;
    const candidate = raw as { version?: number } & Partial<Omit<GameSaveV1, "version">>;
    if (candidate.version !== SAVE_VERSION || !candidate.settings || !candidate.progress) return null;

    const defaults = snapshot();
    const retention: Partial<GameSaveV1["retention"]> =
        candidate.retention && typeof candidate.retention === "object" ? candidate.retention : {};
    const questProgress =
        retention.dailyQuestProgress && typeof retention.dailyQuestProgress === "object"
            ? Object.fromEntries(
                  Object.entries(retention.dailyQuestProgress)
                      .filter(
                          ([key, value]) =>
                              (QUEST_IDS as readonly string[]).includes(key) && Number.isFinite(Number(value)),
                      )
                      .map(([key, value]) => [key, nonNegativeInteger(value)]),
              )
            : {};

    const owned = paletteList(candidate.progress.ownedPalettes);
    const selected = isPaletteId(candidate.progress.selectedPalette)
        ? candidate.progress.selectedPalette
        : DEFAULT_PALETTE;

    return {
        version: SAVE_VERSION,
        settings: {
            musicEnabled: booleanOr(candidate.settings.musicEnabled, defaults.settings.musicEnabled),
            musicVolume: clamp01(candidate.settings.musicVolume, defaults.settings.musicVolume),
            sfxEnabled: booleanOr(candidate.settings.sfxEnabled, defaults.settings.sfxEnabled),
            sfxVolume: clamp01(candidate.settings.sfxVolume, defaults.settings.sfxVolume),
            hapticsEnabled: booleanOr(candidate.settings.hapticsEnabled, defaults.settings.hapticsEnabled),
            reducedMotion: booleanOr(candidate.settings.reducedMotion, defaults.settings.reducedMotion),
            locale: enumOr(
                candidate.settings.locale,
                ["English", "PortugueseBR", "SpanishLA"] as const,
                defaults.settings.locale,
            ),
            quality: enumOr(candidate.settings.quality, ["high", "low"] as const, defaults.settings.quality),
            notificationsConsent: enumOr(
                candidate.settings.notificationsConsent,
                ["unknown", "granted", "denied"] as const,
                defaults.settings.notificationsConsent,
            ),
            // Consent is the gate: an "enabled" flag without granted consent is
            // exactly the state a stale save would restore, so it is dropped.
            // Additive back-fill: saves written before the opt-out existed have
            // no field, and "absent" must mean "has not opted out" — defaulting
            // the other way would re-silence every existing player.
            notificationsOptOut: booleanOr(candidate.settings.notificationsOptOut, false),
            // Restored only so Settings paints something sane before the boot
            // probe lands; runtimeServices re-derives it from the live host
            // permission on the first refresh.
            notificationsEnabled: booleanOr(candidate.settings.notificationsEnabled, false),
        },
        progress: {
            bestScore: nonNegativeInteger(candidate.progress.bestScore),
            shards: nonNegativeInteger(candidate.progress.shards),
            runsPlayed: nonNegativeInteger(candidate.progress.runsPlayed),
            linesFired: nonNegativeInteger(candidate.progress.linesFired),
            cleanPanes: nonNegativeInteger(candidate.progress.cleanPanes),
            bestCombo: nonNegativeInteger(candidate.progress.bestCombo),
            ownedPalettes: owned,
            // A selection the player cannot prove they own reverts on load; the
            // entitlement pass in `commerce.ts` re-checks it once ownership syncs.
            selectedPalette: owned.includes(selected) ? selected : DEFAULT_PALETTE,
        },
        retention: {
            dailyRewardLastClaimDay: dayKeyOrNull(retention.dailyRewardLastClaimDay),
            dailyRewardStreak: nonNegativeInteger(retention.dailyRewardStreak),
            dailyRewardClaimIds: recentStrings(retention.dailyRewardClaimIds, 90),
            dailyQuestDay: dayKeyOrNull(retention.dailyQuestDay),
            dailyQuestProgress: questProgress,
            dailyQuestClaimIds: recentStrings(retention.dailyQuestClaimIds, 180),
        },
        commerce: { pendingPurchaseIntent: pendingIntent(candidate.commerce?.pendingPurchaseIntent) },
    };
}

function parse(raw: string | null): GameSaveV1 | null {
    if (!raw) return null;
    try {
        return migrate(JSON.parse(raw));
    } catch {
        return null;
    }
}

function apply(save: GameSaveV1): void {
    store.patch({ ...save.settings, ...save.progress, ...save.retention, ...save.commerce });
}

let lastSaved = "";
let pendingSave: string | null = null;
let flushInFlight: Promise<boolean> | null = null;

function usesRunStorage(): boolean {
    const capabilities = getRunCapabilities();
    return capabilities.storage && !capabilities.mock;
}

async function persist(serialized: string): Promise<boolean> {
    if (usesRunStorage()) return writeAppStorage(SAVE_KEY, serialized);
    try {
        window.localStorage.setItem(SAVE_KEY, serialized);
        return true;
    } catch (error) {
        console.warn("[save] local fallback write failed", error);
        return false;
    }
}

export const saveSystem = {
    async load(): Promise<SaveSource> {
        if (!usesRunStorage()) {
            let stored: string | null = null;
            try {
                stored = window.localStorage.getItem(SAVE_KEY);
            } catch (error) {
                console.warn("[save] local fallback read failed", error);
            }
            const save = parse(stored);
            if (save) apply(save);
            lastSaved = JSON.stringify(snapshot());
            return save ? "local" : "defaults";
        }

        const remote = await readAppStorage(SAVE_KEY);
        const save = remote.ok ? parse(remote.value) : null;
        if (save) apply(save);
        lastSaved = JSON.stringify(snapshot());
        return save ? "run" : "defaults";
    },

    /**
     * Coalesce rapid changes and serialize remote writes, so an older, slower
     * RPC can never land after and overwrite a newer one.
     */
    async flush(): Promise<boolean> {
        const serialized = JSON.stringify(snapshot());
        if (serialized === lastSaved && pendingSave === null) return true;
        pendingSave = serialized;
        if (flushInFlight) return flushInFlight;

        flushInFlight = (async () => {
            let allSucceeded = true;
            while (pendingSave !== null) {
                const next = pendingSave;
                pendingSave = null;
                if (next === lastSaved) continue;
                const saved = await persist(next);
                if (saved) lastSaved = next;
                else allSucceeded = false;
            }
            return allSucceeded;
        })().finally(() => {
            flushInFlight = null;
        });
        return flushInFlight;
    },
};
