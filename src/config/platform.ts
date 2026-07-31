/**
 * Every RUN identifier LEADLIGHT uses, in one registry.
 *
 * Where each id actually comes from:
 *
 * - `gameId` — written by `rundot init` (mirrored in game.config.prod.json).
 * - Ad placement ids — SELF-AUTHORED plain strings passed as `adDisplayId` to
 *   showRewardedAdAsync/showInterstitialAd. There is no platform-side
 *   "create a placement" step; invent a stable name and ship it.
 * - Shop item / entitlement ids — SELF-AUTHORED in `rundot/shop.config.json`,
 *   which registers the catalog at deploy. These strings must match that file
 *   exactly, and `npm run test` checks that they still do.
 *
 * Untouched `REPLACE_WITH_` values fail closed: the surfaces that depend on
 * them stay hidden rather than pretending to work.
 */
export const PLATFORM_IDS = Object.freeze({
    gameId: "HhZKdkXCbYVAhxdHKqTV",

    /** Rewarded: the once-per-run continue from the stuck card. */
    rewardedSecondFiring: "leadlight_second_firing_rewarded",
    /** Rewarded: doubles the shards on the results card. */
    rewardedDoubleCullet: "leadlight_double_cullet_rewarded",
    /** Interstitial: after the results card is dismissed, every third run. */
    interstitialBetweenRuns: "leadlight_between_runs_interstitial",

    /** Shop items (rundot/shop.config.json → items[].itemId). */
    palettePackItem: "leadlight_palette_pack_aurora",
    adFreeItem: "leadlight_no_interstitials",
    glazierPassItem: "leadlight_glazier_pass",

    /** Entitlements granted by those items. */
    palettePackEntitlement: "leadlight_palette_pack_aurora",
    adFreeEntitlement: "leadlight_no_interstitials",
    emberPaletteEntitlement: "leadlight_palette_ember",
});

export function isConfiguredPlatformId(value: string): boolean {
    return value.length > 0 && !value.startsWith("REPLACE_WITH_");
}
