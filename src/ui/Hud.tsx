/**
 * In-run HUD: a React overlay above the Pixi canvas.
 *
 * The overlay itself is pointer-events-none so drags fall through to the
 * canvas; each control opts back in. The two cards (stuck and results) DO
 * capture input — they are modal by intent.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { audioManager } from "../audio/audioManager.ts";
import { getRunController } from "../game/GameCanvas.tsx";
import { CHISEL_COST, RECUT_COST } from "../game/runController.ts";
import { store, useStore } from "../state/store.ts";
import { rewardedAvailable } from "../systems/ads.ts";
import { t } from "../systems/localization.ts";
import { PLACEMENT } from "../systems/monetization/config.ts";
import { monetizationTelemetry } from "../systems/monetization/runtime.ts";
import { runtimeServices } from "../systems/runtimeServices.ts";
import { saveSystem } from "../systems/save.ts";
import GearIcon from "./GearIcon.tsx";
import SettingToggle from "./SettingToggle.tsx";
import { resumeFromPause, usePauseGate } from "./usePauseGate.ts";

/**
 * Roll a displayed number toward its target instead of snapping.
 *
 * A four-line clear is the best moment in the game and the score is the only
 * place it is reported; jumping 40 -> 140 in one frame throws that away. The
 * roll is deliberately fast (about a third of a second) so it never lags behind
 * the next placement, and it snaps instantly under reduced motion.
 */
function useRollingNumber(target: number, reducedMotion: boolean): { value: number; bumping: boolean } {
    const [value, setValue] = useState(target);
    const [bumping, setBumping] = useState(false);
    const frame = useRef(0);
    const bumpTimer = useRef(0);

    useEffect(() => {
        if (reducedMotion) {
            setValue(target);
            return;
        }
        let cancelled = false;
        const step = (): void => {
            if (cancelled) return;
            setValue((current) => {
                if (current === target) return current;
                const delta = target - current;
                // Always move at least one, or small gains never arrive.
                const next = current + Math.sign(delta) * Math.max(1, Math.ceil(Math.abs(delta) * 0.18));
                const overshot = delta > 0 ? next >= target : next <= target;
                if (!overshot) frame.current = requestAnimationFrame(step);
                return overshot ? target : next;
            });
        };
        frame.current = requestAnimationFrame(step);
        return () => {
            cancelled = true;
            cancelAnimationFrame(frame.current);
        };
    }, [target, reducedMotion]);

    useEffect(() => {
        if (target <= 0) return;
        setBumping(true);
        window.clearTimeout(bumpTimer.current);
        bumpTimer.current = window.setTimeout(() => setBumping(false), 260);
        return () => window.clearTimeout(bumpTimer.current);
    }, [target]);

    return { value, bumping };
}

export default function Hud() {
    const score = useStore((s) => s.score);
    const combo = useStore((s) => s.combo);
    const shards = useStore((s) => s.shards);
    const runStatus = useStore((s) => s.runStatus);
    const chiselArmed = useStore((s) => s.chiselArmed);
    const dragging = useStore((s) => s.dragging);
    const summary = useStore((s) => s.runSummary);
    const reducedMotion = useStore((s) => s.reducedMotion);
    const rolling = useRollingNumber(score, reducedMotion);
    // Not `state.paused` directly: see usePauseGate for why a host pause is
    // not the same thing as a pause worth showing the player.
    const showPause = usePauseGate();
    const [settingsOpen, setSettingsOpen] = useState(false);

    const leave = useCallback(() => {
        audioManager.play("tap");
        getRunController()?.cancelChisel();
        store.patch({ phase: "menu", menuScreen: "main", runSummary: null });
        void saveSystem.flush();
    }, []);

    return (
        <div className={`pointer-events-none absolute inset-0 pt-safe-top${dragging ? " carrying" : ""}`}>
            <div className="game-hud">
                <div className={`hud-score${rolling.bumping ? " bump" : ""}`}>
                    <span>{t("LabelScore")}</span>
                    {/* The rolling digits are decoration; the live region
                        announces the settled score once, not every frame of
                        the roll. */}
                    <strong aria-hidden="true">{rolling.value.toLocaleString()}</strong>
                    <span className="sr-only" role="status">
                        {t("LabelScore")} {score}
                    </span>
                </div>
                {combo >= 2 && (
                    <div className="hud-combo" key={combo} aria-live="polite">
                        <span>{t("LabelCombo")}</span>
                        <strong>x{combo}</strong>
                    </div>
                )}
                {/* Landscape docks every control in the right rail, so the
                    shards pill joins the top cluster there (hidden in
                    portrait, where it stays in the helper bar). */}
                <div className="helper-shards hud-shards-top" role="status" aria-label={t("LabelShards")}>
                    <span className="shard-glyph" aria-hidden="true" />
                    <strong>{shards.toLocaleString()}</strong>
                </div>
                <button
                    type="button"
                    className="hud-settings pointer-events-auto"
                    aria-label={t("MenuSettings")}
                    onClick={() => {
                        audioManager.play("tap");
                        setSettingsOpen(true);
                    }}
                >
                    <GearIcon />
                </button>
                <button type="button" className="hud-menu pointer-events-auto" onClick={leave}>
                    {t("ButtonMenu")}
                </button>
            </div>

            {/* No pb-safe-bottom: the bottom inset is applied in CSS, where
                both orientations pin this bar to the exact reserve the scene
                leaves it. Sized by its content instead, it outgrows that
                reserve and climbs over the tray plank. */}
            {runStatus !== "over" && !summary && (
                <div className="helper-bar">
                    <HelperButton
                        label={t("HelperChisel")}
                        cost={CHISEL_COST}
                        shards={shards}
                        active={chiselArmed}
                        hint={chiselArmed ? t("HelperChiselArmed") : t("HelperChiselHint")}
                        onPress={() => {
                            audioManager.play("tap");
                            getRunController()?.toggleChisel();
                        }}
                    />
                    <HelperButton
                        label={t("HelperRecut")}
                        cost={RECUT_COST}
                        shards={shards}
                        active={false}
                        hint={t("HelperRecutHint")}
                        onPress={() => {
                            audioManager.play("tap");
                            getRunController()?.recut();
                        }}
                    />
                    <div className="helper-shards" role="status" aria-label={t("LabelShards")}>
                        <span className="shard-glyph" aria-hidden="true" />
                        <strong>{shards.toLocaleString()}</strong>
                    </div>
                </div>
            )}

            {runStatus === "stuck" && !summary && <StuckCard />}
            {summary && <ResultsCard />}
            {settingsOpen && <GameSettingsCard onClose={() => setSettingsOpen(false)} />}

            {/* The host owns the pause, but it must not own the ONLY way out.
                onPause fires for a platform dialog or a switch-away and the
                matching onResume can simply not arrive — and with a plain div
                inside a pointer-events-none overlay the run was then stuck
                until the player killed the app.

                A tap is the safe escape hatch precisely because it proves the
                host is not covering us: if a platform dialog were on top, the
                player could not reach this. So resuming on it can never fight
                an overlay the host still has up. */}
            {showPause && (
                <button type="button" className="pause-overlay pointer-events-auto" onClick={resumeFromPause}>
                    <div>
                        <p className="eyebrow">{t("PausedEyebrow")}</p>
                        <strong>{t("Paused")}</strong>
                        <span className="pause-hint">{t("PausedResume")}</span>
                    </div>
                </button>
            )}
        </div>
    );
}

function HelperButton({
    label,
    cost,
    shards,
    active,
    hint,
    onPress,
}: {
    label: string;
    cost: number;
    shards: number;
    active: boolean;
    hint: string;
    onPress: () => void;
}) {
    const affordable = shards >= cost || active;
    return (
        <button
            type="button"
            className={`helper-button pointer-events-auto${active ? " active" : ""}`}
            aria-pressed={active}
            title={hint}
            onClick={onPress}
        >
            <span className="helper-label">{label}</span>
            <span className={`helper-cost${affordable ? "" : " unaffordable"}`}>
                <span className="shard-glyph small" aria-hidden="true" />
                {cost}
            </span>
        </button>
    );
}

/**
 * The in-run settings card. Leaving to the menu's Settings screen would
 * abandon the run (runs are not saved), so the gameplay-relevant toggles live
 * here. Everything applies immediately: the scene hears reduced motion and
 * quality through GameCanvas, audio syncs off the store subscription.
 */
function GameSettingsCard({ onClose }: { onClose: () => void }) {
    const musicEnabled = useStore((s) => s.musicEnabled);
    const sfxEnabled = useStore((s) => s.sfxEnabled);
    const hapticsEnabled = useStore((s) => s.hapticsEnabled);
    const reducedMotion = useStore((s) => s.reducedMotion);
    const quality = useStore((s) => s.quality);

    const apply = (patch: Parameters<typeof store.patch>[0]) => {
        store.patch(patch);
        void saveSystem.flush();
    };

    return (
        <div className="run-card pointer-events-auto" role="dialog" aria-modal="true" aria-label={t("MenuSettings")}>
            <div className="run-card-body settings-card">
                <p className="eyebrow">{t("KickerSettings")}</p>
                <h2>{t("MenuSettings")}</h2>
                <div className="settings-list">
                    <SettingToggle
                        label={t("SettingsMusic")}
                        checked={musicEnabled}
                        onChange={(value) => apply({ musicEnabled: value })}
                    />
                    <SettingToggle
                        label={t("SettingsSfx")}
                        checked={sfxEnabled}
                        onChange={(value) => apply({ sfxEnabled: value })}
                    />
                    <SettingToggle
                        label={t("SettingsHaptics")}
                        checked={hapticsEnabled}
                        onChange={(value) => apply({ hapticsEnabled: value })}
                    />
                    <SettingToggle
                        label={t("SettingsReducedMotion")}
                        checked={reducedMotion}
                        onChange={(value) => {
                            document.documentElement.dataset.reducedMotion = String(value);
                            apply({ reducedMotion: value });
                        }}
                    />
                    <div className="setting-row">
                        <span>{t("SettingsQuality")}</span>
                        <div className="segmented">
                            <button
                                type="button"
                                className={quality === "low" ? "active" : ""}
                                onClick={() => apply({ quality: "low" })}
                            >
                                {t("SettingsLow")}
                            </button>
                            <button
                                type="button"
                                className={quality === "high" ? "active" : ""}
                                onClick={() => apply({ quality: "high" })}
                            >
                                {t("SettingsHigh")}
                            </button>
                        </div>
                    </div>
                </div>
                <button
                    type="button"
                    className="card-action primary"
                    onClick={() => {
                        audioManager.play("tap");
                        onClose();
                    }}
                >
                    {t("ButtonDone")}
                </button>
            </div>
        </div>
    );
}

/**
 * The stuck card (DESIGN.md §2.4). Four exits, and the ad is never the only
 * one: Recut and Chisel are always listed first, and Finish is always present.
 */
function StuckCard() {
    const shards = useStore((s) => s.shards);
    const secondFiringAvailable = useStore((s) => s.secondFiringAvailable);
    const [busy, setBusy] = useState(false);

    const controller = getRunController();
    const adOffered = secondFiringAvailable && rewardedAvailable(PLACEMENT.secondFiring);

    return (
        <div className="run-card pointer-events-auto" role="dialog" aria-modal="true" aria-label={t("StuckTitle")}>
            <div className="run-card-body">
                <p className="eyebrow">{t("StuckEyebrow")}</p>
                <h2>{t("StuckTitle")}</h2>
                <p className="run-card-copy">{t("StuckCopy")}</p>

                <button
                    type="button"
                    className="card-action primary"
                    disabled={busy || shards < RECUT_COST}
                    onClick={() => {
                        audioManager.play("tap");
                        controller?.recut();
                    }}
                >
                    {t("StuckRecut", { cost: RECUT_COST })}
                </button>
                <button
                    type="button"
                    className="card-action"
                    disabled={busy || shards < CHISEL_COST}
                    onClick={() => {
                        audioManager.play("tap");
                        controller?.toggleChisel();
                    }}
                >
                    {t("StuckChisel", { cost: CHISEL_COST })}
                </button>

                {/* A disabled helper is a question, not a dead end: when the
                    player cannot afford either exit, say why and how to earn. */}
                {shards < CHISEL_COST && <p className="stuck-note">{t("StuckNoShards", { shards })}</p>}

                {adOffered && (
                    <button
                        type="button"
                        className="card-action rewarded"
                        disabled={busy}
                        onClick={() => {
                            void (async () => {
                                setBusy(true);
                                monetizationTelemetry.record("offer_shown", {
                                    placement_id: PLACEMENT.secondFiring,
                                    surface: "stuck_card",
                                });
                                const outcome = await controller?.watchSecondFiring();
                                setBusy(false);
                                if (outcome === "unavailable") store.patch({ toast: t("AdUnavailable") });
                            })();
                        }}
                    >
                        {busy ? t("AdLoading") : t("StuckSecondFiring")}
                    </button>
                )}

                <button
                    type="button"
                    className="card-action quiet"
                    disabled={busy}
                    onClick={() => {
                        audioManager.play("tap");
                        void runtimeServices.haptic("light");
                        controller?.finish();
                    }}
                >
                    {t("StuckFinish")}
                </button>
            </div>
        </div>
    );
}

/** The results card — the first monetization surface a player ever sees. */
function ResultsCard() {
    const summary = useStore((s) => s.runSummary);
    const reducedMotion = useStore((s) => s.reducedMotion);
    // The final score counts up from where the card opens, so the number the
    // whole run was about gets a moment of its own.
    const rolling = useRollingNumber(summary?.score ?? 0, reducedMotion);
    const bestScore = useStore((s) => s.bestScore);
    const culletDoubled = useStore((s) => s.culletDoubled);
    const [busy, setBusy] = useState(false);
    const controller = getRunController();
    if (!summary) return null;

    const isRecord = summary.score > 0 && summary.score >= bestScore;
    const doubleOffered = !culletDoubled && summary.shards > 0 && rewardedAvailable(PLACEMENT.doubleCullet);

    return (
        <div className="run-card pointer-events-auto" role="dialog" aria-modal="true" aria-label={t("ResultsTitle")}>
            <div className="run-card-body">
                <p className="eyebrow">{isRecord ? t("ResultsRecord") : t("ResultsEyebrow")}</p>
                <h2 aria-label={String(summary.score)}>{rolling.value.toLocaleString()}</h2>

                <dl className="results-grid">
                    <div>
                        <dt>{t("LabelLines")}</dt>
                        <dd>{summary.linesFired}</dd>
                    </div>
                    <div>
                        <dt>{t("LabelBestCombo")}</dt>
                        <dd>x{summary.bestCombo}</dd>
                    </div>
                    <div>
                        <dt>{t("LabelCleanPanes")}</dt>
                        <dd>{summary.cleanPanes}</dd>
                    </div>
                    <div>
                        <dt>{t("LabelShards")}</dt>
                        <dd>
                            +{culletDoubled ? summary.shards * 2 : summary.shards}
                            {culletDoubled && <span className="doubled"> {t("ResultsDoubled")}</span>}
                        </dd>
                    </div>
                </dl>

                {doubleOffered && (
                    <button
                        type="button"
                        className="card-action rewarded"
                        disabled={busy}
                        onClick={() => {
                            void (async () => {
                                setBusy(true);
                                monetizationTelemetry.record("offer_shown", {
                                    placement_id: PLACEMENT.doubleCullet,
                                    surface: "results_card",
                                });
                                const outcome = await controller?.watchDoubleCullet();
                                setBusy(false);
                                if (outcome === "unavailable") store.patch({ toast: t("AdUnavailable") });
                            })();
                        }}
                    >
                        {busy ? t("AdLoading") : t("ResultsDoubleCullet", { shards: summary.shards })}
                    </button>
                )}

                <button
                    type="button"
                    className="card-action primary"
                    disabled={busy}
                    onClick={() => {
                        audioManager.play("tap");
                        store.patch({
                            runSummary: null,
                            score: 0,
                            combo: 0,
                            runLines: 0,
                            runStatus: "playing",
                            culletDoubled: false,
                            phase: "menu",
                        });
                        // Remount the canvas on the next frame with a fresh run.
                        window.requestAnimationFrame(() => store.patch({ phase: "playing" }));
                    }}
                >
                    {t("ResultsAgain")}
                </button>
                <button
                    type="button"
                    className="card-action quiet"
                    disabled={busy}
                    onClick={() => {
                        audioManager.play("tap");
                        void controller?.leaveResults();
                    }}
                >
                    {t("ResultsBench")}
                </button>
            </div>
        </div>
    );
}
