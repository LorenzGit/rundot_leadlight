/**
 * Palette ownership — DESIGN.md §5.3.
 *
 * Two palettes are bought with shards and recorded in the save. Three are
 * bought with Run Bits and are NEVER recorded in the save: they are proven by
 * an authoritative entitlement read every session, so a refund, a revocation,
 * or a fresh device all resolve correctly without the client guessing.
 */

import { PLATFORM_IDS } from "../config/platform.ts";
import { DEFAULT_PALETTE, PALETTES, type PaletteId } from "../game/art/palette.ts";
import { store } from "../state/store.ts";
import { entitlementsReady, hasEntitlement, onOwnershipChanged } from "./commerce.ts";
import { saveSystem } from "./save.ts";

export type PaletteUnlock =
    | { kind: "starter" }
    | { kind: "shards"; cost: number }
    | { kind: "entitlement"; entitlementId: string; via: string };

export interface PaletteOffer {
    id: PaletteId;
    name: string;
    blurb: string;
    unlock: PaletteUnlock;
}

export const PALETTE_OFFERS: readonly PaletteOffer[] = PALETTES.map((entry) => {
    const unlock: PaletteUnlock =
        entry.id === "atelier"
            ? { kind: "starter" }
            : entry.id === "verdant"
              ? { kind: "shards", cost: 800 }
              : entry.id === "nocturne"
                ? { kind: "shards", cost: 1_600 }
                : entry.id === "ember"
                  ? {
                        kind: "entitlement",
                        entitlementId: PLATFORM_IDS.emberPaletteEntitlement,
                        via: "GLAZIER'S PASS",
                    }
                  : {
                        kind: "entitlement",
                        entitlementId: PLATFORM_IDS.palettePackEntitlement,
                        via: "PALETTE PACK",
                    };
    return { id: entry.id, name: entry.name, blurb: entry.blurb, unlock };
});

export function paletteOffer(id: PaletteId): PaletteOffer | undefined {
    return PALETTE_OFFERS.find((entry) => entry.id === id);
}

/** True only when ownership is provable: starter, saved purchase, or entitlement. */
export function paletteIsOwned(id: PaletteId): boolean {
    const offer = paletteOffer(id);
    if (!offer) return false;
    if (offer.unlock.kind === "starter") return true;
    if (offer.unlock.kind === "entitlement") return hasEntitlement(offer.unlock.entitlementId);
    return store.get().ownedPalettes.includes(id);
}

export function ownedPaletteIds(): PaletteId[] {
    return PALETTE_OFFERS.filter((offer) => paletteIsOwned(offer.id)).map((offer) => offer.id);
}

/**
 * A selected palette the player can no longer prove they own — refunded,
 * revoked, or restored onto a device where the entitlement has not synced yet —
 * quietly reverts to the house glass.
 *
 * Deliberately conservative: it only reverts once ownership has actually been
 * READ. An unreachable entitlement service must never strip a paying player's
 * palette because their connection dropped.
 */
export function enforceOwnedSelection(): void {
    if (!entitlementsReady()) return;
    const selected = store.get().selectedPalette;
    if (paletteIsOwned(selected)) return;
    store.patch({ selectedPalette: DEFAULT_PALETTE });
    void saveSystem.flush();
}

onOwnershipChanged(enforceOwnedSelection);
