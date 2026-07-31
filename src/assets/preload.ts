/**
 * Boot warming.
 *
 * LEADLIGHT ships no image files: every texture is generated from the Canvas2D
 * art in `src/game/art/`. What "loading" actually does here is compose the two
 * menu backdrops (portrait and landscape) and publish them as CSS variables, so
 * the first painted menu already has its art rather than popping it in a frame
 * later.
 *
 * Failure posture: a backdrop that cannot be composed must never brick boot —
 * the stylesheet's flat bench colour is the fallback.
 */
import { backdropDataUrl } from "../game/art/backdrop.ts";
import { DEFAULT_PALETTE, isPaletteId } from "../game/art/palette.ts";
import { store } from "../state/store.ts";

/** Composed once per palette; switching palettes in the Atelier recomposes. */
const cache = new Map<string, { portrait: string; wide: string }>();

export function applyMenuBackdrop(paletteIdInput: string = store.get().selectedPalette): void {
    const paletteId = isPaletteId(paletteIdInput) ? paletteIdInput : DEFAULT_PALETTE;
    try {
        let composed = cache.get(paletteId);
        if (!composed) {
            composed = {
                // Composed at a modest size and stretched by `background-size:
                // cover`: the art is soft light and glass, so the extra pixels
                // of a device-resolution render buy nothing but memory.
                // The rose hangs in the middle of the screen: the header owns
                // the top, the controls are anchored to the bottom, and the
                // glass belongs in the open bench between them.
                portrait: backdropDataUrl({
                    width: 720,
                    height: 1_280,
                    paletteId,
                    panelScale: 0.56,
                    centreY: 0.37,
                }),
                // Landscape hangs the rose under the TITLE, in the left column:
                // the controls own the right, and glass behind buttons is glass
                // nobody reads.
                wide: backdropDataUrl({
                    width: 1_280,
                    height: 720,
                    paletteId,
                    panelScale: 0.62,
                    centreX: 0.28,
                    centreY: 0.44,
                }),
            };
            cache.set(paletteId, composed);
        }
        const root = document.documentElement;
        root.style.setProperty("--scene-backdrop-portrait", `url("${composed.portrait}")`);
        root.style.setProperty("--scene-backdrop-wide", `url("${composed.wide}")`);
        root.dataset.backdrop = paletteId;
    } catch (error) {
        console.warn("[preload] menu backdrop could not be composed — using the flat bench", error);
    }
}

/**
 * @param onProgress 0..1, called as boot work completes; always ends at 1.
 */
export async function warmAssets(onProgress: (progress: number) => void = () => {}): Promise<void> {
    onProgress(0.15);

    // Wait for @font-face fonts so the first painted screen does not swap fonts
    // mid-frame, and so canvas text measures with the real face.
    try {
        await document.fonts.ready;
    } catch {
        /* older engines */
    }
    onProgress(0.5);

    applyMenuBackdrop();
    onProgress(1);
}
