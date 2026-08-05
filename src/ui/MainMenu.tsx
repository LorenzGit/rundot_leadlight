import packageJson from "../../package.json";
import { audioManager } from "../audio/audioManager.ts";
import { GAME_NAME, GAME_TAGLINE } from "../game/constants.ts";
import { type MenuScreen, store, useStore } from "../state/store.ts";
import { t } from "../systems/localization.ts";
import { runtimeServices } from "../systems/runtimeServices.ts";
import { saveSystem } from "../systems/save.ts";
import GearIcon from "./GearIcon.tsx";

type MenuIconName = "atelier" | "calendar" | "quests" | "stats" | "settings";

const destinations: Array<{ screen: MenuScreen; icon: MenuIconName; label: string; accent: string }> = [
    { screen: "atelier", icon: "atelier", label: "MenuAtelier", accent: "amber" },
    { screen: "daily-rewards", icon: "calendar", label: "MenuDailyRewards", accent: "viridian" },
    { screen: "daily-quests", icon: "quests", label: "MenuDailyQuests", accent: "cobalt" },
    { screen: "stats", icon: "stats", label: "MenuStats", accent: "rose" },
    { screen: "settings", icon: "settings", label: "MenuSettings", accent: "plum" },
];

function MenuIcon({ name }: { name: MenuIconName }) {
    if (name === "atelier") {
        return (
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 4h16v16H4z" />
                <path d="M12 4v16M4 12h16M8 4l8 16M16 4 8 20" />
            </svg>
        );
    }
    if (name === "calendar") {
        return (
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 3v3M18 3v3M4 8h16M5 5h14a2 2 0 0 1 2 2v12H3V7a2 2 0 0 1 2-2Z" />
                <path d="m8 14 2 2 5-5" />
            </svg>
        );
    }
    if (name === "quests") {
        return (
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4" />
            </svg>
        );
    }
    if (name === "stats") {
        return (
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 19V9h4v10M10 19V5h4v14M15 19v-7h4v7M3 19h18" />
            </svg>
        );
    }
    return <GearIcon />;
}

/**
 * Every menu action unlocks audio first: browsers only allow an AudioContext to
 * start inside a real gesture, and the first tap is the only one guaranteed to
 * be one.
 */
async function activate(action: () => void): Promise<void> {
    // Run the action IMMEDIATELY, then unlock/cue audio as a side effect.
    // A suspended AudioContext can leave resume() pending; navigation must
    // never wait on WebAudio.
    action();
    void audioManager.unlock().then(() => {
        audioManager.play("tap");
        void runtimeServices.haptic("light");
    });
}

export default function MainMenu() {
    useStore((state) => state.locale);
    const shards = useStore((state) => state.shards);
    const bestScore = useStore((state) => state.bestScore);

    const play = () =>
        void activate(() => {
            audioManager.play("start");
            store.patch({
                phase: "playing",
                score: 0,
                combo: 0,
                runLines: 0,
                runStatus: "playing",
                runSummary: null,
                chiselArmed: false,
                culletDoubled: false,
            });
            void saveSystem.flush();
        });

    return (
        <main className="menu-shell pt-safe-top pb-safe-bottom">
            <header className="menu-header">
                <p className="eyebrow">{GAME_TAGLINE}</p>
                <div className="menu-logo">
                    <h1>{GAME_NAME}</h1>
                </div>
                <p className="menu-subtitle">{t("MenuSubtitle")}</p>
            </header>

            <section className="player-strip" aria-label={t("PlayerSummary")}>
                <div className="player-best">
                    <span>{t("LabelBest")}</span>
                    <strong>{bestScore.toLocaleString()}</strong>
                </div>
                <div className="player-currency">
                    <span className="shard-glyph" aria-hidden="true" />
                    <strong>{shards.toLocaleString()}</strong>
                </div>
            </section>

            <button type="button" className="play-button" onClick={play}>
                <span>{t("ButtonPlay")}</span>
                <span className="play-glyph" aria-hidden="true">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m9 6 9 6-9 6V6Z" />
                    </svg>
                </span>
            </button>

            <nav className="menu-grid" aria-label={t("MenuNavLabel")}>
                {destinations.map(({ screen, icon, label, accent }) => (
                    <button
                        type="button"
                        className={`menu-tile menu-tile-${accent}`}
                        key={screen}
                        onClick={() => void activate(() => store.patch({ menuScreen: screen }))}
                    >
                        <span className="menu-icon" aria-hidden="true">
                            <MenuIcon name={icon} />
                        </span>
                        <span>{t(label)}</span>
                    </button>
                ))}
            </nav>

            <p className="build-stamp">v{packageJson.version}</p>
        </main>
    );
}
