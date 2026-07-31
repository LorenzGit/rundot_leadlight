/**
 * The Atelier: pick your glass, and the only place anything is sold.
 *
 * Palettes come first and products second, deliberately. The screen's job is
 * choosing glass; the offers are what you find while you are choosing, not a
 * storefront the player was routed into.
 *
 * Every price shown here is either a resolved live catalog price or explicitly
 * labelled PREVIEW. Nothing on this screen invents a number.
 */
import { useEffect, useMemo, useState } from "react";
import { applyMenuBackdrop } from "../assets/preload.ts";
import { audioManager } from "../audio/audioManager.ts";
import { paletteSwatchDataUrl } from "../game/art/glass.ts";
import { type PaletteId, palette } from "../game/art/palette.ts";
import { store, useStore } from "../state/store.ts";
import { productView, purchaseProduct, refreshCommerce } from "../systems/commerce.ts";
import { t } from "../systems/localization.ts";
import { PRODUCT_IDS } from "../systems/monetization/config.ts";
import { monetizationTelemetry } from "../systems/monetization/runtime.ts";
import { PALETTE_OFFERS, paletteIsOwned } from "../systems/palettes.ts";
import { runtimeServices } from "../systems/runtimeServices.ts";
import { saveSystem } from "../systems/save.ts";
import MenuScreenLayout from "./MenuScreenLayout.tsx";

export default function AtelierScreen() {
    const selected = useStore((s) => s.selectedPalette);
    const shards = useStore((s) => s.shards);
    const owned = useStore((s) => s.ownedPalettes);
    const runsPlayed = useStore((s) => s.runsPlayed);
    const [busyProduct, setBusyProduct] = useState<string | null>(null);

    // The catalog is fetched when the screen opens, not at boot: an offer the
    // player never navigates to should not cost them a request.
    useEffect(() => {
        void refreshCommerce();
        monetizationTelemetry.record("monetization_surface_viewed", { surface: "atelier", runs_played: runsPlayed });
    }, [runsPlayed]);

    // Swatches are drawn from the same generator the board uses, so a palette
    // preview cannot show glass the game will not render.
    const swatches = useMemo(
        () => Object.fromEntries(PALETTE_OFFERS.map((offer) => [offer.id, paletteSwatchDataUrl(palette(offer.id))])),
        [],
    );

    const choose = (id: PaletteId): void => {
        audioManager.play("tap");
        void runtimeServices.haptic("light");
        store.patch({ selectedPalette: id });
        applyMenuBackdrop(id);
        runtimeServices.track("palette_selected", { palette: id });
        void saveSystem.flush();
    };

    const buyWithShards = (id: PaletteId, cost: number): void => {
        if (shards < cost) {
            audioManager.play("reject");
            store.patch({ toast: t("NotEnoughShards") });
            return;
        }
        audioManager.play("reward");
        void runtimeServices.haptic("success");
        store.patch({ shards: shards - cost, ownedPalettes: [...new Set([...owned, id])], selectedPalette: id });
        applyMenuBackdrop(id);
        runtimeServices.track("palette_unlocked", { palette: id, source: "shards", cost });
        void saveSystem.flush();
    };

    const buyProduct = (productId: (typeof PRODUCT_IDS)[number]): void => {
        void (async () => {
            setBusyProduct(productId);
            const outcome = await purchaseProduct(productId, "atelier");
            setBusyProduct(null);
            if (!outcome) {
                store.patch({ toast: t("PurchaseUnavailable") });
                return;
            }
            if (outcome.status === "confirmed") {
                audioManager.play("reward");
                void runtimeServices.haptic("success");
                store.patch({ toast: t("PurchaseConfirmed") });
            } else if (outcome.status === "cancelled") {
                store.patch({ toast: t("PurchaseCancelled") });
            } else if (outcome.status === "unknown") {
                // Ambiguous is NOT failed: the order may still land, and the
                // pending intent survives to be reconciled on the next resume.
                store.patch({ toast: t("PurchasePending") });
            } else {
                audioManager.play("reject");
                store.patch({ toast: t("PurchaseFailed") });
            }
        })();
    };

    return (
        <MenuScreenLayout title={t("MenuAtelier")} kicker={t("KickerAtelier")}>
            <p className="screen-copy">{t("AtelierBody")}</p>

            <div className="palette-list">
                {PALETTE_OFFERS.map((offer) => {
                    const isOwned = paletteIsOwned(offer.id);
                    const isActive = selected === offer.id;
                    const cost = offer.unlock.kind === "shards" ? offer.unlock.cost : 0;
                    return (
                        <article
                            className={`palette-card${isActive ? " active" : ""}`}
                            key={offer.id}
                            data-palette={offer.id}
                        >
                            <img className="palette-swatch" src={swatches[offer.id]} alt="" aria-hidden="true" />
                            <div className="palette-copy">
                                <h3>{offer.name}</h3>
                                <p>{offer.blurb}</p>
                            </div>
                            {isOwned ? (
                                <button
                                    type="button"
                                    className={`palette-action${isActive ? " active" : ""}`}
                                    disabled={isActive}
                                    onClick={() => choose(offer.id)}
                                >
                                    {isActive ? t("PaletteSelected") : t("PaletteSelect")}
                                </button>
                            ) : offer.unlock.kind === "shards" ? (
                                <button
                                    type="button"
                                    className="palette-action"
                                    disabled={shards < cost}
                                    onClick={() => buyWithShards(offer.id, cost)}
                                >
                                    {t("PaletteUnlockShards", { cost })}
                                </button>
                            ) : offer.unlock.kind === "entitlement" ? (
                                <span className="palette-locked">{offer.unlock.via}</span>
                            ) : null}
                        </article>
                    );
                })}
            </div>

            <h3 className="section-heading">{t("AtelierProducts")}</h3>
            <p className="screen-copy small">{t("AtelierProductsBody")}</p>

            {PRODUCT_IDS.map((productId) => {
                const view = productView(productId);
                if (!view.visible) return null;
                return (
                    <article className="shop-card" key={productId}>
                        <p className="eyebrow">{view.statusLabel}</p>
                        <h3>{view.name}</h3>
                        <p>{view.description}</p>
                        <button
                            type="button"
                            disabled={!view.purchasable || busyProduct !== null}
                            onClick={() => buyProduct(productId)}
                        >
                            {busyProduct === productId
                                ? t("PurchaseWorking")
                                : view.owned
                                  ? t("Owned")
                                  : view.priceLabel}
                        </button>
                    </article>
                );
            })}

            <p className="safety-note">{t("AtelierSafetyNote")}</p>
        </MenuScreenLayout>
    );
}
