# Scenery & art direction

The look is a **Super Mario World–esque side-scroller**: simple geometric shapes in the
background — round hills, bushes, slopes — behind a foreground the player moves through.

## Palette

Everything is **solid colors** drawn from **one clean, well-defined palette**. No gradients, no
textures — flat fills only, so the whole game reads as a single deliberate color system.

The palette lives in **one place in code** as named color constants (0xRRGGBB), so the entire
look can be re-themed by editing that block alone. Nothing else hard-codes a color; scenery and
entities reference palette names (`SKY`, `HILL`, `HILL_SHADE`, `BUSH`, `GROUND`, `PLAYER`, …).

Shades of a base hue are part of the palette (e.g. `HILL` and a darker `HILL_SHADE`) so shapes can
have a little depth while staying flat-colored.

## Scenery elements

- **Round hills** — large low circles/half-discs on the horizon, in `HILL` with a `HILL_SHADE` band.
- **Bushes** — small clusters of overlapping circles, `BUSH`.
- **Slopes** — angled ground transitions (needs triangle rasterization; see roadmap).
- **Ground** — solid rectangle band(s) the player stands on, `GROUND`.

## First pass (shipped): prove the camera

`src/scene.arche` — the minimum that makes it **obvious the camera works**:

- A handful of solid-colour props (a ground band, blocky hills, bushes, and a red landmark) at fixed
  **world** positions, all in one `Prop` pool.
- Each prop is drawn through `camera.to_screen` → rounded to pixels → `gfx.rect`.
- Press **←/→ to pan the camera**: the whole world scrolls past, which is the camera-works signal
  (verified: the landmark slides off-centre and back as you pan).
- All colours come from the palette block at the top of the file.

Rects only for now (round hills, bushes as `gfx.circle`, and slopes come later). And this pass **pans the
camera directly** rather than driving a player the camera follows — a follow-cam is the very next step
(it needs a cross-pool "camera reads the player's position" pattern; panning the camera in its own fan was
the clean first proof).

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
