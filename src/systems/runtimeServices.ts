/**
 * Background platform work: LiveOps, trusted time, notifications, analytics,
 * haptics, and the commerce refresh.
 *
 * Everything here is fire-and-forget and fails closed. Nothing in this module
 * may block boot or throw into gameplay.
 */
import packageJson from "../../package.json";
import {
    cancelLocalNotification,
    readNotificationPermission,
    fetchLiveOps,
    getRunCapabilities,
    type HapticStyle,
    recordAnalytics,
    recordFunnelStep,
    triggerHaptic,
} from "../sdk/runSdk.ts";
import { store } from "../state/store.ts";
import { reconcilePendingPurchase, refreshCommerce } from "./commerce.ts";
import { applyMonetizationLiveOps } from "./monetization/runtime.ts";
import { returnReminders } from "./retention/retentionConfig.ts";
import { refreshServerTime } from "./serverTime.ts";

export interface RuntimeConfig {
    dailyRewardsEnabled: boolean;
    dailyQuestsEnabled: boolean;
}

// The return-reminder cadence is deliberately NOT remoteable: it is fixed at
// 24/48/72h in returnReminders.ts. A parsed-but-unused delay knob sat here for
// a while and misled LiveOps operators into "tuning" a value nothing read.
const DEFAULTS: Readonly<RuntimeConfig> = Object.freeze({
    dailyRewardsEnabled: true,
    dailyQuestsEnabled: true,
});

const LEGACY_RETURN_REMINDER_ID = "leadlight-return-reminder";

let config: RuntimeConfig = { ...DEFAULTS };
let nextRefreshTimer = 0;

function clearScheduledRefresh(): void {
    if (!nextRefreshTimer) return;
    window.clearTimeout(nextRefreshTimer);
    nextRefreshTimer = 0;
}

function normalize(values: Record<string, unknown>): RuntimeConfig {
    const root =
        values.leadlight_runtime && typeof values.leadlight_runtime === "object"
            ? (values.leadlight_runtime as Record<string, unknown>)
            : values;
    return {
        dailyRewardsEnabled: typeof root.dailyRewardsEnabled === "boolean" ? root.dailyRewardsEnabled : true,
        dailyQuestsEnabled: typeof root.dailyQuestsEnabled === "boolean" ? root.dailyQuestsEnabled : true,
    };
}

async function refreshLiveOps(): Promise<void> {
    clearScheduledRefresh();
    const snapshot = await fetchLiveOps();
    if (!snapshot) {
        // KEEP the live config (and monetization controls) on a failed fetch:
        // resetting to defaults here yanked an enabled shop/ads surface for
        // the rest of the session on a single resume-time network blip. The
        // monetization runtime already boots all-disabled, so the fail-closed
        // launch state is unchanged. Retry only where a host could actually
        // answer — without the capability this null is permanent.
        store.patch({ runtimeReady: true });
        if (getRunCapabilities().liveops) {
            nextRefreshTimer = window.setTimeout(() => startRefreshCycle(), 60_000);
        }
        return;
    }
    config = normalize(snapshot.values);
    applyMonetizationLiveOps(snapshot.values);
    store.patch({ runtimeReady: true, runtimeConfigVersion: snapshot.configVersion });
    if (snapshot.nextChangeAt) {
        const delay = Math.max(1_000, Math.min(snapshot.nextChangeAt - Date.now() + 500, 2_147_000_000));
        nextRefreshTimer = window.setTimeout(() => startRefreshCycle(), delay);
    }
}

async function refreshTime(): Promise<void> {
    store.patch({ trustedTimeReady: await refreshServerTime() });
}

/**
 * Re-anchor the whole 24/48/72h return cadence to now.
 *
 * This replaced a single 24h reminder. One ping gives a player exactly one
 * chance to come back; a short cadence gives three without becoming spam, and
 * stopping at 72h is deliberate — a fourth converts nobody and costs the
 * notification permission the first three depend on.
 */
async function rearmNotifications(): Promise<void> {
    // The RUN app owns notification permission and shares it across every game,
    // so a player who allowed it anywhere has allowed it here. Read that state
    // (silently — only the setter prompts) instead of requiring a visit to a
    // Settings screen almost nobody opens.
    const granted = await readNotificationPermission();
    const state = store.get();
    store.patch({
        notificationsEnabled: granted && !state.notificationsOptOut,
        // A refused ask stays "denied" so Settings can offer OFF rather than
        // ASK; anything else the host reports as off is simply not-yet-asked.
        notificationsConsent: granted ? "granted" : state.notificationsConsent === "denied" ? "denied" : "unknown",
    });
    // Only the player's own opt-out stops the cadence. Scheduling without the
    // host permission is a no-op, so gating on it would buy nothing and would
    // silence every player whose grant lands after this read.
    if (state.notificationsOptOut) return;
    // The pre-cadence reminder used its own id; leave it scheduled and the
    // player gets the old generic ping alongside the new specific ones.
    await cancelLocalNotification(LEGACY_RETURN_REMINDER_ID);
    await returnReminders.refreshAll();
}

async function refreshRuntime(): Promise<void> {
    // LiveOps first: the monetization controls gate everything commerce shows.
    await Promise.allSettled([refreshTime(), refreshLiveOps()]);
    await Promise.allSettled([refreshCommerce(), rearmNotifications()]);
    await reconcilePendingPurchase();
}

function startRefreshCycle(): void {
    void refreshRuntime().catch((error) => {
        console.warn("[runtime] background refresh failed", error);
    });
}

export const runtimeServices = {
    get config(): Readonly<RuntimeConfig> {
        return config;
    },
    bootstrap(): void {
        startRefreshCycle();
        this.track("game_boot", { version: packageJson.version, host: getRunCapabilities().host });
        // Canonical core-loop name RUN's query filters on. The `game_loaded`
        // funnel step keeps its shipped name; this is the queryable event.
        this.track("game_opened", { version: packageJson.version });
    },
    resume(): void {
        startRefreshCycle();
    },
    rearmNotifications(): void {
        void rearmNotifications().catch((error) => {
            console.warn("[runtime] notification refresh failed", error);
        });
    },
    track(eventName: string, payload: Record<string, unknown> = {}): void {
        void recordAnalytics(eventName, { ...payload, build_version: packageJson.version });
    },
    funnel(step: number, name: string, funnel: string, funnelOrder = 0): void {
        void recordFunnelStep(step, name, funnel, funnelOrder);
    },
    async haptic(style: HapticStyle): Promise<boolean> {
        return store.get().hapticsEnabled ? triggerHaptic(style) : false;
    },
};
