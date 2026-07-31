/**
 * Turns the host's pause signal into something a player should actually see.
 *
 * The RUN host fires `onPause` for a platform dialog, an ad, or a momentary
 * switch away — and in the field it also fires for blips that correspond to
 * nothing the player did. Rendering a blocking modal straight off that signal
 * produced "PAUSED appears randomly" reports.
 *
 * Two things make that safe to soften, and both are specific to this game:
 * nothing advances without player input (there is no clock anywhere in
 * `src/game/puzzle/`), and the pause's real work — stopping the ticker and
 * muting audio — already happens in `main.tsx` the instant the event lands.
 * The overlay is therefore only ever a courtesy, so:
 *
 * 1. It waits out a grace period. A pause that lifts inside it is never shown,
 *    which is every transient host blip.
 * 2. It self-heals. If we are still paused while the page is visible and we
 *    did not open a host overlay, the host has paused us for something that
 *    is not in front of the player — or has simply failed to send `onResume`,
 *    which used to strand the run for good. Resume ourselves. "Host overlay"
 *    has to mean every host-mediated surface, ads AND checkout: resuming over
 *    an open purchase sheet would start the music over it.
 *
 * The tap-to-resume on the overlay stays as the immediate manual escape.
 */
import { useEffect, useState } from "react";
import { audioManager } from "../audio/audioManager.ts";
import { hostOverlayInFlight } from "../sdk/runSdk.ts";
import { store, useStore } from "../state/store.ts";
import { runtimeServices } from "../systems/runtimeServices.ts";

/** Long enough to swallow a blip, short enough that a real pause feels prompt. */
const SHOW_AFTER_MS = 600;
/** How long a pause nobody can see is tolerated before we lift it ourselves. */
const SELF_HEAL_AFTER_MS = 2_400;
/** How often the self-heal re-tests its conditions once that time has passed. */
const POLL_MS = 700;

export function resumeFromPause(): void {
    if (!store.get().paused) return;
    store.patch({ paused: false });
    audioManager.setPaused(false);
    runtimeServices.resume();
}

/** True only when the player should actually be shown the pause overlay. */
export function usePauseGate(): boolean {
    const paused = useStore((s) => s.paused);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (!paused) {
            setVisible(false);
            return;
        }

        const showTimer = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS);
        const since = performance.now();
        // A POLL, not a one-shot timer. The condition that blocks a self-heal —
        // a host overlay being open — is exactly the condition that later goes
        // away, and the pause we most need to recover from is the one the host
        // forgets to lift AFTER closing its own overlay. A single timer fires
        // once, finds the overlay open, and never looks again.
        const poll = window.setInterval(() => {
            if (performance.now() - since < SELF_HEAL_AFTER_MS) return;
            // Backgrounded is a real pause: leave it alone and let the host
            // wake us. An open host overlay is a real pause too. Anything else
            // is a pause the player cannot see the reason for.
            if (document.hidden || hostOverlayInFlight()) return;
            resumeFromPause();
        }, POLL_MS);

        return () => {
            window.clearTimeout(showTimer);
            window.clearInterval(poll);
        };
    }, [paused]);

    return visible;
}
