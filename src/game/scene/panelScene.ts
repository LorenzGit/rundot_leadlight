/**
 * The bench: the panel, the tray, and the drag between them.
 *
 * The scene owns presentation and input. It does not own the rules — every
 * legality question goes to `PuzzleRun`, so the board you see and the board
 * `npm run simulate` proves are the same board.
 *
 * Drag model (§8): picking a cut lifts it to board scale and floats it above
 * the finger, because a thumb covers exactly the cells you are trying to aim
 * at. The ghost snaps cell-to-cell and turns red the moment the drop would be
 * illegal, so a bad drop is never a surprise.
 */
import { type Application, Container, type FederatedPointerEvent, Graphics, Sprite, Texture } from "pixi.js";
import {
    context2d,
    createCanvas,
    drawCameLattice,
    type ShelfSlot,
    trayShelfCanvas,
    variantForCell,
} from "../art/glass.ts";
import { benchLightCanvas } from "../art/light.ts";
import { type PaletteId, palette, shade } from "../art/palette.ts";
import { createGlassTextures, type GlassTextures } from "../art/textures.ts";
import { BOARD_CELLS, BOARD_SIZE } from "../constants.ts";
import type { Piece } from "../puzzle/pieces.ts";
import type { PlacementResult, PuzzleRun } from "../puzzle/run.ts";
import type { Stage } from "../stage.ts";
import { createTweenController, ease } from "../tween.ts";
import { type Ambience, createAmbience } from "./ambience.ts";
import { cellAtPoint, cellOrigin, computeLayout, type Insets, type SceneLayout, trayCellSize } from "./layout.ts";
import { createEffects, type Effects, type FiringCell } from "./vfx.ts";

export type SceneSfx = "pick" | "place" | "reject" | "fire" | "combo" | "chisel" | "clean";
export type SceneHaptic = "light" | "medium" | "heavy" | "success" | "warning" | "error";

export interface PanelSceneCallbacks {
    /** After every successful placement, so the shell can mirror score/status. */
    onPlaced(result: PlacementResult): void;
    /** After a chisel removed a cell. */
    onChiselled(x: number, y: number): void;
    /** Fired when the armed chisel is spent or cancelled. */
    onChiselModeChanged(armed: boolean): void;
    /** A cut has been picked up or put down. */
    onDragChanged(active: boolean): void;
    sfx(cue: SceneSfx): void;
    haptic(style: SceneHaptic): void;
}

export interface PanelSceneOptions {
    app: Application;
    stage: Stage;
    run: PuzzleRun;
    paletteId: PaletteId;
    reducedMotion: boolean;
    quality: "high" | "low";
    insets: Insets;
    callbacks: PanelSceneCallbacks;
}

interface DragState {
    slot: number;
    piece: Piece;
    colourIndex: number;
    node: Container;
    /** Horizontal pointer offset from the piece's top-left, in design units. */
    grabX: number;
    pointerId: number;
    /** Where the cut sits in the tray, so an illegal drop can spring back. */
    homeX: number;
    homeY: number;
    homeScale: number;
    moved: boolean;
    /** Smoothed lean, in radians. */
    tilt: number;
}

/** Clearance between the finger and the carried cut's bottom edge, in board cells. */
const FINGER_CLEARANCE_CELLS = 0.9;

export class PanelScene {
    private readonly app: Application;
    private readonly stage: Stage;
    private readonly run: PuzzleRun;
    private readonly callbacks: PanelSceneCallbacks;

    private textures: GlassTextures;
    private paletteId: PaletteId;
    private reducedMotion: boolean;
    private quality: "high" | "low";
    private insets: Insets;
    private layout: SceneLayout;

    /** Everything that shakes. The root itself stays put so shake is additive. */
    private readonly shakeRoot = new Container();
    private readonly root = new Container();
    private readonly benchLayer = new Container();
    /** The stain the panel casts on the wood, beneath the frame. */
    private readonly stainLayer = new Container();
    private readonly frameLayer = new Graphics();
    private readonly wellLayer = new Container();
    private readonly glassLayer = new Container();
    /**
     * The board grid, drawn UNDER the wells and the glass.
     *
     * Over the glass it cut every placement into separate tiles, and a placed
     * cut has to read as one solid mass. Beneath, it shows through the empty
     * cells as the grid and is completely covered wherever glass sits.
     */
    private readonly cameLayer = new Sprite();
    /** The sill the tray cuts rest on, above the stain so it stays readable. */
    private readonly shelfLayer = new Sprite();
    /** Bucket key of the generated shelf texture, so resizes do not churn it. */
    private shelfKey = "";
    private readonly ghostLayer = new Graphics();
    private readonly trayLayer = new Container();
    private readonly dragLayer = new Container();
    private readonly fxLayer = new Container();
    /** Beam, dust and blooms — in the air, over everything. */
    private readonly airLayer = new Container();

    private bench: Sprite | null = null;
    /** Warm pool over the panel plus a vignette, as one generated texture. */
    private benchLight = new Sprite();
    private readonly wells: Sprite[] = [];
    private readonly glass: Sprite[] = [];
    private readonly trayNodes: Array<Container | null> = [null, null, null];

    private readonly tweens = createTweenController();
    private effects: Effects;
    private ambience: Ambience;

    /** Decaying screen shake, in design units. */
    private shake = 0;
    private shakeDecay = 0;

    private drag: DragState | null = null;
    private chiselArmed = false;
    private offResize: () => void;
    private destroyed = false;

    /** Development/QA counter: proves a harness tap actually did something. */
    movesPlayed = 0;

    /** Live count of in-flight effect objects, so QA can tell dead from invisible. */
    get effectsActive(): number {
        return this.effects.activeCount;
    }

    constructor(options: PanelSceneOptions) {
        this.app = options.app;
        this.stage = options.stage;
        this.run = options.run;
        this.callbacks = options.callbacks;
        this.paletteId = options.paletteId;
        this.reducedMotion = options.reducedMotion;
        this.quality = options.quality;
        this.insets = options.insets;
        this.textures = createGlassTextures(this.paletteId);
        this.layout = computeLayout(this.stage.designWidth(), this.stage.designHeight(), this.insets);

        this.root.addChild(
            this.benchLayer,
            this.stainLayer,
            this.frameLayer,
            this.cameLayer,
            this.wellLayer,
            this.glassLayer,
            this.shelfLayer,
            this.ghostLayer,
            this.trayLayer,
            this.fxLayer,
            this.dragLayer,
            this.airLayer,
        );
        this.shakeRoot.addChild(this.root);
        this.stage.root.addChild(this.shakeRoot);
        this.effects = createEffects(this.fxLayer, this.textures, this.reducedMotion, this.quality);
        this.ambience = createAmbience(
            { under: this.stainLayer, over: this.airLayer },
            palette(this.paletteId),
            this.reducedMotion,
            this.quality,
        );

        this.buildBoard();
        this.applyLayout();
        this.syncBoard();
        this.rebuildTray();

        this.root.eventMode = "static";
        this.root.on("pointerdown", this.onPointerDown);
        this.root.on("pointermove", this.onPointerMove);
        this.root.on("pointerup", this.onPointerUp);
        this.root.on("pointerupoutside", this.onPointerUp);
        this.root.on("pointercancel", this.onPointerUp);

        this.offResize = this.stage.onResize(() => {
            this.layout = computeLayout(this.stage.designWidth(), this.stage.designHeight(), this.insets);
            this.applyLayout();
            this.syncBoard();
            this.rebuildTray();
        });

        this.app.ticker.add(this.tick);
    }

    // -----------------------------------------------------------------------
    // Construction
    // -----------------------------------------------------------------------

    private buildBoard(): void {
        for (let index = 0; index < BOARD_CELLS; index++) {
            const well = new Sprite(this.textures.well());
            this.wellLayer.addChild(well);
            this.wells.push(well);

            const cell = new Sprite(this.textures.cell(0, variantForCell(index)));
            cell.visible = false;
            cell.anchor.set(0.5);
            this.glassLayer.addChild(cell);
            this.glass.push(cell);
        }
    }

    private applyLayout(): void {
        const { width, height, cellSize } = this.layout;

        // Bench: tiled oak grain under a soft top-light wash, so the studio has
        // a light source instead of a flat fill.
        if (!this.bench) {
            this.bench = new Sprite(this.textures.bench(width, height));
            this.benchLayer.addChild(this.bench, this.benchLight);
        }
        this.bench.texture = this.textures.bench(width, height);
        this.bench.width = width;
        this.bench.height = height;

        // Bench lighting comes from a generated texture, not a Graphics fill:
        // an ellipse has a hard edge and on a dark bench that edge is a visible
        // band across the screen.
        const focusY = (this.layout.frameY + this.layout.frameSize / 2) / Math.max(1, height);
        const lightPixels = 512;
        const lightCanvas = benchLightCanvas(
            lightPixels,
            Math.round(lightPixels * (height / Math.max(1, width))),
            focusY,
        );
        this.benchLight.texture?.destroy(true);
        this.benchLight.texture = Texture.from(lightCanvas);
        this.benchLight.width = width;
        this.benchLight.height = height;

        this.drawFrame();

        for (let index = 0; index < BOARD_CELLS; index++) {
            const x = index % BOARD_SIZE;
            const y = Math.floor(index / BOARD_SIZE);
            const origin = cellOrigin(this.layout, x, y);
            const well = this.wells[index];
            if (well) {
                well.x = origin.x;
                well.y = origin.y;
                well.width = cellSize;
                well.height = cellSize;
            }
            const cell = this.glass[index];
            if (cell) {
                cell.x = origin.x + cellSize / 2;
                cell.y = origin.y + cellSize / 2;
                cell.width = cellSize;
                cell.height = cellSize;
            }
        }

        this.drawCame();
        this.drawShelf();

        this.ambience.layout(width, height, {
            x: this.layout.panelX,
            y: this.layout.panelY,
            size: this.layout.panelSize,
        });
    }

    /**
     * The sill under the tray, regenerated only when its geometry or palette
     * actually changes. Drawn once into a texture for the same reason as the
     * came lattice: it never changes between layouts, and the plank's shadow
     * and pocket recesses stay crisp at any scale.
     */
    private drawShelf(): void {
        const { tray } = this.layout;
        if (!tray[0]) return;

        // The plank's rect comes from the layout, overhang already included.
        // Deriving it from the pockets here instead put its bottom lip below
        // the band the layout reserved, and the landscape helper buttons then
        // sat on the woodwork.
        const inset = 7;
        const { x, y, width, height } = this.layout.shelf;
        if (width <= 0 || height <= 0) return;

        const key = `${this.paletteId}:${Math.round(x / 8)}:${Math.round(y / 8)}:${Math.round(width / 8)}:${Math.round(height / 8)}`;
        if (key !== this.shelfKey) {
            this.shelfKey = key;
            const renderScale = Math.min(1.4, 768 / width);
            const slots: ShelfSlot[] = tray.map((slot) => ({
                x: (slot.x - x + inset) * renderScale,
                y: (slot.y - y + inset) * renderScale,
                width: (slot.width - inset * 2) * renderScale,
                height: (slot.height - inset * 2) * renderScale,
            }));
            const canvas = trayShelfCanvas(
                Math.round(width * renderScale),
                Math.round(height * renderScale),
                slots,
                palette(this.paletteId),
            );
            this.shelfLayer.texture?.destroy(true);
            this.shelfLayer.texture = Texture.from(canvas);
        }
        this.shelfLayer.position.set(x, y);
        this.shelfLayer.width = width;
        this.shelfLayer.height = height;
    }

    /**
     * Rebuild the came lattice texture for the current panel size.
     *
     * Drawn once into a texture rather than as Graphics every frame: it never
     * changes between layouts, and one continuous bitmap is also the only way
     * the intersections stay clean at any scale.
     */
    private drawCame(): void {
        const { panelSize } = this.layout;
        const pixels = Math.min(1_024, Math.max(256, Math.round(panelSize * 1.4)));
        const canvas = createCanvas(pixels, pixels);
        drawCameLattice(context2d(canvas), 0, 0, pixels, palette(this.paletteId));
        this.cameLayer.texture?.destroy(true);
        this.cameLayer.texture = Texture.from(canvas);
        this.cameLayer.x = this.layout.panelX;
        this.cameLayer.y = this.layout.panelY;
        this.cameLayer.width = panelSize;
        this.cameLayer.height = panelSize;
    }

    /**
     * The panel's mount. Two flat surfaces and nothing else: a mount a shade
     * above the stage, and the panel well a shade below it. The drop shadow,
     * the lit top half and the mitred rebate that used to be here were all
     * describing oak, and oak is not the art direction any more.
     */
    private drawFrame(): void {
        const active = palette(this.paletteId);
        const { frameX, frameY, frameSize, frameThickness, panelX, panelY, panelSize } = this.layout;
        this.frameLayer
            .clear()
            // Mount: a side wall under a lit face, the same light the tiles
            // are lit by, then the tray the tiles sit in.
            .roundRect(frameX, frameY + frameThickness * 0.4, frameSize, frameSize, frameThickness * 1.1)
            .fill(shade(active.frame, -0.36))
            .roundRect(frameX, frameY, frameSize, frameSize, frameThickness * 1.1)
            .fill(shade(active.frame, 0.08))
            .roundRect(panelX, panelY, panelSize, panelSize, frameThickness * 0.8)
            .fill(shade(active.bench, -0.12));
    }

    // -----------------------------------------------------------------------
    // Board sync
    // -----------------------------------------------------------------------

    /** Push the run's board into the sprites. Cheap enough to call after any change. */
    private syncBoard(): void {
        const board = this.run.board;
        for (let index = 0; index < BOARD_CELLS; index++) {
            const sprite = this.glass[index];
            if (!sprite) continue;
            const value = board[index] ?? 0;
            if (value === 0) {
                sprite.visible = false;
                continue;
            }
            sprite.visible = true;
            sprite.alpha = 1;
            sprite.scale.set(1);
            sprite.texture = this.textures.cell(value - 1, variantForCell(index));
            sprite.width = this.layout.cellSize;
            sprite.height = this.layout.cellSize;
        }
        this.ambience.setBoard(board);
    }

    // -----------------------------------------------------------------------
    // Tray
    // -----------------------------------------------------------------------

    private rebuildTray(): void {
        for (let slot = 0; slot < this.trayNodes.length; slot++) {
            this.trayNodes[slot]?.destroy({ children: true });
            this.trayNodes[slot] = null;
        }
        this.trayLayer.removeChildren();

        this.run.tray.forEach((cut, slot) => {
            const box = this.layout.tray[slot];
            if (!cut || !box) return;
            const cellSize = trayCellSize(this.layout, cut.piece);
            const node = this.buildCutNode(cut.piece, cut.colourIndex, cellSize, true);
            node.x = box.centreX;
            node.y = box.centreY;
            // Cuts the player cannot use anywhere are dimmed rather than hidden:
            // knowing a cut is dead is information, and hiding it would look
            // like the game silently took it away.
            node.alpha = this.run.status === "over" ? 0.4 : 1;
            this.trayLayer.addChild(node);
            this.trayNodes[slot] = node;

            if (!this.reducedMotion) {
                node.scale.set(0.72);
                this.tweens.addTween(
                    (value) => {
                        // The ResizeObserver fires a rebuild immediately after
                        // mount, so this tween can outlive the node it was
                        // created for. A destroyed Container has a null
                        // `scale`, and the throw kills the whole ticker.
                        if (!node.destroyed) node.scale.set(value);
                    },
                    0.72,
                    1,
                    ease.outBack,
                    undefined,
                    { durationMs: 260, delayMs: slot * 55 },
                );
            }
        });
    }

    /**
     * A cut as a container of glass sprites, centred on its bounding box.
     *
     * The glass uses the same thin-edged cells the board does, and the lead is
     * drawn on top as came: a heavy line around the cut's silhouette and a
     * lighter seam between its own cells. Giving every cell a full border
     * instead makes a cut visibly change weight the moment it is picked up and
     * lands on the panel's lattice.
     */
    private buildCutNode(piece: Piece, colourIndex: number, cellSize: number, tray: boolean): Container {
        const node = new Container();
        const offsetX = (piece.width * cellSize) / 2;
        const offsetY = (piece.height * cellSize) / 2;

        // A cut resting in its pocket casts a soft shadow on the sill. It is a
        // child of the node, so it lifts with the piece; the carried cut gets
        // its own sharper shadow at pick-up time.
        if (tray) {
            const shadow = new Graphics();
            shadow
                .ellipse(0, offsetY * 0.86, piece.width * cellSize * 0.52, cellSize * 0.22)
                .fill({ color: 0x000000, alpha: 0.22 })
                .ellipse(0, offsetY * 0.84, piece.width * cellSize * 0.4, cellSize * 0.15)
                .fill({ color: 0x000000, alpha: 0.18 });
            node.addChild(shadow);
        }

        for (const cell of piece.cells) {
            // Seamless: the cut is one pour of glass; the bevel seams appear
            // when it lands on the panel and seats into the lattice.
            const sprite = new Sprite(this.textures.cell(colourIndex, cell.x + cell.y, true));
            sprite.width = cellSize;
            sprite.height = cellSize;
            sprite.x = cell.x * cellSize - offsetX;
            sprite.y = cell.y * cellSize - offsetY;
            node.addChild(sprite);
        }

        // No outline around the silhouette. There used to be a bar of came
        // traced round the whole cut with a lit edge along its exposed tops —
        // that was for glass held in lead, and against the chunky tiles it
        // reads as a hard border stuck on the piece. Each tile carries its own
        // extrusion now, which is all the definition a cut needs.
        return node;
    }

    // -----------------------------------------------------------------------
    // Input
    // -----------------------------------------------------------------------

    private readonly onPointerDown = (event: FederatedPointerEvent): void => {
        if (this.run.status === "over") return;
        const point = event.getLocalPosition(this.root);

        if (this.chiselArmed) {
            const cell = cellAtPoint(this.layout, point.x, point.y);
            if (cell && this.run.chisel(cell.x, cell.y)) {
                this.chiselArmed = false;
                this.callbacks.onChiselModeChanged(false);
                this.syncBoard();
                this.callbacks.sfx("chisel");
                this.callbacks.haptic("medium");
                this.effects.popup(
                    cellOrigin(this.layout, cell.x, cell.y).x + this.layout.cellSize / 2,
                    cellOrigin(this.layout, cell.x, cell.y).y,
                    "CHISELLED",
                    0xf3e6cd,
                    13,
                );
                this.callbacks.onChiselled(cell.x, cell.y);
            } else {
                this.callbacks.sfx("reject");
            }
            return;
        }

        const slot = this.traySlotAt(point.x, point.y);
        if (slot === null) return;
        const cut = this.run.tray[slot];
        const node = this.trayNodes[slot];
        if (!cut || !node) return;

        const cellSize = this.layout.cellSize;
        const carried = this.buildCutNode(cut.piece, cut.colourIndex, cellSize, false);
        // Anchor the carried cut by its top-left so the ghost maths is trivial.
        carried.pivot.set(-(cut.piece.width * cellSize) / 2, -(cut.piece.height * cellSize) / 2);

        // A shadow on the bench below, offset down-right to match the studio's
        // top-left key light. Without it the cut looks pasted onto the screen
        // rather than held above the panel.
        const shadow = new Graphics();
        for (const shadowCell of cut.piece.cells) {
            shadow
                .roundRect(
                    shadowCell.x * cellSize + cellSize * 0.08,
                    shadowCell.y * cellSize + cellSize * 0.08,
                    cellSize * 0.84,
                    cellSize * 0.84,
                    cellSize * 0.1,
                )
                .fill({ color: 0x000000, alpha: 0.34 });
        }
        shadow.pivot.copyFrom(carried.pivot);
        shadow.position.set(cellSize * 0.26, cellSize * 0.42);
        carried.addChildAt(shadow, 0);

        // No scale-up: the carried cut keeps exact board size, so the glass
        // over the finger always matches the cells it will land on. The lift
        // is sold by the shadow and the finger clearance, not by growth.
        this.dragLayer.addChild(carried);

        node.visible = false;
        this.drag = {
            slot,
            piece: cut.piece,
            colourIndex: cut.colourIndex,
            node: carried,
            grabX: (cut.piece.width * cellSize) / 2,
            pointerId: event.pointerId,
            homeX: node.x,
            homeY: node.y,
            homeScale: node.scale.x,
            moved: false,
            tilt: 0,
        };
        this.moveDrag(point.x, point.y);
        this.callbacks.onDragChanged(true);
        this.callbacks.sfx("pick");
        this.callbacks.haptic("light");
    };

    private readonly onPointerMove = (event: FederatedPointerEvent): void => {
        if (!this.drag || event.pointerId !== this.drag.pointerId) return;
        const point = event.getLocalPosition(this.root);
        this.drag.moved = true;
        this.moveDrag(point.x, point.y);
    };

    private readonly onPointerUp = (event: FederatedPointerEvent): void => {
        const drag = this.drag;
        if (!drag || event.pointerId !== drag.pointerId) return;
        this.drag = null;
        this.callbacks.onDragChanged(false);
        this.ghostLayer.clear();

        const target = this.dropTarget(drag);
        if (target && this.run.canPlaceAt(drag.slot, target.x, target.y)) {
            drag.node.destroy({ children: true });
            this.commitPlacement(drag.slot, target.x, target.y);
            return;
        }

        this.callbacks.sfx("reject");
        this.callbacks.haptic("warning");
        this.springBack(drag);
    };

    /** Return the carried cut to its slot, then reveal the tray node again. */
    private springBack(drag: DragState): void {
        const node = drag.node;
        const startX = node.x;
        const startY = node.y;
        const restore = (): void => {
            node.destroy({ children: true });
            const trayNode = this.trayNodes[drag.slot];
            if (trayNode) trayNode.visible = true;
        };
        if (this.reducedMotion) {
            restore();
            return;
        }
        // The pivot makes the carried node top-left anchored; the tray node is
        // centre anchored, so aim at the slot centre minus half the cut.
        const cellSize = this.layout.cellSize;
        const endX = drag.homeX - (drag.piece.width * cellSize) / 2;
        const endY = drag.homeY - (drag.piece.height * cellSize) / 2;
        this.tweens.addTween(
            (t) => {
                if (node.destroyed) return;
                node.x = startX + (endX - startX) * t;
                node.y = startY + (endY - startY) * t;
                node.rotation = drag.tilt * (1 - t);
                node.alpha = 1 - t * 0.4;
            },
            0,
            1,
            ease.outCubic,
            restore,
            { durationMs: 180 },
        );
    }

    private moveDrag(pointerX: number, pointerY: number): void {
        const drag = this.drag;
        if (!drag) return;
        const cellSize = this.layout.cellSize;
        // The cut floats so its BOTTOM edge clears the finger: anchoring by
        // the centre let tall cuts hang back down under the thumb, which is
        // exactly the hand position the player is trying to see.
        const nextX = pointerX - drag.grabX;
        const nextY = pointerY - drag.piece.height * cellSize - cellSize * FINGER_CLEARANCE_CELLS;

        if (!this.reducedMotion) {
            // Lean into horizontal motion and settle back when it stops, the
            // way a flat thing carried at arm's length does.
            const velocity = nextX - drag.node.x;
            drag.tilt += (Math.max(-1, Math.min(1, velocity / 26)) * 0.14 - drag.tilt) * 0.25;
            drag.node.rotation = drag.tilt;
        }

        drag.node.x = nextX;
        drag.node.y = nextY;
        this.drawGhost(drag);
    }

    /** Board origin the carried cut would occupy, snapped to the nearest cell. */
    private dropTarget(drag: DragState): { x: number; y: number } | null {
        const { cellSize, panelX, panelY } = this.layout;
        const x = Math.round((drag.node.x - panelX) / cellSize);
        const y = Math.round((drag.node.y - panelY) / cellSize);
        if (x < 0 || y < 0 || x + drag.piece.width > BOARD_SIZE || y + drag.piece.height > BOARD_SIZE) return null;
        return { x, y };
    }

    private drawGhost(drag: DragState): void {
        this.ghostLayer.clear();
        const target = this.dropTarget(drag);
        if (!target) return;
        const legal = this.run.canPlaceAt(drag.slot, target.x, target.y);
        const { cellSize } = this.layout;
        const colour = palette(this.paletteId).glass[drag.colourIndex % 6] ?? 0xffffff;

        for (const cell of drag.piece.cells) {
            const origin = cellOrigin(this.layout, target.x + cell.x, target.y + cell.y);
            this.ghostLayer
                .roundRect(
                    origin.x + cellSize * 0.055,
                    origin.y + cellSize * 0.055,
                    cellSize * 0.89,
                    cellSize * 0.89,
                    cellSize * 0.09,
                )
                .fill({ color: legal ? colour : 0xff6a5e, alpha: legal ? 0.3 : 0.18 })
                .stroke({ color: legal ? 0xfff3d8 : 0xff8c7e, width: cellSize * 0.05, alpha: 0.85 });
        }

        // Preview the firing: rows and columns this drop would complete glow.
        if (!legal) return;
        for (const line of this.previewLines(drag, target)) {
            if (line.kind === "row") {
                const origin = cellOrigin(this.layout, 0, line.index);
                this.ghostLayer
                    .rect(origin.x, origin.y, cellSize * BOARD_SIZE, cellSize)
                    .fill({ color: 0xfff2d2, alpha: 0.16 });
            } else {
                const origin = cellOrigin(this.layout, line.index, 0);
                this.ghostLayer
                    .rect(origin.x, origin.y, cellSize, cellSize * BOARD_SIZE)
                    .fill({ color: 0xfff2d2, alpha: 0.16 });
            }
        }
    }

    /** Rows/columns that would fire if the drag were dropped at `target`. */
    private previewLines(
        drag: DragState,
        target: { x: number; y: number },
    ): Array<{ kind: "row" | "col"; index: number }> {
        const occupied = new Set<number>();
        for (const cell of drag.piece.cells) {
            occupied.add((target.y + cell.y) * BOARD_SIZE + (target.x + cell.x));
        }
        const board = this.run.board;
        const filledAt = (x: number, y: number): boolean =>
            (board[y * BOARD_SIZE + x] ?? 0) !== 0 || occupied.has(y * BOARD_SIZE + x);

        const lines: Array<{ kind: "row" | "col"; index: number }> = [];
        for (let y = 0; y < BOARD_SIZE; y++) {
            let complete = true;
            for (let x = 0; x < BOARD_SIZE; x++) if (!filledAt(x, y)) complete = false;
            if (complete) lines.push({ kind: "row", index: y });
        }
        for (let x = 0; x < BOARD_SIZE; x++) {
            let complete = true;
            for (let y = 0; y < BOARD_SIZE; y++) if (!filledAt(x, y)) complete = false;
            if (complete) lines.push({ kind: "col", index: x });
        }
        return lines;
    }

    private traySlotAt(x: number, y: number): number | null {
        for (const box of this.layout.tray) {
            if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) {
                return this.run.tray[box.index] ? box.index : null;
            }
        }
        return null;
    }

    // -----------------------------------------------------------------------
    // Placement and choreography
    // -----------------------------------------------------------------------

    /** Public so the QA harness can play a move without synthesising a drag. */
    playSlot(slot: number, x: number, y: number): boolean {
        if (!this.run.canPlaceAt(slot, x, y)) return false;
        this.commitPlacement(slot, x, y);
        return true;
    }

    private commitPlacement(slot: number, x: number, y: number): void {
        // Snapshot the fired cells' colours BEFORE the run clears them, or the
        // shards would all be drawn in whatever colour happened to be left.
        const boardBefore = this.run.boardSnapshot();
        const result = this.run.place(slot, x, y);
        const trayNode = this.trayNodes[slot];
        if (trayNode) {
            trayNode.destroy({ children: true });
            this.trayNodes[slot] = null;
        }
        if (!result) return;

        this.movesPlayed += 1;
        this.syncBoard();
        this.popPlacedCells(result);
        this.callbacks.sfx("place");
        this.callbacks.haptic("light");

        if (result.linesFired > 0) {
            const fired: FiringCell[] = result.cleared.map((index) => ({
                x: index % BOARD_SIZE,
                y: Math.floor(index / BOARD_SIZE),
                colourIndex: Math.max(0, (boardBefore[index] ?? 1) - 1),
            }));
            const origin = { x: this.layout.panelX, y: this.layout.panelY };
            this.effects.flash(fired, this.layout.cellSize, origin, x, y);
            this.effects.shatter(fired, this.layout.cellSize, origin);

            // A light sweep runs the length of every line that fired, from the
            // placement outward. It is what makes a four-line clear read as
            // four events rather than as one large flash.
            for (const row of result.lines.rows) this.effects.sweep("row", row, this.layout, x);
            for (const column of result.lines.cols) this.effects.sweep("col", column, this.layout, y);

            // The kiln flares where the piece landed, and the whole bench takes
            // the hit — harder for a bigger clear and a longer combo.
            const cut = result.cut.piece;
            this.ambience.burst(
                this.layout.panelX + (x + cut.width / 2) * this.layout.cellSize,
                this.layout.panelY + (y + cut.height / 2) * this.layout.cellSize,
                this.layout.panelSize * 0.62,
                result.linesFired + Math.max(0, result.combo - 1) * 0.5,
            );
            this.addShake(2.2 + result.linesFired * 1.9 + Math.min(4, Math.max(0, result.combo - 1)));

            this.callbacks.sfx(result.combo >= 2 ? "combo" : "fire");
            this.callbacks.haptic(result.combo >= 3 ? "heavy" : "medium");

            const centre = {
                x: this.layout.panelX + this.layout.panelSize / 2,
                y: this.layout.panelY + this.layout.panelSize * 0.42,
            };
            if (result.cleanPane) {
                this.effects.banner(centre.x, centre.y, "CLEAN PANE", `+${result.score.cleanPane}`, 0xffe9a8);
                this.ambience.burst(centre.x, centre.y, this.layout.panelSize * 1.25, 6);
                this.addShake(9);
                this.callbacks.sfx("clean");
                this.callbacks.haptic("success");
            } else if (result.combo >= 2) {
                this.effects.banner(
                    centre.x,
                    centre.y,
                    `COMBO x${formatMultiplier(result.score.multiplier)}`,
                    `+${result.score.firing}`,
                    0xffd67a,
                );
            } else {
                this.effects.popup(centre.x, centre.y, `+${result.score.firing}`, 0xffe9a8, 22);
            }
        }

        if (result.refilled) this.rebuildTray();
        this.callbacks.onPlaced(result);
    }

    /** Newly placed cells punch in, staggered along the cut. */
    private popPlacedCells(result: PlacementResult): void {
        if (this.reducedMotion) return;
        result.filled.forEach((index, order) => {
            // A cell that fired in the same beat is already gone; do not animate
            // it back into visibility.
            if ((this.run.board[index] ?? 0) === 0) return;
            const sprite = this.glass[index];
            if (!sprite) return;
            sprite.scale.set(0.66);
            const target = this.layout.cellSize;
            this.tweens.addTween(
                (value) => {
                    if (sprite.destroyed) return;
                    sprite.width = target * value;
                    sprite.height = target * value;
                },
                0.66,
                1,
                ease.outBack,
                undefined,
                { durationMs: 210, delayMs: order * 26 },
            );
        });
    }

    // -----------------------------------------------------------------------
    // Helpers driven from the shell
    // -----------------------------------------------------------------------

    setChiselArmed(armed: boolean): void {
        if (this.chiselArmed === armed) return;
        this.chiselArmed = armed;
        if (armed) this.cancelDrag();
        this.callbacks.onChiselModeChanged(armed);
    }

    get chiselIsArmed(): boolean {
        return this.chiselArmed;
    }

    /** After a recut or a Second Firing, the whole surface is redrawn. */
    refresh(): void {
        this.cancelDrag();
        this.syncBoard();
        this.rebuildTray();
    }

    /** The Second Firing clears rows without a placement; choreograph it too. */
    celebrateSecondFiring(clearedIndices: readonly number[], boardBefore: Uint8Array): void {
        const fired: FiringCell[] = clearedIndices.map((index) => ({
            x: index % BOARD_SIZE,
            y: Math.floor(index / BOARD_SIZE),
            colourIndex: Math.max(0, (boardBefore[index] ?? 1) - 1),
        }));
        const origin = { x: this.layout.panelX, y: this.layout.panelY };
        this.effects.flash(fired, this.layout.cellSize, origin, BOARD_SIZE / 2, BOARD_SIZE / 2);
        this.effects.shatter(fired, this.layout.cellSize, origin);
        this.ambience.burst(
            this.layout.panelX + this.layout.panelSize / 2,
            this.layout.panelY + this.layout.panelSize / 2,
            this.layout.panelSize * 1.3,
            7,
        );
        this.addShake(11);
        this.effects.banner(
            this.layout.panelX + this.layout.panelSize / 2,
            this.layout.panelY + this.layout.panelSize * 0.42,
            "SECOND FIRING",
            "THE KILN CLEARS THE PANEL",
            0xffd67a,
        );
        this.callbacks.sfx("clean");
    }

    setReducedMotion(reduced: boolean): void {
        this.reducedMotion = reduced;
        this.effects.setReducedMotion(reduced);
        this.ambience.setReducedMotion(reduced);
        if (reduced) {
            this.shake = 0;
            this.shakeRoot.position.set(0, 0);
        }
    }

    setQuality(quality: "high" | "low"): void {
        this.quality = quality;
        this.effects.setQuality(quality);
        this.ambience.setQuality(quality);
    }

    setInsets(insets: Insets): void {
        this.insets = insets;
        this.layout = computeLayout(this.stage.designWidth(), this.stage.designHeight(), this.insets);
        this.applyLayout();
        this.syncBoard();
        this.rebuildTray();
    }

    setPalette(paletteId: PaletteId): void {
        if (paletteId === this.paletteId) return;
        this.paletteId = paletteId;
        const previous = this.textures;
        this.textures = createGlassTextures(paletteId);
        this.effects.clear();
        this.effects = createEffects(this.fxLayer, this.textures, this.reducedMotion, this.quality);
        this.ambience.setPalette(palette(paletteId));
        for (let index = 0; index < BOARD_CELLS; index++) {
            const well = this.wells[index];
            if (well) well.texture = this.textures.well();
        }
        if (this.bench) this.bench.texture = this.textures.bench(this.layout.width, this.layout.height);
        this.applyLayout();
        this.syncBoard();
        this.rebuildTray();
        previous.destroy();
    }

    /**
     * Play the firing choreography on demand, without needing the board to
     * actually complete a line.
     *
     * A firing is the most expensive thing in the game to look at and the
     * hardest to reach on purpose — a screenshot only catches one by luck. This
     * is how `visual-qa.mjs` reviews it on every run. Presentation only: it
     * touches no rules and awards nothing.
     */
    previewFiring(rows: readonly number[], columns: readonly number[], combo = 1): void {
        const cells: FiringCell[] = [];
        const seen = new Set<number>();
        const push = (x: number, y: number): void => {
            const index = y * BOARD_SIZE + x;
            if (seen.has(index)) return;
            seen.add(index);
            cells.push({ x, y, colourIndex: (x + y) % 6 });
        };
        for (const row of rows) for (let x = 0; x < BOARD_SIZE; x++) push(x, row);
        for (const column of columns) for (let y = 0; y < BOARD_SIZE; y++) push(column, y);
        if (cells.length === 0) return;

        const origin = { x: this.layout.panelX, y: this.layout.panelY };
        this.effects.flash(cells, this.layout.cellSize, origin, 0, rows[0] ?? 0);
        this.effects.shatter(cells, this.layout.cellSize, origin);
        for (const row of rows) this.effects.sweep("row", row, this.layout, 0);
        for (const column of columns) this.effects.sweep("col", column, this.layout, 0);

        const lines = rows.length + columns.length;
        const centre = {
            x: this.layout.panelX + this.layout.panelSize / 2,
            y: this.layout.panelY + this.layout.panelSize * 0.42,
        };
        this.ambience.burst(centre.x, centre.y, this.layout.panelSize * 0.62, lines + combo * 0.5);
        this.addShake(2.2 + lines * 1.9 + Math.min(4, Math.max(0, combo - 1)));
        if (combo >= 2) this.effects.banner(centre.x, centre.y, `COMBO x${combo}`, `+${lines * 30}`, 0xffd67a);
        this.callbacks.sfx(combo >= 2 ? "combo" : "fire");
    }

    /**
     * Real positions for the QA harness, already in CLIENT pixels.
     *
     * A harness that computes tap coordinates from the viewport taps empty
     * bench: the SDK mock reports a phone-shaped safe area in `vite dev`, which
     * moves the whole layout by tens of design units. The scene is the only
     * thing that knows where the cuts actually are, so it is the thing that
     * answers.
     */
    qaGeometry(): {
        tray: Array<{ slot: number; clientX: number; clientY: number } | null>;
        /** A legal drop for the first usable cut, as a client-space target. */
        firstLegalDrop: { slot: number; clientX: number; clientY: number } | null;
        movesPlayed: number;
        status: string;
        score: number;
    } {
        const rect = this.app.canvas.getBoundingClientRect();
        const scale = this.stage.scale() || 1;
        const toClient = (x: number, y: number) => ({
            clientX: rect.left + x * scale,
            clientY: rect.top + y * scale,
        });

        const tray = this.layout.tray.map((box) =>
            this.run.tray[box.index] ? { slot: box.index, ...toClient(box.centreX, box.centreY) } : null,
        );

        let firstLegalDrop: { slot: number; clientX: number; clientY: number } | null = null;
        for (let slot = 0; slot < this.run.tray.length && !firstLegalDrop; slot++) {
            const cut = this.run.tray[slot];
            if (!cut) continue;
            for (let y = 0; y < BOARD_SIZE && !firstLegalDrop; y++) {
                for (let x = 0; x < BOARD_SIZE && !firstLegalDrop; x++) {
                    if (!this.run.canPlaceAt(slot, x, y)) continue;
                    // The drop point is where the FINGER must be: below the
                    // cut's bottom edge by the clearance the drag applies.
                    const centre = cellOrigin(this.layout, x, y);
                    firstLegalDrop = {
                        slot,
                        ...toClient(
                            centre.x + (cut.piece.width * this.layout.cellSize) / 2,
                            centre.y +
                                cut.piece.height * this.layout.cellSize +
                                this.layout.cellSize * FINGER_CLEARANCE_CELLS,
                        ),
                    };
                }
            }
        }
        return {
            tray,
            firstLegalDrop,
            movesPlayed: this.movesPlayed,
            status: this.run.status,
            score: this.run.score,
        };
    }

    private cancelDrag(): void {
        if (!this.drag) return;
        const trayNode = this.trayNodes[this.drag.slot];
        if (trayNode) trayNode.visible = true;
        this.drag.node.destroy({ children: true });
        this.drag = null;
        this.callbacks.onDragChanged(false);
        this.ghostLayer.clear();
    }

    private readonly tick = (): void => {
        if (this.destroyed) return;
        const dt = this.app.ticker.deltaMS / 1_000;
        this.tweens.update(dt);
        this.effects.update(dt);
        this.ambience.update(dt);
        this.updateShake(dt);
    };

    /**
     * Decaying shake, applied to a wrapper rather than to `root` so the scene's
     * own coordinates never move — every layout number stays exactly where it
     * was computed, and the shake cannot accumulate drift.
     */
    private updateShake(dtSeconds: number): void {
        if (this.shake <= 0) {
            if (this.shakeRoot.x !== 0 || this.shakeRoot.y !== 0) this.shakeRoot.position.set(0, 0);
            return;
        }
        this.shake = Math.max(0, this.shake - this.shakeDecay * dtSeconds);
        // Alternating rather than random: a random offset per frame reads as
        // noise, a sign-flipping one reads as an impact.
        const phase = performance.now() * 0.06;
        this.shakeRoot.position.set(Math.sin(phase) * this.shake, Math.cos(phase * 1.37) * this.shake * 0.7);
    }

    /** Kick the shake. Ignored entirely under reduced motion. */
    private addShake(units: number): void {
        if (this.reducedMotion) return;
        this.shake = Math.min(14, Math.max(this.shake, units));
        this.shakeDecay = Math.max(24, this.shake * 3.4);
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.app.ticker.remove(this.tick);
        this.offResize();
        this.root.off("pointerdown", this.onPointerDown);
        this.root.off("pointermove", this.onPointerMove);
        this.root.off("pointerup", this.onPointerUp);
        this.root.off("pointerupoutside", this.onPointerUp);
        this.root.off("pointercancel", this.onPointerUp);
        this.tweens.clear();
        this.effects.destroy();
        this.ambience.destroy();
        this.cameLayer.texture?.destroy(true);
        this.benchLight.texture?.destroy(true);
        this.shelfLayer.texture?.destroy(true);
        this.shakeRoot.destroy({ children: true });
        this.textures.destroy();
    }
}

/** `1.25` reads better than `1.3` on a combo badge; `2` better than `2.0`. */
function formatMultiplier(multiplier: number): string {
    return Number.isInteger(multiplier) ? String(multiplier) : multiplier.toFixed(2).replace(/0$/, "");
}
