/**
 * LEADLIGHT's monetization decisions, in code.
 *
 * These are the values from DESIGN.md §6. Nothing else in the game may invent a
 * placement id, a cap, a product id, or an unlock gate — if it is not here, it
 * does not exist.
 */
import { PLATFORM_IDS } from "../../config/platform.ts";
import { createMonetizationPlan } from "./monetizationPlan.ts";
import { createPlacementRegistry } from "./placementRegistry.ts";
import { createProductRegistry } from "./productRegistry.ts";

export const monetizationPlan = createMonetizationPlan({
    model: "hybrid",
    nonPayerPromise:
        "Nothing purchasable changes a shape, a draw weight, a score, or the size of the panel. Two of the six palettes are earnable with shards, and the only ad a non-payer cannot decline is one interstitial after every third completed run, from their second session onward.",
    purchaseArchitecture: "shop-entitlements",
    architectureRationale:
        "Durable cosmetic and ad-free unlocks need cross-device ownership, an order ledger, and refund handling; a client-owned grant loses all three the first time the player changes device.",
    firstExposure: {
        valueMoment:
            "The results card of the player's first finished run, where they see a score, the shards it paid, and the Atelier for the first time.",
        minCompletedSessions: 1,
        minProgression: 1,
    },
    primaryKpis: ["game_payer_conversion", "rewarded_completion_rate"],
    guardrails: {
        retention: "D1/D7 retention split by first-interstitial exposure cohort",
        sessionHealth: "runs per session before and after the first interstitial",
        economyHealth: "share of shards earned from rewarded video versus play",
        reliability: "purchase and ad error rate excluding player cancellation",
    },
});

/** Placement ids used by `systems/ads.ts`. */
export const PLACEMENT = {
    secondFiring: "second_firing",
    doubleCullet: "double_cullet",
    betweenRuns: "between_runs",
} as const;

export type PlacementId = (typeof PLACEMENT)[keyof typeof PLACEMENT];

/** Placement id → the self-authored `adDisplayId` handed to the SDK. */
export const PLACEMENT_DISPLAY_ID: Readonly<Record<PlacementId, string>> = {
    [PLACEMENT.secondFiring]: PLATFORM_IDS.rewardedSecondFiring,
    [PLACEMENT.doubleCullet]: PLATFORM_IDS.rewardedDoubleCullet,
    [PLACEMENT.betweenRuns]: PLATFORM_IDS.interstitialBetweenRuns,
};

export const placements = createPlacementRegistry([
    {
        id: PLACEMENT.secondFiring,
        displayName: "Second Firing",
        type: "rewarded",
        enabledByDefault: false,
        unlock: { minCompletedSessions: 1, minProgression: 1, requireValueMoment: true },
        cooldownSeconds: 0,
        sessionCap: 3,
        dailyCap: 8,
        subscriberPolicy: "same-as-free",
        noAdFallback: "disable-with-message",
        rewardId: "second_firing",
        rewardAmount: 1,
    },
    {
        id: PLACEMENT.doubleCullet,
        displayName: "Double the Cullet",
        type: "rewarded",
        enabledByDefault: false,
        unlock: { minCompletedSessions: 1, minProgression: 1, requireValueMoment: true },
        cooldownSeconds: 30,
        sessionCap: 4,
        dailyCap: 12,
        subscriberPolicy: "same-as-free",
        noAdFallback: "disable-with-message",
        rewardId: "shards_double",
        rewardAmount: 1,
    },
    {
        id: PLACEMENT.betweenRuns,
        displayName: "Between Runs",
        type: "interstitial",
        enabledByDefault: false,
        unlock: { minCompletedSessions: 3, minProgression: 3, requireValueMoment: true },
        cooldownSeconds: 90,
        sessionCap: 2,
        dailyCap: 5,
        subscriberPolicy: "skip",
        noAdFallback: "hide",
        naturalBreak: "The player dismisses the results card and returns to the bench",
        excludeFirstSession: true,
    },
]);

/** Only every Nth completed run may show the interstitial. */
export const INTERSTITIAL_RUN_INTERVAL = 3;

export const products = createProductRegistry([
    {
        id: "palette_pack",
        catalogItemId: PLATFORM_IDS.palettePackItem,
        kind: "durable",
        expectedEntitlementIds: [PLATFORM_IDS.palettePackEntitlement],
        unique: true,
        unlockDescription: "Offered once the player has finished a run and opened the Atelier",
    },
    {
        id: "ad_free",
        catalogItemId: PLATFORM_IDS.adFreeItem,
        kind: "durable",
        expectedEntitlementIds: [PLATFORM_IDS.adFreeEntitlement],
        unique: true,
        unlockDescription: "Offered once the player has reached the interstitial cadence",
    },
    {
        id: "glazier_pass",
        catalogItemId: PLATFORM_IDS.glazierPassItem,
        kind: "bundle",
        expectedEntitlementIds: [
            PLATFORM_IDS.palettePackEntitlement,
            PLATFORM_IDS.adFreeEntitlement,
            PLATFORM_IDS.emberPaletteEntitlement,
        ],
        unique: true,
        unlockDescription: "Offered alongside its two component products once either is eligible",
    },
]);

export type ProductId = "palette_pack" | "ad_free" | "glazier_pass";

export const PRODUCT_IDS: readonly ProductId[] = ["palette_pack", "ad_free", "glazier_pass"];

/**
 * Prices shown in local development only, where no live catalog exists. They
 * mirror `rundot/shop.config.json` and are always labelled PREVIEW in the UI so
 * they can never be mistaken for a resolved live price.
 */
export const DEV_PREVIEW_PRICES: Readonly<Record<ProductId, string>> = {
    palette_pack: "199 RB",
    ad_free: "249 RB",
    glazier_pass: "399 RB",
};

/** Runs finished before a product is offered at all — DESIGN.md §6.1. */
export const PRODUCT_UNLOCK_RUNS: Readonly<Record<ProductId, number>> = {
    palette_pack: 1,
    ad_free: 3,
    glazier_pass: 3,
};
