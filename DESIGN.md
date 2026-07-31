# LEADLIGHT — design canon

A portrait, single-thumb block puzzle in the Block Blast lineage, dressed as a
stained-glass workbench. This file is canon: every number the game uses for
rules, scoring, economy, or monetization is defined here first and implemented
from here. If code and this document disagree, the document is the bug report.

---

## 1. Pitch

You are cutting glass at a leaded-window bench. Three cut pieces wait in the
tray; you drag them into an 8×8 leaded panel. Fill a row or a column and the
kiln fires it — the glass lights, cracks, and falls away as shards. Keep firing
without running out of room.

No timer. No lives. One score, one board, one decision at a time.

**Session shape:** 90 seconds to 6 minutes. Fully playable one-handed in
portrait. Every run is a self-contained score attempt.

---

## 2. Rules

### 2.1 The panel

- The board is **8 × 8** cells. Every cell is empty or holds one glass cell.
- Cells are addressed `(col, row)`, origin top-left, `index = row * 8 + col`.

### 2.2 The tray

- The tray holds **3 cut pieces**. Pieces are drawn as a set of three.
- A piece may be dragged onto the panel at any position where **all of its
  cells land on empty board cells**. It cannot overlap, cannot hang off the
  edge, and **cannot be rotated** — the cut is the cut.
- Placing a piece empties its tray slot. When **all three slots are empty**, a
  new set of three is drawn. Slots are never refilled individually.

### 2.3 Firing

After a piece is placed, every row and every column that is now completely
full is cleared simultaneously. A cell belonging to both a full row and a full
column clears once.

Clears never cascade: the board does not settle, shift, or gravity-drop, so one
placement produces exactly one firing.

### 2.4 Stuck, and the end of a run

When **none of the pieces remaining in the tray can be placed anywhere**, the
run goes **stuck** — not over. This is checked after every placement, chisel,
and draw.

From stuck the player chooses:

- **Recut** (60 shards) — a fresh tray, which is always drawn solvable (§3.1),
  so this always resumes play.
- **Chisel** (40 shards) — remove a cell; if that opens a fit, play resumes.
- **Second Firing** (rewarded video, once per run, §6.2).
- **Finish** — accept the score and see the results.

The run is only **over** once the player finishes it. This is what gives shards
somewhere to go: the helpers are the difference between a 400-point run and a
900-point one, and the player is never surprised by a board that was already
lost two moves ago.

---

## 3. The cut set

Thirty-one shapes. `w×h` is the bounding box; weight is the base draw weight.

| Family | Shapes | Weight each |
| --- | --- | --- |
| Dot | `1×1` | 8 |
| Bars | `1×2`, `2×1` | 14 |
| | `1×3`, `3×1` | 13 |
| | `1×4`, `4×1` | 8 |
| | `1×5`, `5×1` | 4 |
| Square | `2×2` | 14 |
| | `3×3` | 3 |
| Rect | `2×3`, `3×2` | 6 |
| Corner (small L, 2×2 minus one cell) | 4 orientations | 10 |
| Corner (big L, 3×3 minus a 2×2) | 4 orientations | 5 |
| Tee (`3×2` / `2×3`) | 4 orientations | 5 |
| Skew (S/Z, `3×2` / `2×3`) | 4 orientations | 4 |
| Diagonal | `2×2` diagonal, both directions | 2 |

### 3.1 Draw rules

Drawing is deterministic given the run seed (`NoiseRandom`, never
`Math.random`). Three rules shape it:

1. **Crowding bias.** Let `f` be the fraction of filled cells. Each shape's
   effective weight is `base × (1 - f)^((cells - 1) × 0.55)`. On an empty board
   this is the base table; on a board that is 75 % full a 5-cell bar is drawn
   roughly a fifth as often as a domino. The board gets harder, not more unfair.
2. **Solvable draw.** A drawn set is rejected and re-rolled (up to 8 attempts)
   unless **at least one of its three pieces fits somewhere** on the board as it
   stands. If all 8 attempts fail, the first slot is replaced by the largest
   shape that does fit, falling back to `1×1`. The game never hands you a dead
   tray on the draw — it ends the run because of what *you* placed.
3. **No triple-identical sets.** A set where all three shapes are the same id is
   re-rolled once. Three identical `3×3` blocks is not difficulty, it is a bug
   report.

---

## 4. Scoring

| Event | Score |
| --- | --- |
| Placing a piece | `+1` per cell |
| Firing `L` lines at once | `+10 × L × (L + 1) / 2` → 10 / 30 / 60 / 100 / 150 |
| Clean pane (board empty after a firing) | `+250` |

**Combo.** A `combo` counter starts at 0 each run. A placement that fires at
least one line increments it; a placement that fires nothing resets it to 0.
The firing and clean-pane score of a placement is multiplied by

```
multiplier = min(1 + 0.25 × (combo - 1), 4.0)
```

so the first firing is ×1, the second consecutive ×1.25, and a run of thirteen
consecutive firings caps at ×4. Placement points are never multiplied. The
final value is floored.

`bestCombo` is the highest combo counter reached in the run and is the run's
secondary bragging number.

---

## 5. Economy

### 5.1 Shards

**Shards** are the only earned currency. They come from finished runs:

```
shards = floor(score / 15) + 10 × cleanPanes
```

The divisor is set from the balance sweep, not from taste. A median greedy run
scores 442, so a median run pays about **29 shards** — roughly half a Recut,
which makes the helpers a decision every run rather than something you save up
for. Crucially, a Recut buys about 210 points (≈14 shards) for its 60-shard
price, so **helpers are always loss-making in shards**. They buy a higher score,
never a profit, and no amount of banked shards can run away.

Re-run `npm run balance` after touching the cut weights, the crowding bias, or
the combo curve; those three are what move this number.

### 5.2 Sinks

Two in-run helpers, usable at any time and again from the stuck state (§2.4):

| Helper | Cost | Effect |
| --- | --- | --- |
| **Chisel** | 40 shards | Arm it, then tap one filled cell to remove it. Emptying a cell can never complete a line, so a chisel scores nothing and leaves the combo alone. |
| **Recut** | 60 shards | Discard the whole tray and draw a fresh set of three. Does not reset the combo. |

Neither helper is sold for Run Bits, ever. Shards are not sold for Run Bits.
This keeps the earned economy and the paid economy completely separate — the
non-payer promise in §6 depends on it.

### 5.3 Palettes (cosmetic)

The glass colour family. Purely visual; the shapes, the odds, and the scoring
are identical in every palette.

| Palette | Unlock |
| --- | --- |
| **Atelier** — amber, cobalt, viridian, rose, plum, ochre | starter |
| **Verdant** — mosses, sea greens, bottle glass | 800 shards |
| **Nocturne** — indigo, slate, ultramarine, silver | 1 600 shards |
| **Aurora** — cold pinks and greens | entitlement `leadlight_palette_pack_aurora` |
| **Cathedral** — deep liturgical reds and golds | entitlement `leadlight_palette_pack_aurora` |
| **Ember** — furnace orange and iron | entitlement `leadlight_palette_ember` |

Two of the six are reachable by playing. The other three are the paid
cosmetics.

---

## 6. Monetization

**Model:** hybrid. Cosmetics and an ad-free upgrade priced in Run Bits, plus
optional rewarded video and one capped interstitial.

**Non-payer promise.** Nothing purchasable changes a shape, a draw weight, a
score, or the size of the board. Every rule in §2–§4 is identical for a payer
and a non-payer. Two palettes are earnable. The only thing a non-payer cannot
decline is one interstitial after every third completed run, from their second
session onward.

**Purchase architecture:** RUN Shop + authoritative Entitlements. Durable
cosmetic and ad-free unlocks need cross-device ownership, an order ledger, and
refunds; a client-owned grant loses all three the first time the player changes
device.

**First exposure:** the results screen of the player's first finished run,
where they see a score, shards, and the Atelier for the first time.

### 6.1 Products (`rundot/shop.config.json`)

| Product id | Item id | Price | Grants |
| --- | --- | --- | --- |
| `palette_pack` | `leadlight_palette_pack_aurora` | **199 RB** | Aurora + Cathedral palettes |
| `ad_free` | `leadlight_no_interstitials` | **249 RB** | Removes the between-runs interstitial forever |
| `glazier_pass` | `leadlight_glazier_pass` | **399 RB** | All of the above **plus** the Ember palette |

Prices are launch hypotheses, not facts. They are set against the comparable RB
tiers already shipped in this workspace (SETTEBELLO's 199 / 299 / 399 cosmetic
ladder) and against the standard casual-puzzle expectation that a cosmetic pack
sits below an ad-free upgrade, which sits below a bundle that contains both at a
visible discount (199 + 249 = 448 → 399, an 11 % saving plus an exclusive).
**Rollback signal:** if bundle attach rate is under 25 % of all purchases after
two weeks, the bundle is underpriced relative to its parts, not overpriced —
raise `ad_free` to 299 before touching the bundle. If total payer conversion is
under 0.4 %, drop `palette_pack` to 149 first, since it is the entry product.

Products are offered only after the player has finished the run count in
`PRODUCT_UNLOCK_RUNS`: `palette_pack` after 1, `ad_free` after 3,
`glazier_pass` after 3.

### 6.2 Ad placements

Self-authored `adDisplayId`s; there is no platform-side placement registry.

| Placement | Format | Trigger | Gates |
| --- | --- | --- | --- |
| `second_firing` | rewarded | Stuck card (§2.4), "SECOND FIRING" | ≥1 finished run; once per run; cooldown 0 s; 3/session; 8/day |
| `double_cullet` | rewarded | Results card, "DOUBLE THE CULLET" | ≥1 finished run; cooldown 30 s; 4/session; 12/day |
| `between_runs` | interstitial | Dismissing the results card | ≥3 finished runs; every 3rd finished run; never in the player's first session; never in the first 20 s of a session; cooldown 90 s; 2/session; 5/day; skipped entirely if `ad_free` is owned |

**Second Firing** clears the three rows with the most filled cells (ties resolve
topmost first), draws a fresh tray, and resets the combo to 0. It awards **no
score** — it buys room, not points — so it cannot be farmed. Available once per
run, and only when the SDK confirms the video completed.

**Double the Cullet** doubles the shards from the finished run, once, and only
on a confirmed completion. Cancelled, unavailable, and errored ads grant
nothing and say so.

### 6.3 Kill switches

`rundot/liveops.config.json` ships the enable flags. Every monetization control
fails closed: with no reachable LiveOps config, `enabled` is false and every
offer and placement hides itself.

### 6.4 Measurement

Funnel per surface: `offer_viewed` → `purchase_tapped` → `checkout_started` →
`checkout_result` → `entitlement_synced`; and `ad_offer_viewed` →
`ad_requested` → `ad_result` → `reward_granted`.

- Primary: payer conversion, rewarded completion rate.
- Guardrails: D1/D7 retention split by first-interstitial cohort; runs per
  session before and after the first interstitial; share of shards earned from
  rewarded video versus play; purchase/ad error rate excluding cancellation.

---

## 7. Retention

- **Daily rewards** — a 7-day shard ladder (20/25/30/40/50/60/120), claimed
  once per trusted-time day, streak resets after a missed day.
- **Daily quests** — three per day, each paying shards:
  `runs` finish 3 runs (30), `lines` fire 20 lines (35), `combos` reach a ×2
  combo 3 times (40).
- **Return notification** — opt-in, 24 h after the last session, re-armed on
  resume, never scheduled from `onSleep`/`onQuit`.

---

## 8. Art direction — "Stained Glass Atelier"

The whole screen is a workbench seen from above in late-afternoon light.

- **Value structure, before anything else.** The scene is built as near-black
  panel < very dark bench < mid-tone oak frame << bright saturated glass, so the
  glass is the only genuinely light thing on screen and the eye goes straight to
  the board. An earlier version had a mid-brown bench behind mid-brightness
  glass: everything sat at one value, nothing popped, and no amount of lighting,
  particles, or effect work fixed it. If a change makes the environment brighter
  or the glass duller, it is wrong.
- **Bench.** Dark oiled walnut with visible grain, lit by one warm pool over the
  panel and falling to near-black at the edges. That lighting is a generated
  texture, not a shape fill — an ellipse fill has a hard edge, and on a dark
  bench the edge reads as a bright band smeared across the screen.
- **Type.** A clean geometric sans for all UI and readouts; the serif display
  face is reserved for the wordmark, the screen titles, and the run's final
  score. Serif everywhere read as a museum placard, and at small sizes with wide
  tracking it was genuinely hard to scan. The wordmark itself is poured gold —
  a near-white-to-amber gradient fill with a hard contact shadow and a warm
  halo — never flat paint.
- **Panel.** A leaded frame over a hammered pewter grid. The grid is one
  continuous lattice and it is drawn **under** the glass, not over it: placed
  cells are full-bleed and butt directly against their neighbours, so a placed
  cut reads as one solid mass and the grid shows only through the cells that are
  still empty. This is load-bearing for feel, not just for looks — any gutter
  between placed cells slices a four-cell bar into four tiles and the board
  stops reading as filled. Separation between adjacent cells comes from a bevel
  *inside* each cell (lit top-left, shaded bottom-right), which is what lets a
  player still count the cells in a run. Cuts in the tray follow the same rule:
  full-bleed cells with came around the **silhouette only**, never on the seams
  between a cut's own cells, so a piece does not change weight when it is picked
  up and lands. Empty cells are smoky, slightly translucent grey-green with a
  faint inner shadow — clearly *absent glass*, not a hole.
- **Glass cells.** Each cell is built in passes: a radial transmission
  hot-spot in the palette colour falling to a deep edge shade, streaky
  cathedral-glass seeding with a few seed bubbles, a darker bevel along the
  bottom-right ending in a hairline seam, a bright specular streak with a
  pinpoint glint, and — only for free-standing cuts — a dark lead came
  outline. The seeding phase and the specular placement are keyed to the
  cell's jitter variant, so a row of cells catches the light four different
  ways instead of wearing one stamp. Per-cell hue and lightness jitter
  (deterministic, seeded by cell index) does the rest.
- **Tray.** The three cuts rest on a low oiled sill with a recessed pocket
  per slot, generated as one texture from the live layout; each resting cut
  casts a soft shadow in its pocket and trades it for a sharper carry shadow
  the moment it is picked up. Without the sill the cuts floated in empty air
  and the bottom third of the bench read as unfinished. In **landscape** the
  tray becomes a column beside the panel instead of a row beneath it: the
  portrait stack spends a third of the short edge on the tray and shrinks the
  panel to its floor, which is no composition at all. A cut in the tray or
  in the hand is drawn **seamless** — no bevel, no lip, a softened edge
  falloff — so it reads as one pour of glass with came around the silhouette
  only; the bevel seams appear when the cut lands, which reads as the piece
  seating into the lattice.
- **Firing.** The line whitens from the placement outward, holds for one frame
  of bloom, then breaks into shards that fall, tumble, and fade. Reduced motion
  replaces the shard rain with a single 140 ms fade and keeps the whiten.
- **Type.** All in-canvas type is sized in design units. `DESIGN_SHORT_EDGE` is
  720 across a ~393 px phone, so one design unit ≈ 0.55 CSS px — every intended
  CSS size is multiplied by **1.83** before it becomes a `fontSize`.
- **Single generator.** Every piece of glass art is a Canvas2D drawing function
  in `src/game/art/`. The Pixi textures, the palette swatches in the Atelier
  screen, and the 512×512 store tile all call the same functions, so they
  cannot drift apart.

- **Light is the point.** Three layers, none interactive: a warm shaft crossing
  the bench with dust turning slowly in it, and — the signature — the **coloured
  light the panel throws onto the wood**. That stain is derived from the live
  board, so the bench visibly warms as the player fills the panel and goes dark
  the instant a firing clears it. The menu backdrop plays the same trick: the
  rose window throws its own stain onto the bench beneath it, and the store
  tile's hero panel does too. Leaded glass is recognisable less by the glass
  than by what it does to everything behind it.

**Motion.** Picking up a piece lifts it from its tray size to **exact board
size and no further** — the carried glass always matches the cells it will land
on, so aim is never guesswork — casts a shadow on the bench below, and leans
into horizontal motion. The carried cut floats so its **bottom edge** always
clears the finger (about 0.9 board cells of clearance) — anchoring by the
centre let tall cuts hang back down under the thumb. The ghost
preview snaps cell-to-cell and pre-lights any line the drop would complete; an
illegal drop springs the piece back to its slot. The came around a cut's
silhouette is mitred at the corners: horizontal bars run long, verticals butt
into them, so neither convex nor concave joints double the paint. A firing
choreographs whiten → a light sweep running the length of each fired line →
shard rain → a bloom under the placement → a score popup, with a screen shake
that scales with the lines cleared and the combo. The score rolls rather than
snapping.

**Reduced motion** keeps every state change and every light layer, and drops
only movement: no dust, no shake, no shard rain, no roll, and collapsed
durations. The light is composition, not decoration — removing it would leave a
flat brown rectangle, which is not an accessible version of this game, just a
worse one.

**Audio.** Procedural, no files. Glass-flavoured: a soft *tink* on pick-up, a
seated *chock* on placement, a rising chime stack on firing that transposes up
with the combo, a low *thud* on an illegal drop, and a slow bowed-glass drone
for the bench ambience.

---

## 9. Persistence

Save schema `leadlight:save`, version **1**. Sections: `settings`, `progress`
(`bestScore`, `shards`, `runsPlayed`, `linesFired`, `cleanPanes`, `bestCombo`,
`ownedPalettes`, `selectedPalette`), `retention` (daily rewards + quests), and
`commerce` (`pendingPurchaseIntent`). A run in progress is **not** saved: runs
are short and a half-restored board is worse than a clean start.

Unknown or malformed fields are dropped by the migrator rather than trusted.
Ownership is never read from the save — it is read from Entitlements. The save
only remembers which palette was *selected*, and a selection the player no
longer owns silently reverts to Atelier.

---

## 10. Analytics

`run_started` (seed, palette) · `run_ended` (score, lines, best combo, clean
panes, duration, ended_by) · `helper_used` (kind, shards after) · `palette_
selected` · `palette_unlocked` (source) · plus the monetization events in §6.4.

Analytics never changes player state and is never an ownership ledger.
