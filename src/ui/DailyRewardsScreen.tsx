import { useState } from "react";
import { audioManager } from "../audio/audioManager.ts";
import { store, useStore } from "../state/store.ts";
import { dailySystems } from "../systems/dailySystems.ts";
import { t } from "../systems/localization.ts";
import { runtimeServices } from "../systems/runtimeServices.ts";
import MenuScreenLayout from "./MenuScreenLayout.tsx";

/** Mirrors the ladder in systems/dailySystems.ts — DESIGN.md §7. */
const REWARDS = [20, 25, 30, 40, 50, 60, 120];

export default function DailyRewardsScreen() {
    useStore((state) => `${state.locale}:${state.dailyRewardClaimIds.length}:${state.trustedTimeReady}`);
    const [busy, setBusy] = useState(false);
    const view = dailySystems.rewardView();

    const claim = async () => {
        await audioManager.unlock();
        setBusy(true);
        const result = await dailySystems.claimDailyReward();
        setBusy(false);
        store.patch({ toast: result.ok ? `+${result.shards} SHARDS` : result.reason });
        if (result.ok) {
            audioManager.play("reward");
            void runtimeServices.haptic("success");
        } else audioManager.play("reject");
    };

    return (
        <MenuScreenLayout title={t("MenuDailyRewards")} kicker={t("KickerDailyRewards")}>
            <p className="screen-copy">{t("DailyRewardsBody")}</p>
            <p className="authority-label">{view.label}</p>
            <div className="reward-track">
                {REWARDS.map((reward, index) => (
                    <div
                        className={`reward-day ${view.streak > 0 && (view.streak - 1) % REWARDS.length === index ? "current" : ""}`}
                        key={reward}
                    >
                        <span>
                            {t("LabelDay")} {index + 1}
                        </span>
                        <strong>{reward}</strong>
                        <small>{t("LabelShards")}</small>
                    </div>
                ))}
            </div>
            <button
                type="button"
                className="claim-action"
                disabled={busy || !view.ready || view.claimed}
                onClick={() => void claim()}
            >
                {busy ? t("Saving") : view.claimed ? t("ClaimedToday") : t("ClaimShards", { shards: view.reward })}
            </button>
            <p className="safety-note">{t("LocalClaimNote")}</p>
        </MenuScreenLayout>
    );
}
