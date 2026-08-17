/**
 * Screen router. One phase visible at a time; the 'playing' phase stacks the
 * React HUD above the Pixi canvas.
 *
 * #app-frame (styled in styles/app.css) is the playable frame: portrait-first
 * with a dedicated landscape layout, centred over a full-bleed backdrop.
 * Everything interactive — canvas and DOM UI — lives inside the frame, so safe
 * areas and input never leak into decorative side art.
 */
import { lazy, Suspense, useEffect } from "react";
import GameCanvas, { resyncSceneInsets } from "../game/GameCanvas.tsx";
import { applyRunSafeArea } from "../sdk/runSdk.ts";
import { store, useStore } from "../state/store.ts";
import AtelierScreen from "./AtelierScreen.tsx";
import DailyQuestsScreen from "./DailyQuestsScreen.tsx";
import DailyRewardsScreen from "./DailyRewardsScreen.tsx";
import Hud from "./Hud.tsx";
import LoadingScreen from "./LoadingScreen.tsx";
import MainMenu from "./MainMenu.tsx";
import SettingsScreen from "./SettingsScreen.tsx";
import StatsScreen from "./StatsScreen.tsx";
import { analytics } from "../systems/analytics/analyticsConfig.ts";

const DevelopmentTools = import.meta.env.DEV ? lazy(() => import("../dev/DevelopmentTools.tsx")) : null;

/**
 * The published insets are measured against #app-frame (see getFrameSafeArea),
 * so they are only correct once the frame exists and must be re-read whenever
 * the frame or the visible box moves — not just on rotation. Boot calls
 * applyRunSafeArea before React has rendered anything, so the mount pass here
 * is the first measurement that can see the frame at all; and a host toolbar
 * sliding away changes the visual viewport without firing a window resize.
 */
function useOrientationSafeArea(): void {
    useEffect(() => {
        let frame = 0;
        const refreshSafeArea = () => {
            window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(() => {
                applyRunSafeArea();
                // Same frame, same numbers: the scene must not be left laying
                // itself out against the previous orientation's safe area.
                resyncSceneInsets();
            });
        };
        refreshSafeArea();
        window.addEventListener("orientationchange", refreshSafeArea, { passive: true });
        window.addEventListener("resize", refreshSafeArea, { passive: true });
        window.visualViewport?.addEventListener("resize", refreshSafeArea, { passive: true });
        window.visualViewport?.addEventListener("scroll", refreshSafeArea, { passive: true });

        // Events are not enough. A host publishes its new insets when it is
        // ready, which on a rotation is AFTER the resize it also fired — so a
        // resize-only refresh reads the outgoing orientation's safe area and
        // then never looks again. The scene keeps those stale numbers while
        // the DOM picks the new ones straight out of CSS, and the two lay
        // themselves out against different bottoms: the helper bar ends up on
        // top of the tray. Watching the source itself closes that window,
        // whichever way round the host does it.
        const observer = new MutationObserver(refreshSafeArea);
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["style", "data-viewdeck-safe-area"],
        });

        return () => {
            window.cancelAnimationFrame(frame);
            observer.disconnect();
            window.removeEventListener("orientationchange", refreshSafeArea);
            window.removeEventListener("resize", refreshSafeArea);
            window.visualViewport?.removeEventListener("resize", refreshSafeArea);
            window.visualViewport?.removeEventListener("scroll", refreshSafeArea);
        };
    }, []);
}

function MenuRoute() {
    const screen = useStore((state) => state.menuScreen);
    if (screen === "atelier") return <AtelierScreen />;
    if (screen === "daily-rewards") return <DailyRewardsScreen />;
    if (screen === "daily-quests") return <DailyQuestsScreen />;
    if (screen === "stats") return <StatsScreen />;
    if (screen === "settings") return <SettingsScreen />;
    return <MainMenu />;
}

export default function App() {
    useOrientationSafeArea();
    const phase = useStore((s) => s.phase);

    // RUN's core-loop query expects screen_viewed; this router is the only
    // place every screen change passes through.
    useEffect(() => {
        analytics.event("screen_viewed", { screen: phase });
    }, [phase]);
    return (
        <div id="app-frame">
            {phase === "loading" && <LoadingScreen />}
            {phase === "menu" && <MenuRoute />}
            {phase === "playing" && (
                <div className="bench-in absolute inset-0">
                    <GameCanvas />
                    <Hud />
                </div>
            )}
            <Toast />
            <DevelopmentToolsSlot />
        </div>
    );
}

function DevelopmentToolsSlot() {
    if (!DevelopmentTools || new URLSearchParams(window.location.search).get("debug") !== "1") return null;
    return (
        <Suspense fallback={null}>
            <DevelopmentTools />
        </Suspense>
    );
}

function Toast() {
    const toast = useStore((state) => state.toast);
    if (!toast) return null;
    return (
        <button type="button" className="toast" onClick={() => store.patch({ toast: null })}>
            {toast}
        </button>
    );
}
