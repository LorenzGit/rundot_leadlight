import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { rundotGameLibrariesPlugin, rundotGamePlaygroundPlugin } from "@series-inc/rundot-game-sdk/vite";

const playgroundEnabled = process.env.RUNDOT_PLAYGROUND === "1";

const plugins = [rundotGameLibrariesPlugin(), react(), tailwindcss()];

// Playground talks to real RUN services and requires sign-in, so it must never
// ambush ordinary local development. Purchases made there are real/persistent.
if (playgroundEnabled) plugins.push(rundotGamePlaygroundPlugin());

export default defineConfig({
    // REQUIRED for RUN: deployed builds are served from a subdirectory, so all
    // asset URLs must be relative. Do not change this.
    base: "./",
    plugins,
    server: {
        allowedHosts: true,
        // Distinct from every other game in this workspace, and well clear of
        // the SDK companion's hardcoded 9001.
        port: 5187,
    },
    build: {
        // Top-level await in the RUN SDK needs a modern target.
        target: "es2022",
        chunkSizeWarningLimit: 800,
        rollupOptions: {
            output: {
                /**
                 * Vendor libraries get their own chunks so they cache
                 * independently of game code — and so the standalone build,
                 * where React is bundled rather than supplied by the RUN host,
                 * does not pile everything into one chunk over the 600 kB
                 * budget `scripts/check-build.mjs` enforces.
                 *
                 * Firebase deliberately has no rule: nothing on this game's
                 * code path imports it, and giving it one emits an empty chunk
                 * and an extra request for zero bytes.
                 */
                manualChunks(id) {
                    if (!id.includes("node_modules")) return undefined;
                    if (id.includes("node_modules/pixi.js")) return "pixi";
                    if (/node_modules\/(?:react|react-dom|scheduler)\//.test(id)) return "react";
                    return undefined;
                },
            },
        },
    },
    esbuild: { target: "es2022" },
    optimizeDeps: {
        esbuildOptions: {
            target: "es2022",
        },
    },
});
