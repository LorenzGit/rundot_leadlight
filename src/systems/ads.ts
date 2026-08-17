/**
 * Ad placements: two opt-in rewarded videos and one capped interstitial.
 *
 * Eligibility is evaluated here and nowhere else, so "will an ad play right
 * now" has exactly one implementation. Every gate in DESIGN.md §6.2 is
 * enforced: unlock thresholds, cooldowns, session and daily caps, first-session
 * exclusion, the run interval, ad-free ownership, and the LiveOps kill switch.
 *
 * Daily caps use RUN trusted time when the host provides it. Outside the host
 * the local day is used and gates nothing that costs the player anything — only
 * how often an optional video is offered.
 */
import { showVerifiedInterstitialAd, showVerifiedRewardedAd, type VerifiedActionResult } from "../sdk/runSdk.ts";
import { store } from "../state/store.ts";
import { ownsAdFree } from "./commerce.ts";
import {
    INTERSTITIAL_RUN_INTERVAL,
    PLACEMENT,
    PLACEMENT_DISPLAY_ID,
    type PlacementId,
    placements,
} from "./monetization/config.ts";
import { getMonetizationControls, monetizationTelemetry } from "./monetization/runtime.ts";
import { localDayKey, serverNow } from "./serverTime.ts";

import { analytics } from "./analytics/analyticsConfig.ts";
interface PlacementCounters {
    session: number;
    day: number;
    dayKey: string;
    lastShownAt: number;
}

/** Session counters are intentionally in-memory: a session IS one page life. */
const counters = new Map<PlacementId, PlacementCounters>();
/** Any ad — of any kind — spaces out every other ad. */
let lastAnyAdAt = 0;
const sessionStartedAt = performance.now();
/** Runs finished since this page loaded, used for first-session exclusion. */
let runsThisSession = 0;

function countersFor(id: PlacementId): PlacementCounters {
    const today = localDayKey(serverNow());
    const existing = counters.get(id);
    if (existing && existing.dayKey === today) return existing;
    const fresh: PlacementCounters = {
        session: existing?.session ?? 0,
        day: 0,
        dayKey: today,
        lastShownAt: existing?.lastShownAt ?? 0,
    };
    counters.set(id, fresh);
    return fresh;
}

export type AdBlockReason =
    | "ok"
    | "disabled"
    | "not-unlocked"
    | "cooldown"
    | "session-cap"
    | "daily-cap"
    | "owns-ad-free"
    | "first-session"
    | "not-due";

export function rewardedEligibility(id: PlacementId): AdBlockReason {
    const placement = placements.require(id);
    const controls = getMonetizationControls();
    if (!controls.enabled || !controls.rewardedAdsEnabled) return "disabled";
    if (controls.placements[id]?.enabled !== true) return "disabled";
    if (store.get().runsPlayed < placement.unlock.minCompletedSessions) return "not-unlocked";

    const state = countersFor(id);
    const remote = controls.placements[id];
    const cooldown = Math.max(placement.cooldownSeconds, remote?.cooldownSeconds ?? 0);
    if (cooldown > 0 && performance.now() - state.lastShownAt < cooldown * 1_000) return "cooldown";
    if (state.session >= Math.min(placement.sessionCap, remote?.sessionCap ?? placement.sessionCap)) {
        return "session-cap";
    }
    if (state.day >= Math.min(placement.dailyCap, remote?.dailyCap ?? placement.dailyCap)) return "daily-cap";
    return "ok";
}

/** True when the player should be shown the offer at all. */
export function rewardedAvailable(id: PlacementId): boolean {
    return rewardedEligibility(id) === "ok";
}

/**
 * Show a rewarded video. Resolves "verified" ONLY when the SDK confirms the
 * video completed; every other outcome grants nothing.
 */
export async function showRewarded(id: PlacementId): Promise<VerifiedActionResult> {
    if (!rewardedAvailable(id)) return "unavailable";
    const placement = placements.require(id);
    monetizationTelemetry.record("ad_requested", { placement_id: id, format: "rewarded" });
    // Portfolio-standard names alongside the game's own, so rewarded funnels
    // compare across titles. Offered-without-complete is a reward/copy problem;
    // no-offer-at-all is an inventory one, and only these two separate them.
    analytics.event("rewarded_ad_offered", { ad_display_id: PLACEMENT_DISPLAY_ID[id], placement: id });

    const result = await showVerifiedRewardedAd(PLACEMENT_DISPLAY_ID[id], placement.displayName);
    monetizationTelemetry.record("ad_result", { placement_id: id, format: "rewarded", result });
    if (result === "verified") {
        analytics.event("rewarded_ad_watched", { ad_display_id: PLACEMENT_DISPLAY_ID[id], placement: id });
    } else {
        analytics.event("rewarded_ad_dismissed", { ad_display_id: PLACEMENT_DISPLAY_ID[id], placement: id, result });
    }

    // A cancelled video still consumed an impression opportunity, so it counts
    // toward the caps; only a verified one grants anything.
    if (result === "verified" || result === "cancelled") {
        const state = countersFor(id);
        state.session += 1;
        state.day += 1;
        state.lastShownAt = performance.now();
        lastAnyAdAt = performance.now();
    }
    return result;
}

/**
 * The interstitial. It has exactly one trigger — dismissing the results card —
 * and it must clear every gate below before it fires.
 */
export function interstitialEligibility(): AdBlockReason {
    const placement = placements.require(PLACEMENT.betweenRuns);
    if (placement.type !== "interstitial") return "disabled";
    const controls = getMonetizationControls();
    if (!controls.enabled || !controls.interstitialAdsEnabled) return "disabled";
    if (controls.placements[PLACEMENT.betweenRuns]?.enabled !== true) return "disabled";
    if (ownsAdFree()) return "owns-ad-free";

    const state = store.get();
    if (state.runsPlayed < placement.unlock.minCompletedSessions) return "not-unlocked";
    // "First session" is the run of play that begins at boot. If every run this
    // player has ever finished happened since this page loaded, they are still
    // in their first session and see no interstitial at all.
    if (placement.excludeFirstSession && runsThisSession >= state.runsPlayed) return "first-session";
    if (state.runsPlayed % INTERSTITIAL_RUN_INTERVAL !== 0) return "not-due";

    const counter = countersFor(PLACEMENT.betweenRuns);
    const remote = controls.placements[PLACEMENT.betweenRuns];
    const cooldown = Math.max(placement.cooldownSeconds, remote?.cooldownSeconds ?? 0);
    // Spacing is measured against ANY ad, so a rewarded video the player just
    // opted into cannot be immediately followed by a mandatory one.
    if (performance.now() - Math.max(counter.lastShownAt, lastAnyAdAt) < cooldown * 1_000) return "cooldown";
    if (counter.session >= Math.min(placement.sessionCap, remote?.sessionCap ?? placement.sessionCap)) {
        return "session-cap";
    }
    if (counter.day >= Math.min(placement.dailyCap, remote?.dailyCap ?? placement.dailyCap)) return "daily-cap";
    // Never in the first 20 seconds of a session, whatever the counters say.
    if (performance.now() - sessionStartedAt < 20_000) return "cooldown";
    return "ok";
}

/** Called once per completed run, before eligibility is next evaluated. */
export function recordCompletedRun(): void {
    runsThisSession += 1;
}

export async function maybeShowInterstitial(): Promise<VerifiedActionResult> {
    const reason = interstitialEligibility();
    if (reason !== "ok") {
        monetizationTelemetry.record("ad_result", {
            placement_id: PLACEMENT.betweenRuns,
            format: "interstitial",
            result: "skipped",
            reason,
        });
        return "unavailable";
    }

    const placement = placements.require(PLACEMENT.betweenRuns);
    monetizationTelemetry.record("ad_requested", { placement_id: PLACEMENT.betweenRuns, format: "interstitial" });
    const result = await showVerifiedInterstitialAd(PLACEMENT_DISPLAY_ID[PLACEMENT.betweenRuns], placement.displayName);
    monetizationTelemetry.record("ad_result", { placement_id: PLACEMENT.betweenRuns, format: "interstitial", result });
    if (result === "verified") {
        analytics.event("interstitial_shown", { ad_display_id: PLACEMENT_DISPLAY_ID[PLACEMENT.betweenRuns] });
    }

    if (result === "verified") {
        const counter = countersFor(PLACEMENT.betweenRuns);
        counter.session += 1;
        counter.day += 1;
        counter.lastShownAt = performance.now();
        lastAnyAdAt = performance.now();
    }
    return result;
}

/** Development-only readout used by the diagnostics panel. */
export function adDiagnostics(): Record<string, string | number> {
    return {
        second_firing: rewardedEligibility(PLACEMENT.secondFiring),
        double_cullet: rewardedEligibility(PLACEMENT.doubleCullet),
        interstitial: interstitialEligibility(),
        runs_this_session: runsThisSession,
    };
}
