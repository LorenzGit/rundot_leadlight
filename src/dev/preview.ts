import { type MenuScreen, store } from "../state/store.ts";

const MENU_SCREENS = new Set<MenuScreen>(["main", "atelier", "daily-rewards", "daily-quests", "stats", "settings"]);

/**
 * Development-only deep link for visual review and automated browser checks.
 *
 * The query changes local in-memory navigation only; it never bypasses a RUN
 * permission, purchase, ad, entitlement, or other authoritative outcome.
 */
export function applyDevelopmentScreenPreview(): void {
    if (!import.meta.env.DEV) return;
    const requested = new URLSearchParams(window.location.search).get("screen");
    if (!requested) return;
    if (requested === "game") {
        store.patch({ phase: "playing", menuScreen: "main", paused: false });
        return;
    }
    if (MENU_SCREENS.has(requested as MenuScreen)) {
        store.patch({ phase: "menu", menuScreen: requested as MenuScreen, paused: false });
        return;
    }
    console.warn(`[dev] Unknown screen preview "${requested}".`);
}
