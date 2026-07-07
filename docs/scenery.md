# Scenery & art direction

The look is a **clean, abstract side-scroller**: simple geometric shapes — solid rectangles (blocks,
bands) with round shapes to come — arranged as depth layers behind a player that moves through them.
Not representational (no literal hills/bushes/sky); the world reads as **composed shapes**, not scenery.

## Palette

Everything is **solid colors** drawn from **one clean, well-defined palette**. No gradients, no
textures — flat fills only, so the whole scene reads as a single deliberate color system.

The look is a **cool value-ramp for depth plus one warm accent for the subject**: the background layers
step from dark (far) to light (near) in a single cool hue, and the player is the lone warm colour so it
reads as the subject. The palette lives in **one place in code** as named constants (0xRRGGBB), so the
whole look re-themes by editing that block alone — nothing else hard-codes a colour. Names are **abstract
depth roles**, not objects: `CANVAS` (background), `BASE` (ground band), `FAR`/`MID`/`NEAR` (background
layers), `PLAYER` (the accent).

## Scenery elements

- **Blocks** — solid rectangles at world positions, coloured by depth (`FAR`/`MID`/`NEAR`) so nearer
  shapes are lighter; the eventual round shapes (`gfx.circle`) join the same depth ramp.
- **Ground** — a solid `BASE` band the player walks along.
- **Slopes** — angled transitions (needs triangle rasterization; see roadmap).

## First pass (shipped): a follow-cam over abstract scenery

`src/scene.arche` — a controllable player with a deadzone follow-camera over solid-colour blocks:

- One long flat **floor** rectangle plus background **buildings** of various sizes at fixed **world**
  positions in one `Prop` pool, each drawn through `camera.to_screen` → rounded to pixels → `gfx.rect`.
  Buildings are bottom-aligned to the floor line (world y = 300 − rh/2) and coloured from a cool indigo
  shade ramp (`S1` dark … `S6` light) for depth/variety.
- A **player** (the `PLAYER` accent) that shares **nothing** with the scenery: its own world-x `ppx`,
  its own screen `prx`/`pry`, and its own `draw_player` pass (see the gotcha below).
- Press **←/→ to move the player**. The camera holds still while the player roams a central **deadzone**
  (`±DEADZONE` world units of the eye), then scrolls to trail the player at the deadzone edge — so the
  world scrolls under a player that stays on screen. That "player pins, world scrolls" is the follow-cam
  signal (the camera's cross-pool read of the player: `follow` reads `ppx`, writes `eye`).
- All colours come from the palette block at the top of the file.

Rects only for now (round shapes as `gfx.circle`, slopes, and parallax come later).

**arche gotcha found here:** writing a component **shared across two archetypes** inside an effectful
`map … eff` fan misbehaves — the write is either **dropped** (the player's shared `pos.x` never updated) or
**broadcast across pools** (a system writing the shared `rx,ry` for just the player wrote it to every
scenery prop too, collapsing the world to one point). Single-archetype writes are fine (the camera's
`eye.x`). Fix: give the player **entirely its own components** (`ppx`,`prx`,`pry`) and its own draw pass —
share nothing written per-frame with `Prop`.

## Eventual plan (work toward, incrementally)

1. **Static scene + follow camera** *(first pass)* — shapes at world coords, camera follows player,
   background scrolls. Palette block established.
2. **Parallax layers** — background/mid/near layers scroll at fractions of the camera offset (far
   hills drift slower than near bushes) for depth. A per-layer scale on the camera transform.
3. **Slopes & triangles** — add a triangle rasterizer to `gfx` (device work), then slope tiles and
   angled hills.
4. **Palette theming** — promote the palette to a swappable set (day/dusk/night variants) selected
   in one place; possibly a small `palette` construct so themes are data, not edits.
5. **Chunked/streamed scenery** — scenery defined as world-space chunks, only those near the camera
   are drawn, so levels can be long without drawing everything every frame.

Physics (the `physics` device) and the camera (`camera` device) are the substrate: scenery is
world-space shapes, the camera maps them to screen, and solid bodies (ground, obstacles) come from
the same AABB world the player lives in.
