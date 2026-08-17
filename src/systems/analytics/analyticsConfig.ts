import { store } from "../../state/store.ts";
import { recordAnalytics, recordFunnelStep } from "../../sdk/runSdk.ts";
import packageJson from "../../../package.json";
import { countedSteps, createAnalytics } from "./analytics.ts";

/**
 * LEADLIGHT funnel registry.
 *
 * `leadlight_first_run` is reproduced here EXACTLY as it shipped — same name,
 * same three step names, same numbers — because it has real history and is one
 * of only two funnels in the portfolio that was ever readable. Nothing about
 * it changes; it simply moves behind the shared helper.
 *
 * `leadlight_first_run_detail` is the new one. The shipped funnel showed the
 * portfolio's largest single drop (90% start a run, 40% finish one) but with
 * nothing between those two steps there was no way to see WHERE inside the run
 * players quit — on the first piece, before the first line fired, or deep in.
 * Adding those beats to the shipped funnel would mean renumbering it and
 * discarding its trend line, so they live in a companion funnel instead and
 * are cross-read against it.
 *
 * Step names and numbers are frozen: add new beats at the end, never renumber.
 */
export const analytics = createAnalytics({
    emitEvent: (name, payload) => {
        void recordAnalytics(name, { ...payload, build_version: packageJson.version });
    },
    emitFunnelStep: (step, name, funnel, order) => {
        // Return the delivery promise so once-ever marks persist only after
        // the SDK confirms the step (see AnalyticsConfig.emitFunnelStep).
        return recordFunnelStep(step, name, funnel, order);
    },
    funnels: {
        /**
         * The loading phase itself, ahead of the first-run funnel (order 0).
         *
         * The first-run funnel starts at "the game finished loading", so a player
         * who closed the tab during boot never appeared in it at all — a load
         * regression and a retention problem looked identical. Step 1 fires on the
         * first executable line, before any await, and is buffered until the SDK
         * transport is up.
         *
         * A separate funnel rather than steps prepended to the existing one,
         * because shipped step numbers must never be renumbered.
         */
        load: {
            order: 0,
            onceEver: true,
            steps: [
                "load_started", // first line of script execution
                "load_sdk_ready", // host handshake resolved
                "load_save_ready", // progress restored
                "load_assets_ready", // playable frame reachable
            ],
        },
        leadlight_first_run: {
            order: 1,
            onceEver: true,
            steps: ["game_loaded", "run_started", "run_finished"],
        },
        leadlight_first_run_detail: {
            order: 2,
            onceEver: true,
            steps: [
                "detail_run_started", // same moment as the shipped step 2
                "detail_first_piece_placed", // first core-verb action
                "detail_first_line_fired", // first payoff
                "detail_fifth_line_fired", // settled into the loop
                "detail_run_finished", // same moment as the shipped step 3
            ],
        },
        // Repeatable: how deep players get across their first 12 runs.
        engagement: { order: 3, steps: countedSteps("run_completed_", 12) },
        /**
         * Store conversion. Every step below is an event this game was already
         * firing; without the declaration the dashboard could show that purchases
         * happened but not where the other players dropped out of the flow.
         *
         * Repeatable (not onceEver): a player can buy more than once, and each
         * pass through the store should count.
         */
        purchase: {
            order: 3,
            steps: [
                "monetization_surface_viewed", // the store/offer was actually seen
                "purchase_tapped", // a specific product was chosen
                "checkout_started", // the host purchase sheet was requested
                "checkout_result", // the host returned a verdict
            ],
        },
    },
    enrich: () => {
        const state = store.get();
        return {
            runs_played: state.runsPlayed,
            lines_fired: state.linesFired,
        };
    },
    marksKey: "leadlight_funnel_marks",
    debug: import.meta.env.DEV,
});
