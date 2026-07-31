import { useState } from "react";
import { audioManager } from "../audio/audioManager.ts";
import { store, useStore } from "../state/store.ts";
import { dailySystems } from "../systems/dailySystems.ts";
import { t } from "../systems/localization.ts";
import { runtimeServices } from "../systems/runtimeServices.ts";
import MenuScreenLayout from "./MenuScreenLayout.tsx";

export default function DailyQuestsScreen() {
    useStore(
        (state) =>
            `${state.locale}:${JSON.stringify(state.dailyQuestProgress)}:${state.dailyQuestClaimIds.length}:${state.trustedTimeReady}`,
    );
    const [busyId, setBusyId] = useState<string | null>(null);
    const time = dailySystems.timeGate();
    const quests = dailySystems.quests();

    const claim = async (questId: string) => {
        await audioManager.unlock();
        setBusyId(questId);
        const result = await dailySystems.claimQuest(questId);
        setBusyId(null);
        store.patch({ toast: result.ok ? `+${result.shards} SHARDS` : result.reason });
        if (result.ok) {
            audioManager.play("reward");
            void runtimeServices.haptic("success");
        } else audioManager.play("reject");
    };

    return (
        <MenuScreenLayout title={t("MenuDailyQuests")} kicker={t("KickerDailyQuests")}>
            <p className="screen-copy">{t("DailyQuestsBody")}</p>
            <p className="authority-label">{time.label}</p>
            <div className="quest-list">
                {quests.map((quest) => (
                    <article className="quest-card" key={quest.id}>
                        <div>
                            <strong>{quest.label}</strong>
                            <span>
                                {Math.min(quest.value, quest.target)} / {quest.target}
                            </span>
                        </div>
                        <progress value={Math.min(quest.value, quest.target)} max={quest.target} />
                        <button
                            type="button"
                            disabled={busyId !== null || !quest.claimable}
                            onClick={() => void claim(quest.id)}
                        >
                            {busyId === quest.id
                                ? t("Saving")
                                : quest.claimed
                                  ? t("Claimed")
                                  : quest.claimable
                                    ? t("ClaimShards", { shards: quest.reward })
                                    : t("InProgress")}
                        </button>
                    </article>
                ))}
            </div>
        </MenuScreenLayout>
    );
}
