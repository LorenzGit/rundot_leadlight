# Verification workflow

Use the smallest check that can reliably detect the failure a change could
introduce, then retain the broader release gates. Report what changed, what was
run, which viewports or host conditions were exercised, and what remains
unverified.

| Change | Minimum reliable check |
| --- | --- |
| Copy, spacing, colour, or one-screen layout | `npm run visual-qa` and read the PNGs |
| Rules, scoring, the cut set, or the bag | `npm run simulate` |
| Draw weights, the crowding bias, or the combo curve | `npm run balance` — and re-read DESIGN.md §5.1 |
| Glass, bench, or backdrop art | `npm run thumbnail` plus `npm run visual-qa` |
| Persistence, lifecycle, or settings | `npm run visual-qa` (its behaviour gates cover reload, mute, and page-hide) |
| Shop, entitlements, ads, storage, or notifications | `npm run dev:playground` against a real host — the local build cannot prove these |
| Renderer, build, or dependency change | `npm run check` (both production builds) |
| Release preparation | `npm run check`, the readiness audit, and fresh visual evidence |

## What each command actually proves

- **`npm run simulate`** — the rules and the arithmetic, headless. The only
  thing that can catch a scoring or draw bug, because a wrong score still looks
  like a plausible score on screen. Also proves the bag never deals a dead tray
  onto a panel that still has room, and that a seed replays exactly.
- **`npm run balance`** — the score distribution over 400 seeded runs, plus the
  economy guardrail: a Recut must return fewer shards than it costs.
- **`npm run visual-qa`** — four viewports, real pointer drags driven from the
  scene's own geometry, and the gates a screenshot cannot cover: audio starts
  and stops, hiding the page suspends it, settings and progress survive a
  reload, and the bench is still playable with reduced motion on. It fails on
  any page or console error, and it fails if the drags did not actually place
  anything.
- **`npm run check`** — format, lint, the tests above, the public-repository
  audit, and both production builds with their chunk budgets.

## Local visual review

Development-only screen deep links avoid repetitive navigation:

```text
?screen=main
?screen=atelier
?screen=daily-rewards
?screen=daily-quests
?screen=stats
?screen=settings
?screen=game
```

Add `?debug=1` for the diagnostics panel, `?qa=1` for the `__gameQa` contract,
and `?renderer=webgpu` or `?renderer=webgl` to force a backend strictly — in
forced mode an unexpected renderer error is a failure rather than a fallback.

## What local verification cannot prove

Headless Chromium reports the WebGL backend on this machine, so real WebGPU
behaviour needs a device. Ads, purchases, entitlements, RUN storage, trusted
time, and notifications all fail closed without a host: locally they are
correctly invisible or clearly marked PREVIEW, which is the honest state, not
evidence that they work. Those belong to a RUN Playground or production-host
pass.
