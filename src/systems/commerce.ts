/**
 * Purchases and ownership.
 *
 * Two rules run through everything here. Ownership is only ever asserted from
 * an authoritative entitlement read — never from analytics, never from a local
 * flag written after a checkout returned. And a surface whose live price has
 * not resolved says so, rather than inventing one.
 */
import type { ShopOrderHistoryResponse, ShopPurchaseResponse, StorefrontItem } from "@series-inc/rundot-game-sdk";
import {
    fetchEntitlements,
    fetchShopCatalog,
    fetchShopOrderHistory,
    getRunCapabilities,
    purchaseShopItem,
} from "../sdk/runSdk.ts";
import { store } from "../state/store.ts";
import { DEV_PREVIEW_PRICES, PRODUCT_UNLOCK_RUNS, type ProductId, products } from "./monetization/config.ts";
import {
    createPurchaseCoordinator,
    type PendingPurchaseIntent,
    type PurchaseOutcome,
} from "./monetization/purchaseCoordinator.ts";
import { getMonetizationControls, monetizationTelemetry } from "./monetization/runtime.ts";
import { saveSystem } from "./save.ts";

let catalog = new Map<string, StorefrontItem>();
let catalogConfigId: string | null = null;
let entitlementIds = new Set<string>();
/** False whenever ownership could not be read; it never means "owns nothing". */
let entitlementsAuthoritative = false;
let refreshInFlight: Promise<void> | null = null;

/**
 * Called after every authoritative ownership change. `palettes.ts` subscribes
 * so it can revert a selection the player can no longer prove they own — the
 * mapping from entitlement to palette lives there and only there.
 */
const ownershipListeners = new Set<() => void>();

export function onOwnershipChanged(listener: () => void): () => void {
    ownershipListeners.add(listener);
    return () => ownershipListeners.delete(listener);
}

export interface ProductView {
    productId: ProductId;
    name: string;
    description: string;
    /** Whether the offer should appear at all. */
    visible: boolean;
    owned: boolean;
    purchasable: boolean;
    priceLabel: string;
    statusLabel: string;
    /** True when the label is a local development preview, not a live price. */
    preview: boolean;
}

const PRODUCT_NAMES: Readonly<Record<ProductId, string>> = {
    palette_pack: "PALETTE PACK — AURORA",
    ad_free: "AD-FREE FOREVER",
    glazier_pass: "GLAZIER'S PASS",
};

const PRODUCT_DESCRIPTIONS: Readonly<Record<ProductId, string>> = {
    palette_pack: "Unlocks the Aurora and Cathedral glass permanently. Cosmetic only.",
    ad_free: "Removes the between-runs interstitial forever. Optional rewarded videos remain, and are never required.",
    glazier_pass: "Everything above, plus the Ember glass — furnace orange over cold iron, sold nowhere else.",
};

async function syncEntitlements(): Promise<void> {
    const entitlements = await fetchEntitlements();
    if (entitlements === null) {
        entitlementsAuthoritative = false;
        entitlementIds = new Set();
        return;
    }
    entitlementsAuthoritative = true;
    entitlementIds = new Set(
        entitlements.filter((entry) => entry.status === "active" && entry.quantity > 0).map((e) => e.entitlementId),
    );
    monetizationTelemetry.record("entitlement_synced", { count: entitlementIds.size });
    for (const listener of ownershipListeners) listener();
}

const purchaseCoordinator = createPurchaseCoordinator<ShopPurchaseResponse, ShopOrderHistoryResponse>({
    shop: {
        async purchase(itemId, idempotencyKey) {
            const response = await purchaseShopItem(itemId, idempotencyKey);
            if (!response.success) throw new Error("RUN SHOP DID NOT CONFIRM THE ORDER");
            return response;
        },
        getOrderHistory: fetchShopOrderHistory,
    },
    pending: {
        load: () => {
            const saved = store.get().pendingPurchaseIntent;
            return saved
                ? {
                      intentId: saved.idempotencyKey,
                      productId: saved.productId,
                      catalogItemId: saved.catalogItemId,
                      idempotencyKey: saved.idempotencyKey,
                      createdAtMs: saved.startedAt,
                  }
                : null;
        },
        async save(intent) {
            store.patch({
                pendingPurchaseIntent: {
                    productId: intent.productId,
                    catalogItemId: intent.catalogItemId,
                    idempotencyKey: intent.idempotencyKey,
                    startedAt: intent.createdAtMs,
                },
            });
            // If the intent cannot be persisted, an interrupted checkout would
            // be unrecoverable — refuse to open it at all.
            if (!(await saveSystem.flush())) throw new Error("PURCHASE INTENT COULD NOT BE SAVED");
        },
        async clear() {
            store.patch({ pendingPurchaseIntent: null });
            await saveSystem.flush();
        },
    },
    findConfirmedOrder(history, intent) {
        if (!history.success) return null;
        return (
            history.orders.find(
                (order) =>
                    order.itemId === intent.catalogItemId &&
                    order.idempotencyKey === intent.idempotencyKey &&
                    order.status === "fulfilled",
            ) ?? null
        );
    },
    syncEntitlements,
    classifyError(error) {
        const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        if (message.includes("cancel")) return "cancelled";
        if (message.includes("declin") || message.includes("insufficient") || message.includes("did not confirm")) {
            return "failed";
        }
        // Timeouts and unrecognised host outcomes stay unknown so the intent
        // survives and can be reconciled against order history.
        return "unknown";
    },
});

export async function refreshCommerce(): Promise<void> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
        const [nextCatalog] = await Promise.all([fetchShopCatalog(), syncEntitlements()]);
        catalogConfigId = nextCatalog?.configId ?? null;
        catalog = new Map((nextCatalog?.items ?? []).filter((item) => item.active).map((item) => [item.itemId, item]));
        if (import.meta.env.DEV && nextCatalog) {
            const issues = products.validateCatalog(
                nextCatalog.items.map((item) => ({
                    id: item.itemId,
                    active: item.active,
                    price: item.price,
                    entitlements: item.entitlements,
                })),
            );
            for (const issue of issues) {
                console.warn(`[commerce] ${issue.severity}: ${issue.productId} ${issue.message}`);
            }
        }
    })().finally(() => {
        refreshInFlight = null;
    });
    return refreshInFlight;
}

function liveItem(productId: ProductId): StorefrontItem | null {
    const definition = products.get(productId);
    return definition ? (catalog.get(definition.catalogItemId) ?? null) : null;
}

function formatLivePrice(item: StorefrontItem): string {
    const price = item.resolvedPrice.finalPrice;
    const unit = price.type.toLowerCase() === "bucks" ? "RB" : price.type.toUpperCase();
    return `${price.value} ${unit}`.trim();
}

export function entitlementsReady(): boolean {
    return entitlementsAuthoritative;
}

export function hasEntitlement(entitlementId: string): boolean {
    return entitlementsAuthoritative && entitlementIds.has(entitlementId);
}

/** True only when ownership has been verified. Used to suppress interstitials. */
export function ownsAdFree(): boolean {
    const adFree = products.get("ad_free");
    const pass = products.get("glazier_pass");
    const ids = [...(adFree?.expectedEntitlementIds ?? []), ...(pass?.expectedEntitlementIds ?? [])];
    return ids.some((id) => hasEntitlement(id));
}

export function productView(productId: ProductId): ProductView {
    const definition = products.get(productId);
    if (!definition) throw new Error(`Unknown commerce product ${productId}`);

    const capabilities = getRunCapabilities();
    const controls = getMonetizationControls();
    const enabled = controls.enabled && controls.purchasesEnabled && controls.products[productId]?.enabled === true;
    const item = liveItem(productId);
    const hostReady = enabled && capabilities.shop && !capabilities.mock && item !== null;

    // Local development has no catalog at all; showing the offer with a clearly
    // marked preview price is what makes the surface reviewable without ever
    // presenting an unverified number as live.
    const devPreview = import.meta.env.DEV && (!capabilities.host || capabilities.mock);

    const runs = store.get().runsPlayed;
    const required = PRODUCT_UNLOCK_RUNS[productId];
    const eligible = runs >= required;
    const owned = entitlementsAuthoritative && definition.expectedEntitlementIds.every((id) => entitlementIds.has(id));

    return {
        productId,
        name: item?.name?.toUpperCase() ?? PRODUCT_NAMES[productId],
        description: PRODUCT_DESCRIPTIONS[productId],
        visible: owned || eligible,
        owned,
        purchasable: eligible && !owned && hostReady,
        preview: !item && devPreview,
        priceLabel: item
            ? formatLivePrice(item)
            : devPreview
              ? // Marked inline, not only in the status line: the status line is
                // often busy saying what unlocks the offer, and an unmarked
                // number is indistinguishable from a resolved catalog price.
                `${DEV_PREVIEW_PRICES[productId]} · PREVIEW`
              : eligible
                ? "PRICE NOT SYNCED"
                : `AFTER ${required} RUN${required === 1 ? "" : "S"}`,
        statusLabel: owned
            ? "OWNED"
            : !eligible
              ? `FINISH ${required} RUN${required === 1 ? "" : "S"}`
              : devPreview
                ? "PREVIEW · NOT PURCHASABLE HERE"
                : hostReady
                  ? "PERMANENT"
                  : "UNAVAILABLE",
    };
}

export async function purchaseProduct(
    productId: ProductId,
    placement = "atelier",
): Promise<PurchaseOutcome<ShopPurchaseResponse> | null> {
    const view = productView(productId);
    const definition = products.get(productId);
    if (!view.purchasable || !definition) return null;

    monetizationTelemetry.record("purchase_tapped", { product_id: productId, placement });
    monetizationTelemetry.record("checkout_started", { product_id: productId, placement });
    const outcome = await purchaseCoordinator.purchase(productId, definition.catalogItemId);
    monetizationTelemetry.record("checkout_result", { product_id: productId, placement, result: outcome.status });
    return outcome;
}

/** Called on resume: an interrupted checkout must not stay in limbo. */
export async function reconcilePendingPurchase(): Promise<void> {
    const pending: PendingPurchaseIntent | null = purchaseCoordinator.pendingIntent();
    if (!pending) return;
    const outcome = await purchaseCoordinator.reconcilePending();
    if (!outcome) return;
    monetizationTelemetry.record("checkout_result", {
        product_id: pending.productId,
        placement: "resume_reconciliation",
        result: outcome.status,
    });
    if (outcome.status !== "confirmed") return;
    // Ownership may have arrived; the cosmetic layer re-checks the selection.
    for (const listener of ownershipListeners) listener();
}

export interface CommerceDiagnostics {
    catalogConfigId: string | null;
    catalogItemIds: readonly string[];
    entitlementIds: readonly string[];
    authoritative: boolean;
}

export function commerceDiagnostics(): CommerceDiagnostics {
    return {
        catalogConfigId,
        catalogItemIds: [...catalog.keys()].sort(),
        entitlementIds: [...entitlementIds].sort(),
        authoritative: entitlementsAuthoritative,
    };
}
