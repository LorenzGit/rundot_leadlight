/**
 * Firing choreography — DESIGN.md §8.
 *
 * A firing is four beats: the line whitens from the placement outward, holds
 * one beat of bloom, breaks into shards, and throws a score popup. Reduced
 * motion keeps the whiten and the popup, collapses the timings, and drops the
 * shard rain entirely rather than cutting straight to the cleared board.
 *
 * Type sizes are in design units. One design unit is about 0.55 CSS px on a
 * phone, so every intended size here is the CSS size multiplied by 1.83.
 */
import { Container, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { bloomCanvas } from "../art/light.ts";
import type { GlassTextures } from "../art/textures.ts";
import { NoiseRandom } from "../noiseRandom.ts";
import type { SceneLayout } from "./layout.ts";

const TEXT_UNITS_PER_CSS_PX = 1.83;

/** Half the board: which side of it a placement fell on picks the sweep direction. */
const BOARD_MIDPOINT = 4;

/** Convert an intended CSS pixel size into a canvas `fontSize`. */
export function typeSize(cssPx: number): number {
    return Math.round(cssPx * TEXT_UNITS_PER_CSS_PX);
}

interface Shard {
    sprite: Sprite;
    vx: number;
    vy: number;
    spin: number;
    life: number;
    lifeMs: number;
}

interface Flash {
    sprite: Sprite;
    life: number;
    lifeMs: number;
    delay: number;
}

/** A bright band travelling the length of a fired row or column. */
interface Sweep {
    /** The whole fired line, holding a steady glow. */
    glow: Sprite;
    /** The bright head travelling along it. */
    head: Sprite;
    life: number;
    lifeMs: number;
    axis: "row" | "col";
    /** Absolute design-unit start and end of the head's travel. */
    from: number;
    to: number;
    thickness: number;
    /** Absolute design-unit position of the line on the other axis. */
    cross: number;
    /** Absolute design-unit extent of the line itself. */
    lineFrom: number;
    lineTo: number;
}

interface Popup {
    node: Container;
    life: number;
    lifeMs: number;
    riseUnits: number;
    startY: number;
}

export interface FiringCell {
    x: number;
    y: number;
    colourIndex: number;
}

export interface Effects {
    /** White bloom over each cell, rippling outward from `(fromX, fromY)`. */
    flash(cells: readonly FiringCell[], cellSize: number, origin: Origin, fromX: number, fromY: number): void;
    /** Shards falling from each fired cell. */
    shatter(cells: readonly FiringCell[], cellSize: number, origin: Origin): void;
    /**
     * A light band running the length of a fired line, away from `fromCell`.
     * This is the beat that makes a multi-line clear legible as several events.
     */
    sweep(axis: "row" | "col", index: number, layout: SceneLayout, fromCell: number): void;
    /** A number that floats up and fades. */
    popup(x: number, y: number, text: string, colour: number, cssPx?: number): void;
    /** The combo banner, larger and with a subtitle. */
    banner(x: number, y: number, title: string, subtitle: string, colour: number): void;
    setReducedMotion(reduced: boolean): void;
    /** "low" thins the shard rain for weaker devices; it never removes a beat. */
    setQuality(quality: "high" | "low"): void;
    update(dtSeconds: number): void;
    clear(): void;
    destroy(): void;
    readonly activeCount: number;
}

export interface Origin {
    x: number;
    y: number;
}

export function createEffects(
    layer: Container,
    textures: GlassTextures,
    reducedMotion: boolean,
    quality: "high" | "low" = "high",
): Effects {
    const shards: Shard[] = [];
    const flashes: Flash[] = [];
    const sweeps: Sweep[] = [];
    const popups: Popup[] = [];
    // Seeded so a replayed run throws identical debris; visual only, but a
    // deterministic scene is a scene you can screenshot-test.
    const random = new NoiseRandom(0x1ead_1176, 0);
    // The warm halo a banner stands in. One texture, tinted per banner.
    const bannerGlowTexture = Texture.from(bloomCanvas(128));
    let reduced = reducedMotion;
    let shardsPerCell = quality === "high" ? 3 : 1;

    function popupStyle(cssPx: number, colour: number, weight: "bold" | "900" = "900"): TextStyle {
        // Sans, heavy: a serif score popup at speed reads as a watermark.
        return new TextStyle({
            fontFamily: "ui-rounded, 'SF Pro Rounded', 'Avenir Next', 'Segoe UI', Roboto, system-ui, sans-serif",
            fontSize: typeSize(cssPx),
            fontWeight: weight,
            fill: colour,
            stroke: { color: 0x120f16, width: typeSize(cssPx) * 0.16, join: "round" },
            align: "center",
        });
    }

    return {
        flash(cells, cellSize, origin, fromX, fromY) {
            for (const cell of cells) {
                const sprite = new Sprite(Texture.WHITE);
                sprite.tint = 0xfff6e2;
                sprite.width = cellSize;
                sprite.height = cellSize;
                sprite.x = origin.x + cell.x * cellSize;
                sprite.y = origin.y + cell.y * cellSize;
                sprite.blendMode = "add";
                layer.addChild(sprite);
                const distance = Math.hypot(cell.x - fromX, cell.y - fromY);
                const lifeMs = reduced ? 140 : 300;
                flashes.push({ sprite, life: lifeMs, lifeMs, delay: reduced ? 0 : distance * 16 });
            }
        },

        sweep(axis, index, layout, fromCell) {
            const { cellSize, panelX, panelY, panelSize } = layout;
            const thickness = cellSize * 0.98;
            const cross = (axis === "row" ? panelY : panelX) + index * cellSize;
            const start = axis === "row" ? panelX : panelY;

            const glow = new Sprite(Texture.WHITE);
            glow.tint = 0xffdfa4;
            glow.blendMode = "add";
            const head = new Sprite(Texture.WHITE);
            head.tint = 0xfffaf0;
            head.blendMode = "add";
            if (axis === "row") {
                glow.width = panelSize;
                glow.height = thickness;
                glow.position.set(start, cross);
                head.height = thickness;
                head.y = cross;
            } else {
                glow.width = thickness;
                glow.height = panelSize;
                glow.position.set(cross, start);
                head.width = thickness;
                head.x = cross;
            }
            layer.addChild(glow, head);

            // Travel away from where the piece landed, so the light reads as
            // thrown BY the placement rather than arriving from nowhere.
            const forward = fromCell < BOARD_MIDPOINT;
            const lifeMs = reduced ? 170 : 480;
            sweeps.push({
                glow,
                head,
                life: lifeMs,
                lifeMs,
                axis,
                from: forward ? start - cellSize : start + panelSize + cellSize,
                to: forward ? start + panelSize + cellSize : start - cellSize,
                thickness,
                cross,
                lineFrom: start,
                lineTo: start + panelSize,
            });
        },

        shatter(cells, cellSize, origin) {
            if (reduced) return;
            for (const cell of cells) {
                const centreX = origin.x + (cell.x + 0.5) * cellSize;
                const centreY = origin.y + (cell.y + 0.5) * cellSize;
                for (let i = 0; i < shardsPerCell; i++) {
                    const sprite = new Sprite(textures.shard(cell.colourIndex, i));
                    const size = cellSize * random.float(0.3, 0.52);
                    sprite.anchor.set(0.5);
                    sprite.width = size;
                    sprite.height = size;
                    sprite.x = centreX + random.float(-cellSize * 0.24, cellSize * 0.24);
                    sprite.y = centreY + random.float(-cellSize * 0.24, cellSize * 0.24);
                    sprite.rotation = random.float(0, Math.PI * 2);
                    layer.addChild(sprite);
                    const lifeMs = random.float(420, 760);
                    shards.push({
                        sprite,
                        vx: random.float(-190, 190),
                        vy: random.float(-320, -90),
                        spin: random.float(-6, 6),
                        life: lifeMs,
                        lifeMs,
                    });
                }
            }
        },

        popup(x, y, text, colour, cssPx = 19) {
            const node = new Text({ text, style: popupStyle(cssPx, colour) });
            node.anchor.set(0.5);
            node.x = x;
            node.y = y;
            layer.addChild(node);
            const lifeMs = reduced ? 460 : 820;
            popups.push({ node, life: lifeMs, lifeMs, riseUnits: reduced ? 22 : 74, startY: y });
        },

        banner(x, y, title, subtitle, colour) {
            const node = new Container();
            // A halo behind the type: a combo is the loudest moment in the
            // game, and bare text over the panel read as a watermark.
            const halo = new Sprite(bannerGlowTexture);
            halo.anchor.set(0.5);
            halo.blendMode = "add";
            halo.tint = colour;
            halo.width = 340;
            halo.height = 190;
            halo.alpha = 0.85;
            halo.y = -16;
            const heading = new Text({ text: title, style: popupStyle(30, colour) });
            heading.anchor.set(0.5, 1);
            const caption = new Text({ text: subtitle, style: popupStyle(12, 0xf3e6cd, "bold") });
            caption.anchor.set(0.5, 0);
            caption.y = 6;
            node.addChild(halo, heading, caption);
            node.x = x;
            node.y = y;
            layer.addChild(node);
            const lifeMs = reduced ? 620 : 1_050;
            popups.push({ node, life: lifeMs, lifeMs, riseUnits: reduced ? 16 : 52, startY: y });
        },

        setReducedMotion(value) {
            reduced = value;
        },

        setQuality(value) {
            shardsPerCell = value === "high" ? 3 : 1;
        },

        update(dtSeconds) {
            const dtMs = dtSeconds * 1_000;

            for (let i = flashes.length - 1; i >= 0; i--) {
                const flash = flashes[i];
                if (!flash) continue;
                if (flash.delay > 0) {
                    flash.delay -= dtMs;
                    flash.sprite.alpha = 0;
                    continue;
                }
                flash.life -= dtMs;
                const ratio = Math.max(0, flash.life / flash.lifeMs);
                flash.sprite.alpha = ratio * 0.94;
                if (flash.life <= 0) {
                    flash.sprite.destroy();
                    flashes.splice(i, 1);
                }
            }

            for (let i = sweeps.length - 1; i >= 0; i--) {
                const sweep = sweeps[i];
                if (!sweep) continue;
                sweep.life -= dtMs;
                const ratio = Math.max(0, sweep.life / sweep.lifeMs);
                const travel = 1 - ratio;
                const head = sweep.from + (sweep.to - sweep.from) * travel;
                const length = sweep.thickness * 3.2;
                // The whole line holds a glow for the duration while a brighter
                // head travels along it: the head alone is too small and fast to
                // register, the glow alone has no direction.
                sweep.glow.alpha = ratio * 0.42;
                sweep.head.alpha = Math.min(1, ratio * 1.8) * 0.95;
                if (sweep.axis === "row") {
                    sweep.head.width = length;
                    sweep.head.x = head - length / 2;
                } else {
                    sweep.head.height = length;
                    sweep.head.y = head - length / 2;
                }
                if (sweep.life <= 0) {
                    sweep.glow.destroy();
                    sweep.head.destroy();
                    sweeps.splice(i, 1);
                }
            }

            for (let i = shards.length - 1; i >= 0; i--) {
                const shard = shards[i];
                if (!shard) continue;
                shard.life -= dtMs;
                shard.vy += 1_500 * dtSeconds;
                shard.sprite.x += shard.vx * dtSeconds;
                shard.sprite.y += shard.vy * dtSeconds;
                shard.sprite.rotation += shard.spin * dtSeconds;
                const ratio = Math.max(0, shard.life / shard.lifeMs);
                shard.sprite.alpha = Math.min(1, ratio * 1.8);
                if (shard.life <= 0) {
                    shard.sprite.destroy();
                    shards.splice(i, 1);
                }
            }

            for (let i = popups.length - 1; i >= 0; i--) {
                const popup = popups[i];
                if (!popup) continue;
                popup.life -= dtMs;
                const ratio = Math.max(0, popup.life / popup.lifeMs);
                const progress = 1 - ratio;
                popup.node.y = popup.startY - popup.riseUnits * (1 - (1 - progress) ** 3);
                popup.node.alpha = Math.min(1, ratio * 2.4);
                const pop = 1 + 0.16 * Math.sin(Math.min(1, progress * 4) * Math.PI);
                popup.node.scale.set(pop);
                if (popup.life <= 0) {
                    popup.node.destroy({ children: true });
                    popups.splice(i, 1);
                }
            }
        },

        clear() {
            for (const sweep of sweeps) {
                sweep.glow.destroy();
                sweep.head.destroy();
            }
            sweeps.length = 0;
            for (const flash of flashes) flash.sprite.destroy();
            for (const shard of shards) shard.sprite.destroy();
            for (const popup of popups) popup.node.destroy({ children: true });
            flashes.length = 0;
            shards.length = 0;
            popups.length = 0;
        },

        destroy() {
            this.clear();
            bannerGlowTexture.destroy(true);
        },

        get activeCount() {
            return flashes.length + sweeps.length + shards.length + popups.length;
        },
    };
}
