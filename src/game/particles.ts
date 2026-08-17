import { Graphics } from "pixi.js";
import { NoiseRandom } from "./noiseRandom.ts";

/**
 * Very small particle burst helper. Texture-free, one container-owned loop.
 *
 * Everything here is in design units per second. That matters: an earlier
 * version stored velocity in units-per-millisecond but added gravity in
 * units-per-second, so gravity landed 1000x too strong and every burst
 * rained off the bottom of the screen within ~200 ms. Keep one unit system.
 */
export interface ParticleDef {
    x: number;
    y: number;
    /** Velocity in design units per second. */
    vx: number;
    vy: number;
    lifeMs: number;
    radius: number;
    hue: number;
    /** Downward pull in design units per second squared. */
    gravity: number;
    /** Fraction of speed retained after one second of flight. */
    drag: number;
}

interface LiveParticle {
    g: Graphics;
    vx: number;
    vy: number;
    life: number;
    lifeMs: number;
    spin: number;
    radius: number;
    gravity: number;
    drag: number;
}

export interface EmitterOptions {
    burst: number;
    lifeMinMs: number;
    lifeMaxMs: number;
    speedMinPxPerSec: number;
    speedMaxPxPerSec: number;
    /**
     * Radius in design units. The design stage is 720 units on the short edge,
     * so on a 390px-wide phone one design unit is ~0.54 CSS px — anything under
     * ~4 units renders as a sub-2px speck and disappears into painted art.
     */
    radiusMinPx: number;
    radiusMaxPx: number;
    /**
     * Downward pull in design units per second squared. The design stage is
     * 720 units on the short edge, so ~500 gives a readable confetti arc over
     * a half-second life and ~100 reads as a near-weightless sparkle.
     */
    gravityPxPerSec2: number;
    /**
     * Fraction of speed retained after one second of flight (0..1). Applied as
     * `drag ** dtSeconds`, so the feel is identical at 60 Hz and 120 Hz.
     */
    dragPerSec: number;
    /** Centre of the emission arc, radians. Only used when `arcRad` < 2π. */
    directionRad: number;
    /** Angular width of the emission arc. Defaults to a full ring. */
    arcRad: number;
    hue?: number;
}

export interface ParticleEmitter {
    burst(x: number, y: number, opts?: Partial<EmitterOptions>): void;
    update(dtSeconds: number): void;
    destroy(): void;
    get activeCount(): number;
    /** Live particle state in design units. QA reads this to assert bursts stay on screen. */
    sample(): Array<{ x: number; y: number; vy: number; alpha: number; radius: number }>;
}

/** Hard ceiling so a stuck celebration loop cannot allocate without bound. */
const MAX_PARTICLES = 260;

const DEFAULT_OPTIONS: EmitterOptions = {
    burst: 18,
    lifeMinMs: 260,
    lifeMaxMs: 560,
    speedMinPxPerSec: 60,
    speedMaxPxPerSec: 290,
    radiusMinPx: 4,
    radiusMaxPx: 9,
    gravityPxPerSec2: 480,
    dragPerSec: 0.4,
    directionRad: -Math.PI / 2,
    arcRad: Math.PI * 2,
    hue: 210,
};

function hexFromHsl(h: number, s: number, l: number): number {
    const c = (1 - Math.abs((2 * l) / 100 - 1)) * (s / 100);
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l / 100 - c / 2;

    let r = 0;
    let g = 0;
    let b = 0;
    const hh = ((h % 360) + 360) % 360;
    if (hh < 60) [r, g, b] = [c, x, 0];
    else if (hh < 120) [r, g, b] = [x, c, 0];
    else if (hh < 180) [r, g, b] = [0, c, x];
    else if (hh < 240) [r, g, b] = [0, x, c];
    else if (hh < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    const to255 = (v: number): number => Math.round((v + m) * 255);
    return (to255(r) << 16) | (to255(g) << 8) | to255(b);
}

export function createParticleEmitter(
    root: { addChild: (g: Graphics) => void },
    random = new NoiseRandom(),
): ParticleEmitter {
    const particles = new Set<LiveParticle>();

    function retire(p: LiveParticle): void {
        p.g.removeFromParent();
        p.g.destroy();
        particles.delete(p);
    }

    function spawn(def: ParticleDef): void {
        // A Set iterates in insertion order, so the first entry is the oldest.
        while (particles.size >= MAX_PARTICLES) {
            const oldest = particles.values().next().value;
            if (!oldest) break;
            retire(oldest);
        }

        const g = new Graphics();
        const p: LiveParticle = {
            g,
            vx: def.vx,
            vy: def.vy,
            life: def.lifeMs,
            lifeMs: def.lifeMs,
            spin: random.float(-1.25, 1.25),
            radius: def.radius,
            gravity: def.gravity,
            drag: def.drag,
        };

        g.circle(0, 0, def.radius);
        g.fill({ color: hexFromHsl(def.hue, 90, random.float(58, 86)), alpha: 0.95 });
        g.x = def.x;
        g.y = def.y;
        root.addChild(g);
        particles.add(p);
    }

    function randomRange(min: number, max: number): number {
        return random.float(min, Math.max(min + 0.0001, max));
    }

    return {
        burst(x, y, opts) {
            const o = { ...DEFAULT_OPTIONS, ...(opts || {}) };
            const baseHue = Number.isFinite(o.hue as number) ? (o.hue as number) : 210;
            const count = Math.max(1, Math.round(o.burst));
            const arc = Math.min(Math.PI * 2, Math.max(0, o.arcRad));
            const fullRing = arc >= Math.PI * 2 - 0.0001;
            const step = (fullRing ? Math.PI * 2 : arc) / count;
            // Keep the angular jitter inside one slot so a narrow cone stays a
            // cone instead of smearing back into a ring.
            const jitter = Math.min(0.25, step * 0.5);
            const drag = Math.min(1, Math.max(0, o.dragPerSec));

            for (let i = 0; i < count; i++) {
                const base = fullRing ? step * i : o.directionRad - arc / 2 + step * (i + 0.5);
                const angle = base + random.float(-jitter, jitter);
                const speed = randomRange(o.speedMinPxPerSec, o.speedMaxPxPerSec);
                const life = randomRange(o.lifeMinMs, o.lifeMaxMs);
                const r = randomRange(o.radiusMinPx, o.radiusMaxPx);
                const hue = baseHue + random.float(-30, 30);

                spawn({
                    x: x + random.float(-1.5, 1.5),
                    y: y + random.float(-1.5, 1.5),
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    lifeMs: life,
                    radius: r,
                    hue: hue % 360,
                    gravity: o.gravityPxPerSec2,
                    drag,
                });
            }
        },

        update(dtSeconds: number) {
            if (!particles.size) return;
            const dtMs = dtSeconds * 1000;

            // Deleting from a Set mid-iteration is well defined, so retiring
            // in place avoids a per-frame scratch array.
            for (const p of particles) {
                p.life -= dtMs;
                if (p.life <= 0) {
                    retire(p);
                    continue;
                }

                // Semi-implicit Euler, all terms in units/second.
                p.vy += p.gravity * dtSeconds;
                const decay = p.drag ** dtSeconds;
                p.vx *= decay;
                p.vy *= decay;
                p.g.x += p.vx * dtSeconds;
                p.g.y += p.vy * dtSeconds;

                // Fading alpha and scale together on the same linear ramp made
                // particles vanish around the midpoint of their life. Hold both
                // near full for most of the flight, then drop off at the end.
                const ratio = p.life / p.lifeMs;
                p.g.alpha = Math.min(1, ratio * 2.4);
                p.g.scale.set(0.4 + 0.6 * ratio);
                p.g.rotation += p.spin * dtSeconds;
            }
        },

        destroy() {
            for (const p of particles) {
                p.g.removeFromParent();
                p.g.destroy();
            }
            particles.clear();
        },

        get activeCount() {
            return particles.size;
        },

        sample() {
            return [...particles].map((p) => ({
                x: p.g.x,
                y: p.g.y,
                vy: p.vy,
                alpha: p.g.alpha,
                // Rendered radius in design units; multiply by stage.scale() for CSS px.
                radius: p.radius * p.g.scale.x,
            }));
        },
    };
}
