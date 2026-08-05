import { analytics } from "../analytics/analyticsConfig";
import {
    cancelLocalNotification,
    notificationsEnabled,
    rearmLocalNotification,
    resolveLaunchIntent,
} from "../../sdk/runSdk";
import { RETURN_DELAYS_SECONDS, createReturnReminders } from "./returnReminders";

/**
 * Return reminders for leadlight.
 *
 * Before this, the game had no way to reach a player once they closed it —
 * onboarding could convert perfectly and still produce no second session.
 *
 * The copy below is the actual product. Each body names the specific thing
 * waiting for this player; a generic "come back and play" is the wording that
 * gets muted, and muting is permanent. The cadence stops at 72h because a
 * fourth ping converts nobody and costs the permission the first three need.
 */

// Permission is read once at startup rather than per-schedule: the check is an
// async host round-trip and scheduling happens on the session-end path.
let notificationsGranted = false;

/** Refresh the cached permission. Call at startup and after any consent change. */
export async function refreshNotificationPermission(): Promise<boolean> {
    notificationsGranted = await notificationsEnabled();
    return notificationsGranted;
}

export const returnReminders = createReturnReminders({
    idPrefix: "leadlight",
    reminders: () => [
        {
            id: "d1",
            title: "Your daily shards are ready",
            body: "Collect them before the streak resets.",
            delaySeconds: RETURN_DELAYS_SECONDS[0],
        },
        {
            id: "d2",
            title: "Your panel is unfinished",
            body: "The glass is still set where you left it.",
            delaySeconds: RETURN_DELAYS_SECONDS[1],
        },
        {
            id: "d3",
            title: "One more firing",
            body: "Your best score is a run away.",
            delaySeconds: RETURN_DELAYS_SECONDS[2],
        },
    ],
    schedule: (input) => rearmLocalNotification(input),
    cancel: (id) => cancelLocalNotification(id),
    resolveLaunch: () => resolveLaunchIntent(),
    isEnabled: () => notificationsGranted,
    track: (event, payload) => analytics.event(event, payload),
});

/**
 * Resolve a notification-driven launch and record it. Call once at startup so
 * the return can be attributed to the reminder copy that earned it.
 */
export async function resolveReturnLaunch(): Promise<string | null> {
    const reminderId = await returnReminders.resolveLaunch();
    if (reminderId) analytics.event("retention_notification_return_play", { reminder_id: reminderId });
    return reminderId;
}
