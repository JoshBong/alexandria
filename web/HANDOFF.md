# Alexandria Shell — Design Handoff

Status as of 2026-06-30. Read this before touching the god sprites or the scene.

## Where this ended
**The god art is solved, and the activation scene is built.** The breakthrough that
ended the failed code-authoring loop: instead of redrawing animal heads by eye, Josh's
approved reference ("TERMINAL GODS", `~/.claude/image-cache/.../6.png` — and the full
plaza scene #7) was **pixel-extracted**. The 5 sprites are faithful copies, not hand-redraws.

## Locked decisions (don't relitigate)
- **Surface:** local web GUI (HTML5 Canvas). Full-replacement shell. (Tauri later.)
- **Art:** retro pixel art, RotMG-inspired (hard 1px outline, vivid flats). EXTRACTED from
  the reference, not authored blind. The extraction loses thin features (e.g. Anubis's ears
  vanished at the 16px downsample) — those few spots were hand-traced from a zoomed crop.
- **Scene:** Pharos lighthouse back-center + beam, perspective stone plaza, 5 Keeper-gods
  standing on platforms. **Activation mechanic (Josh's spec, 2026-06-30):** the active god(s)
  **hover** above their platform, brighten, and cast a **golden aura + expanding floor ripple**;
  the rest **dim back** so the active one reads "over the others."
- **Five gods + robe hexes:** Ptah `#3cae82` (green, blue headband, human) · Ra `#e6a431`
  (falcon + orange sun disk) · Thoth `#528dce` (blue ibis, curved beak) · Horus `#cfd0cb`
  (white + red/white crown) · Anubis `#9d64d6` (purple jackal, two ears, two gold eyes).

## How the sprites were made (reproduce/extend)
`web/extract pipeline` (scratch scripts in the session scratchpad, not committed):
decode reference PNG → detect native grid (16px → 64²) → mode-vote per block (crisp flats) →
strip bg/stars/text → quantize to 21-color PAL → separate touching figures by min-cost
vertical seams along the dark outline crease. Output is the base36 char-grids now living in
`web/spritegen.cjs`. **Anubis's head was hand-traced** from a zoomed crop (thin ears didn't
survive downsampling) and stacked on its extracted body.

## File inventory (`web/`)
- `spritegen.cjs` — **source of truth.** `PAL` (21 hex) + `GODS` (5 base36 char-grids).
  Edit a cell + `node web/spritegen.cjs` → regenerates `gods.png` + `god-<name>-1x.png`.
- `gods.png` — preview sheet (the approved lineup, bigger).
- `god-<name>-1x.png` — native transparent per-god sprites.
- `prototype.html` — **the live scene.** Embeds PAL+GODS (mirror of spritegen), renders the
  plaza + lighthouse + the activation mechanic. Click a god (or the top bar) to toggle active.
- `PALETTE.md`, `palette.png` — older color scheme notes (pre-extraction; reference only).
- `kitty-draft.cjs` — stale terminal Kitty-graphics counterpart (reference only).

## Open threads
- **Verify live in a browser:** the Chrome extension was offline this session, so the scene
  was confirmed via a static Node render (matches). Open `prototype.html` and sanity-check
  animation/ripple timing on real hardware.
- **Wire to backend state:** activation is manual (click) right now. Next: a socket so
  active-god tracks real Keeper status (routing → glow).
- Polish passes if wanted: Ra/Horus face detail, ripple tuning, per-god aura hue option.
- Nothing here is committed to git yet.

## Hard-won process notes
- **Extraction beats blind authoring** at this scale. When there's a good reference, decode +
  downsample + quantize it; only hand-trace the sub-grid-size details that downsampling drops.
- **Render to PNG and LOOK before showing Josh.** Held throughout.
