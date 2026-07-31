import { useStore } from "../state/store.ts";
import { t } from "../systems/localization.ts";
import MenuScreenLayout from "./MenuScreenLayout.tsx";

export default function StatsScreen() {
    const state = useStore((value) => value);
    const stats: Array<[string, string | number]> = [
        [t("StatBestScore"), state.bestScore.toLocaleString()],
        [t("StatBestCombo"), `x${state.bestCombo}`],
        [t("StatRuns"), state.runsPlayed.toLocaleString()],
        [t("StatLines"), state.linesFired.toLocaleString()],
        [t("StatCleanPanes"), state.cleanPanes.toLocaleString()],
        [t("LabelShards"), state.shards.toLocaleString()],
    ];
    return (
        <MenuScreenLayout title={t("MenuStats")} kicker={t("KickerStats")}>
            <p className="screen-copy">{t("StatsBody")}</p>
            <div className="stats-grid">
                {stats.map(([label, value]) => (
                    <article key={label}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                    </article>
                ))}
            </div>
        </MenuScreenLayout>
    );
}
