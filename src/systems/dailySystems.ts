import { getRunCapabilities } from "../sdk/runSdk.ts";
import { store } from "../state/store.ts";
import { runtimeServices } from "./runtimeServices.ts";
import { saveSystem } from "./save.ts";
import { hasServerTime, localDayKey, serverNow } from "./serverTime.ts";

import { returnReminders } from "./retention/retentionConfig.ts";
/** The seven-day shard ladder — DESIGN.md §7. */
const REWARDS = [20, 25, 30, 40, 50, 60, 120] as const;
const inFlight = new Set<string>();

export interface TimeGate {
    ready: boolean;
    authoritative: boolean;
    day: string | null;
    label: string;
}

export interface QuestView {
    id: string;
    label: string;
    value: number;
    target: number;
    reward: number;
    claimed: boolean;
    claimable: boolean;
}

function gate(): TimeGate {
    const capabilities = getRunCapabilities();
    // The SDK's browser mock is useful for exercising API shapes, but its
    // clock is not authoritative. Treat it like local development so preview
    // claims remain usable and are labelled non-authoritative.
    const host = capabilities.host && !capabilities.mock;
    if (host && !hasServerTime())
        return { ready: false, authoritative: true, day: null, label: "WAITING FOR TRUSTED RUN TIME" };
    return {
        ready: true,
        authoritative: host,
        day: localDayKey(serverNow()),
        label: host ? "TRUSTED RUN TIME" : "LOCAL DEV FALLBACK · NON-AUTHORITATIVE",
    };
}

function previousDay(day: string): string {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
}

function ensureQuestDay(day: string): void {
    const state = store.get();
    if (state.dailyQuestDay === day) return;
    store.patch({ dailyQuestDay: day, dailyQuestProgress: {} });
    void saveSystem.flush();
}

async function commitGrant(id: string, shards: number, patch: Parameters<typeof store.patch>[0]): Promise<boolean> {
    if (inFlight.has(id)) return false;
    inFlight.add(id);
    const before = store.get();
    store.patch({ ...patch, shards: before.shards + shards });
    const saved = await saveSystem.flush();
    if (!saved) {
        store.patch({
            shards: before.shards,
            dailyRewardLastClaimDay: before.dailyRewardLastClaimDay,
            dailyRewardStreak: before.dailyRewardStreak,
            dailyRewardClaimIds: before.dailyRewardClaimIds,
            dailyQuestClaimIds: before.dailyQuestClaimIds,
        });
    }
    inFlight.delete(id);
    return saved;
}

export const dailySystems = {
    timeGate(): TimeGate {
        return gate();
    },

    rewardView() {
        const time = gate();
        const state = store.get();
        if (!time.ready || !time.day)
            return { ...time, claimed: false, streak: state.dailyRewardStreak, reward: REWARDS[0] };
        const claimId = `daily-reward:${time.day}`;
        const claimed = state.dailyRewardClaimIds.includes(claimId);
        const nextStreak = state.dailyRewardLastClaimDay === previousDay(time.day) ? state.dailyRewardStreak + 1 : 1;
        const rewardIndex = (Math.max(1, nextStreak) - 1) % REWARDS.length;
        return {
            ...time,
            claimed,
            streak: claimed ? state.dailyRewardStreak : nextStreak,
            reward: REWARDS[rewardIndex] ?? REWARDS[0],
        };
    },

    async claimDailyReward(): Promise<{ ok: boolean; reason: string; shards: number }> {
        const view = this.rewardView();
        if (!runtimeServices.config.dailyRewardsEnabled) return { ok: false, reason: "DISABLED BY LIVEOPS", shards: 0 };
        if (!view.ready || !view.day) return { ok: false, reason: view.label, shards: 0 };
        const claimId = `daily-reward:${view.day}`;
        if (view.claimed || store.get().dailyRewardClaimIds.includes(claimId))
            return { ok: false, reason: "ALREADY CLAIMED", shards: 0 };
        const state = store.get();
        const ok = await commitGrant(claimId, view.reward, {
            dailyRewardLastClaimDay: view.day,
            dailyRewardStreak: view.streak,
            dailyRewardClaimIds: [...state.dailyRewardClaimIds, claimId].slice(-90),
        });
        if (ok)
            runtimeServices.track("daily_reward_claimed", {
                streak: view.streak,
                shards: view.reward,
                authoritative: view.authoritative,
            });
        // Kill switch: the 24h reminder promises this reward. Leaving it scheduled
        // pings the player about something they just claimed, which is exactly how
        // a useful notification becomes a muted one.
        void returnReminders.cancel("d1");
        return { ok, reason: ok ? "CLAIMED" : "SAVE FAILED", shards: ok ? view.reward : 0 };
    },

    recordQuestProgress(id: "runs" | "lines" | "combos", amount = 1): void {
        const time = gate();
        if (!time.ready || !time.day || !runtimeServices.config.dailyQuestsEnabled) return;
        ensureQuestDay(time.day);
        const state = store.get();
        const progress = {
            ...state.dailyQuestProgress,
            [id]: Math.max(0, (state.dailyQuestProgress[id] ?? 0) + amount),
        };
        store.patch({ dailyQuestProgress: progress });
        void saveSystem.flush();
    },

    quests(): QuestView[] {
        const time = gate();
        const state = store.get();
        const definitions = [
            { id: "runs", label: "FINISH 3 RUNS", target: 3, reward: 30 },
            { id: "lines", label: "FIRE 20 LINES", target: 20, reward: 35 },
            { id: "combos", label: "REACH A x2 COMBO 3 TIMES", target: 3, reward: 40 },
        ];
        return definitions.map((quest) => {
            const claimId = `daily-quest:${time.day ?? "untrusted"}:${quest.id}`;
            const value = state.dailyQuestProgress[quest.id] ?? 0;
            const claimed = state.dailyQuestClaimIds.includes(claimId);
            return { ...quest, value, claimed, claimable: time.ready && !claimed && value >= quest.target };
        });
    },

    async claimQuest(questId: string): Promise<{ ok: boolean; reason: string; shards: number }> {
        const time = gate();
        if (!runtimeServices.config.dailyQuestsEnabled) return { ok: false, reason: "DISABLED BY LIVEOPS", shards: 0 };
        if (!time.ready || !time.day) return { ok: false, reason: time.label, shards: 0 };
        const quest = this.quests().find((entry) => entry.id === questId);
        if (!quest || !quest.claimable)
            return { ok: false, reason: quest?.claimed ? "ALREADY CLAIMED" : "NOT COMPLETE", shards: 0 };
        const claimId = `daily-quest:${time.day}:${quest.id}`;
        const state = store.get();
        const ok = await commitGrant(claimId, quest.reward, {
            dailyQuestClaimIds: [...state.dailyQuestClaimIds, claimId].slice(-180),
        });
        if (ok)
            runtimeServices.track("daily_quest_claimed", {
                quest_id: quest.id,
                shards: quest.reward,
                authoritative: time.authoritative,
            });
        return { ok, reason: ok ? "CLAIMED" : "SAVE FAILED", shards: ok ? quest.reward : 0 };
    },
};
