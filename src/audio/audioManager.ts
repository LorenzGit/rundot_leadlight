/**
 * All of LEADLIGHT's sound, synthesised at runtime. No audio files ship.
 *
 * The palette is glass: struck partials with fast decays rather than tones.
 * A real glass strike is a handful of inharmonic partials — a plain sine reads
 * as a beep, so every cue here layers two or three detuned partials with
 * different decays, and the firing chime transposes up with the combo so a long
 * streak audibly climbs.
 *
 * Ambience is a slow bowed-glass drone: two detuned voices through a lowpass
 * that opens and closes, which is enough to feel like a room without becoming
 * a melody the player has to listen to for six minutes.
 */
import { store } from "../state/store.ts";

export type SfxCue =
    | "tap"
    | "start"
    | "pick"
    | "place"
    | "reject"
    | "fire"
    | "combo"
    | "chisel"
    | "clean"
    | "reward"
    | "gameover";

export interface AudioDebugSnapshot {
    contextState: AudioContextState | "locked";
    ambienceRunning: boolean;
    ambienceStep: number;
    activeMusicVoices: number;
    activeSfxVoices: number;
    suppressedSfx: number;
}

interface Partial {
    ratio: number;
    gain: number;
    decay: number;
}

interface CueDefinition {
    /** Fundamental in Hz. */
    frequency: number;
    partials: Partial[];
    peak: number;
    type: OscillatorType;
    /** Pitch glide over the cue's life, as a multiplier of the fundamental. */
    glide?: number;
    /** Milliseconds before an identical cue may retrigger. */
    cooldownMs: number;
    /** A touch of filtered noise, for the chisel's chip and the reject thud. */
    noise?: { duration: number; gain: number; frequency: number };
}

const CUES: Readonly<Record<SfxCue, CueDefinition>> = {
    // UI
    tap: {
        frequency: 880,
        partials: [
            { ratio: 1, gain: 1, decay: 0.06 },
            { ratio: 2.76, gain: 0.3, decay: 0.04 },
        ],
        peak: 0.05,
        type: "sine",
        cooldownMs: 50,
    },
    start: {
        frequency: 392,
        partials: [
            { ratio: 1, gain: 1, decay: 0.5 },
            { ratio: 2.01, gain: 0.44, decay: 0.36 },
            { ratio: 3.02, gain: 0.2, decay: 0.24 },
        ],
        peak: 0.07,
        type: "triangle",
        glide: 1.5,
        cooldownMs: 220,
    },

    // Handling glass
    pick: {
        frequency: 1_320,
        partials: [
            { ratio: 1, gain: 1, decay: 0.05 },
            { ratio: 3.41, gain: 0.34, decay: 0.03 },
        ],
        peak: 0.045,
        type: "sine",
        cooldownMs: 40,
    },
    place: {
        frequency: 300,
        partials: [
            { ratio: 1, gain: 1, decay: 0.1 },
            { ratio: 2.4, gain: 0.42, decay: 0.06 },
            { ratio: 5.1, gain: 0.16, decay: 0.035 },
        ],
        peak: 0.07,
        type: "triangle",
        cooldownMs: 40,
    },
    reject: {
        frequency: 132,
        partials: [
            { ratio: 1, gain: 1, decay: 0.14 },
            { ratio: 1.51, gain: 0.32, decay: 0.1 },
        ],
        peak: 0.06,
        type: "triangle",
        glide: 0.72,
        cooldownMs: 160,
        noise: { duration: 0.07, gain: 0.05, frequency: 380 },
    },
    chisel: {
        frequency: 2_100,
        partials: [
            { ratio: 1, gain: 1, decay: 0.035 },
            { ratio: 4.2, gain: 0.4, decay: 0.02 },
        ],
        peak: 0.05,
        type: "square",
        cooldownMs: 90,
        noise: { duration: 0.05, gain: 0.07, frequency: 3_400 },
    },

    // Firing
    fire: {
        frequency: 660,
        partials: [
            { ratio: 1, gain: 1, decay: 0.44 },
            { ratio: 2.03, gain: 0.5, decay: 0.32 },
            { ratio: 3.94, gain: 0.24, decay: 0.2 },
        ],
        peak: 0.085,
        type: "sine",
        cooldownMs: 60,
    },
    combo: {
        frequency: 784,
        partials: [
            { ratio: 1, gain: 1, decay: 0.56 },
            { ratio: 2.01, gain: 0.56, decay: 0.42 },
            { ratio: 3.02, gain: 0.3, decay: 0.3 },
            { ratio: 5.06, gain: 0.14, decay: 0.18 },
        ],
        peak: 0.09,
        type: "sine",
        cooldownMs: 60,
    },
    clean: {
        frequency: 523.25,
        partials: [
            { ratio: 1, gain: 1, decay: 1 },
            { ratio: 1.5, gain: 0.66, decay: 0.86 },
            { ratio: 2, gain: 0.5, decay: 0.72 },
            { ratio: 3, gain: 0.26, decay: 0.5 },
        ],
        peak: 0.095,
        type: "sine",
        cooldownMs: 260,
    },
    reward: {
        frequency: 587.33,
        partials: [
            { ratio: 1, gain: 1, decay: 0.7 },
            { ratio: 1.5, gain: 0.6, decay: 0.58 },
            { ratio: 2.52, gain: 0.28, decay: 0.4 },
        ],
        peak: 0.09,
        type: "triangle",
        glide: 1.34,
        cooldownMs: 240,
    },
    gameover: {
        frequency: 220,
        partials: [
            { ratio: 1, gain: 1, decay: 0.9 },
            { ratio: 1.19, gain: 0.44, decay: 0.7 },
            { ratio: 2.41, gain: 0.2, decay: 0.44 },
        ],
        peak: 0.08,
        type: "triangle",
        glide: 0.76,
        cooldownMs: 400,
    },
};

/** Bowed-glass drone: a slow four-chord cycle under the bench. */
const DRONE_CHORDS = [
    [110, 164.81, 220],
    [98, 146.83, 196],
    [123.47, 185, 246.94],
    [87.31, 130.81, 174.61],
] as const;
const DRONE_STEP_SECONDS = 5.4;
const SCHEDULE_AHEAD_SECONDS = 0.6;
/** Consecutive firings raise the chime by this many semitones, capped. */
const COMBO_SEMITONES = 1.5;
const COMBO_SEMITONE_CAP = 12;

class AudioManager {
    private context: AudioContext | null = null;
    private master: GainNode | null = null;
    private musicBus: GainNode | null = null;
    private sfxBus: GainNode | null = null;
    private noiseBuffer: AudioBuffer | null = null;
    private droneTimer = 0;
    private droneStep = 0;
    private nextDroneTime = 0;
    private musicVoices = new Set<AudioScheduledSourceNode>();
    private sfxVoices = new Set<AudioScheduledSourceNode>();
    private lastCueAt = new Map<SfxCue, number>();
    private suppressedSfx = 0;
    private paused = false;
    private hostPaused = false;
    private hostOverlayVisible = false;
    private pageHidden = document.visibilityState !== "visible";
    private bound = false;
    /** Raised by the scene so the firing chime climbs with the combo. */
    private comboLevel = 0;

    bind(): void {
        if (this.bound) return;
        this.bound = true;
        store.subscribe(() => this.sync());
        document.addEventListener("visibilitychange", () => {
            this.pageHidden = document.visibilityState !== "visible";
            this.applyPauseState();
        });
    }

    async unlock(): Promise<boolean> {
        try {
            this.ensureGraph();
            if (!this.context) return false;
            if (this.paused) return false;
            if (this.context.state === "suspended") await this.context.resume();
            this.sync();
            return this.context.state === "running";
        } catch (error) {
            console.warn("[audio] WebAudio unavailable", error);
            return false;
        }
    }

    setPaused(paused: boolean): void {
        this.hostPaused = paused;
        this.applyPauseState();
    }

    /**
     * Any host-owned UI the player is interacting with — a rewarded video, an
     * interstitial, a checkout sheet. Not just ads: music playing over an open
     * purchase flow is the same defect as music over an ad, and checkout was
     * only ever protected by the host's own pause. Kept separate from the
     * persisted volume/mute settings, and separate from the host pause, so
     * neither one can be lifted while the other still applies.
     */
    setHostOverlayVisible(visible: boolean): void {
        this.hostOverlayVisible = visible;
        this.applyPauseState();
    }

    /** The scene reports the live combo so `fire`/`combo` transpose upward. */
    setComboLevel(combo: number): void {
        this.comboLevel = Math.max(0, combo);
    }

    private applyPauseState(): void {
        this.paused = this.hostPaused || this.pageHidden || this.hostOverlayVisible;
        if (!this.context) return;
        if (this.paused) {
            this.stopAmbience();
            void this.context.suspend().catch(() => undefined);
        } else {
            void this.context
                .resume()
                .then(() => this.sync())
                .catch(() => undefined);
        }
    }

    play(cue: SfxCue): void {
        const state = store.get();
        if (!this.context || !this.sfxBus || this.paused || !state.sfxEnabled || state.sfxVolume <= 0) return;

        const definition = CUES[cue];
        const realNow = performance.now();
        if (realNow - (this.lastCueAt.get(cue) ?? -Infinity) < definition.cooldownMs) {
            this.suppressedSfx += 1;
            return;
        }
        this.lastCueAt.set(cue, realNow);

        // Only the firing chimes climb; a rising "reject" would be nonsense.
        const transpose =
            cue === "fire" || cue === "combo"
                ? 2 ** (Math.min(this.comboLevel * COMBO_SEMITONES, COMBO_SEMITONE_CAP) / 12)
                : 1;

        const now = this.context.currentTime;
        for (const partial of definition.partials) {
            const oscillator = this.context.createOscillator();
            const envelope = this.context.createGain();
            const frequency = definition.frequency * partial.ratio * transpose;
            oscillator.type = definition.type;
            oscillator.frequency.setValueAtTime(frequency, now);
            if (definition.glide && definition.glide !== 1) {
                oscillator.frequency.exponentialRampToValueAtTime(
                    Math.max(20, frequency * definition.glide),
                    now + partial.decay,
                );
            }
            const peak = Math.max(0.0002, definition.peak * partial.gain);
            envelope.gain.setValueAtTime(0.0001, now);
            envelope.gain.exponentialRampToValueAtTime(peak, now + 0.004);
            envelope.gain.exponentialRampToValueAtTime(0.0001, now + partial.decay);
            oscillator.connect(envelope).connect(this.sfxBus);
            this.trackVoice(oscillator, [envelope], this.sfxVoices);
            oscillator.start(now);
            oscillator.stop(now + partial.decay + 0.02);
        }

        if (definition.noise) this.playNoise(definition.noise, now);
    }

    /** Filtered noise burst — the chip of a chisel, the thud of a bad drop. */
    private playNoise(spec: { duration: number; gain: number; frequency: number }, now: number): void {
        if (!this.context || !this.sfxBus) return;
        const buffer = this.ensureNoiseBuffer();
        if (!buffer) return;
        const source = this.context.createBufferSource();
        const filter = this.context.createBiquadFilter();
        const envelope = this.context.createGain();
        source.buffer = buffer;
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(spec.frequency, now);
        filter.Q.value = 1.4;
        envelope.gain.setValueAtTime(spec.gain, now);
        envelope.gain.exponentialRampToValueAtTime(0.0001, now + spec.duration);
        source.connect(filter).connect(envelope).connect(this.sfxBus);
        this.trackVoice(source, [filter, envelope], this.sfxVoices);
        source.start(now);
        source.stop(now + spec.duration + 0.01);
    }

    debugSnapshot(): AudioDebugSnapshot {
        return {
            contextState: this.context?.state ?? "locked",
            ambienceRunning: this.droneTimer !== 0,
            ambienceStep: this.droneStep,
            activeMusicVoices: this.musicVoices.size,
            activeSfxVoices: this.sfxVoices.size,
            suppressedSfx: this.suppressedSfx,
        };
    }

    private ensureGraph(): void {
        if (this.context) return;
        const AudioContextCtor = window.AudioContext;
        if (!AudioContextCtor) return;
        this.context = new AudioContextCtor();
        this.master = this.context.createGain();
        this.musicBus = this.context.createGain();
        this.sfxBus = this.context.createGain();
        const limiter = this.context.createDynamicsCompressor();
        limiter.threshold.value = -18;
        limiter.knee.value = 18;
        limiter.ratio.value = 4;
        limiter.attack.value = 0.004;
        limiter.release.value = 0.24;
        this.musicBus.connect(this.master);
        this.sfxBus.connect(this.master);
        this.master.connect(limiter).connect(this.context.destination);
    }

    private ensureNoiseBuffer(): AudioBuffer | null {
        if (this.noiseBuffer || !this.context) return this.noiseBuffer;
        const length = Math.floor(this.context.sampleRate * 0.4);
        const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
        const data = buffer.getChannelData(0);
        // A tiny LCG rather than Math.random: game logic must stay seeded, and
        // an audio buffer that differs per boot is a needless nondeterminism.
        let seed = 0x9e3779b9;
        for (let i = 0; i < length; i++) {
            seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
            data[i] = (seed / 0xffff_ffff) * 2 - 1;
        }
        this.noiseBuffer = buffer;
        return buffer;
    }

    private sync(): void {
        if (!this.context || !this.master || !this.musicBus || !this.sfxBus) return;
        const state = store.get();
        const now = this.context.currentTime;
        this.musicBus.gain.setTargetAtTime(state.musicEnabled ? state.musicVolume : 0, now, 0.2);
        this.sfxBus.gain.setTargetAtTime(state.sfxEnabled ? state.sfxVolume : 0, now, 0.03);
        this.master.gain.setTargetAtTime(this.paused ? 0 : 0.6, now, 0.08);
        if (state.musicEnabled && state.musicVolume > 0 && !this.paused && this.context.state === "running") {
            this.startAmbience();
        } else {
            this.stopAmbience();
        }
    }

    private startAmbience(): void {
        if (!this.context || !this.musicBus || this.droneTimer !== 0) return;
        this.nextDroneTime = this.context.currentTime + 0.1;
        this.scheduleAmbience();
        this.droneTimer = window.setInterval(() => this.scheduleAmbience(), 400);
    }

    private scheduleAmbience(): void {
        if (!this.context || !this.musicBus || this.paused) return;
        while (this.nextDroneTime < this.context.currentTime + SCHEDULE_AHEAD_SECONDS) {
            const chord = DRONE_CHORDS[this.droneStep % DRONE_CHORDS.length] ?? DRONE_CHORDS[0];
            chord.forEach((frequency, index) => {
                // Two detuned voices per note: a single oscillator is a test
                // tone, a pair beating slowly is a bowed rim.
                this.scheduleDroneVoice(
                    frequency,
                    this.nextDroneTime,
                    DRONE_STEP_SECONDS * 1.25,
                    0.02 / (index + 1),
                    0,
                );
                this.scheduleDroneVoice(
                    frequency,
                    this.nextDroneTime,
                    DRONE_STEP_SECONDS * 1.25,
                    0.014 / (index + 1),
                    index === 0 ? 0.6 : 1.4,
                );
            });
            this.droneStep += 1;
            this.nextDroneTime += DRONE_STEP_SECONDS;
        }
    }

    private scheduleDroneVoice(
        frequency: number,
        startAt: number,
        duration: number,
        peak: number,
        detuneCents: number,
    ): void {
        if (!this.context || !this.musicBus) return;
        const oscillator = this.context.createOscillator();
        const filter = this.context.createBiquadFilter();
        const envelope = this.context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, startAt);
        oscillator.detune.setValueAtTime(detuneCents, startAt);
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(700, startAt);
        // The filter opening and closing is what stops the drone reading as a
        // held organ chord.
        filter.frequency.linearRampToValueAtTime(1_500, startAt + duration * 0.45);
        filter.frequency.linearRampToValueAtTime(620, startAt + duration);
        filter.Q.value = 0.6;
        envelope.gain.setValueAtTime(0.0001, startAt);
        envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), startAt + duration * 0.34);
        envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
        oscillator.connect(filter).connect(envelope).connect(this.musicBus);
        this.trackVoice(oscillator, [filter, envelope], this.musicVoices);
        oscillator.start(startAt);
        oscillator.stop(startAt + duration + 0.05);
    }

    private trackVoice(
        source: AudioScheduledSourceNode,
        chain: AudioNode[],
        collection: Set<AudioScheduledSourceNode>,
    ): void {
        collection.add(source);
        source.addEventListener(
            "ended",
            () => {
                collection.delete(source);
                source.disconnect();
                for (const node of chain) node.disconnect();
            },
            { once: true },
        );
    }

    private stopAmbience(): void {
        if (this.droneTimer) window.clearInterval(this.droneTimer);
        this.droneTimer = 0;
        if (!this.context) return;
        const stopAt = this.context.currentTime + 0.12;
        for (const voice of this.musicVoices) {
            try {
                voice.stop(stopAt);
            } catch {
                /* already stopped */
            }
        }
        this.musicVoices.clear();
    }
}

export const audioManager = new AudioManager();
