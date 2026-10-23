# First-person F1 — plan and context

Read this before working on the 3D / first-person side of the game. `CLAUDE.md` describes the
whole game; this file is the plan for turning it into a first-person F1 driving game.
Things marked **[OPEN]** are not decided yet: raise them with the user, don't pick quietly.

## The goal

A **first-person F1 game in the browser**, in the spirit of slowroads.io: you sit in an F1 car
and drive **real F1 circuits**, with the **same physics and rules as the top-down game**. Start
with time trial, then bring it online (multiplayer races with friends), and in the long run make it
the main way to play (**[OPEN]** whether top-down stays as a mode or a map view, or goes).

## Rules that must hold

1. **One simulation, two views.** The 3D view is only a renderer over the same `RaceWorld`. Never
   fork the physics for 3D. Speed, braking distance, time down a straight, grip, DRS, ERS,
   slipstream, tyre wear and wall hits must be identical in both views; a lap time set in 3D
   counts the same as one set top-down.
2. **Light on the browser.** It must never make the browser struggle. Budget (keep to it, measure
   when adding things):
   - about **50 draw calls** a frame or fewer (now ~25); instance or merge anything repeated;
   - no real-time shadows, no post-processing, no reflections or render-to-texture mirrors;
   - flat-shaded low-poly; small canvas textures only (noise, boards, wheel display);
   - fog limits the draw distance; pixel ratio capped at 1.25;
   - three.js loads only when the 3D view is first opened (top-down players never download it).
   - **[OPEN]** a "graphics: low / high" setting if some machines struggle.
3. **The car looks like an F1 car from the driver's seat**: halo, nose, front tyres, steering
   wheel with a display, mirrors. Plus other cameras (T-cam, nose / front-wing cam, chase).
4. **The track is detailed** (kerbs, lines, barriers, run-off, grandstands, trees, boards), but
   only with cheap geometry. Visuals never move a wall: everything is built from the physics'
   own track samples.
5. **Test it as a test view first.** For now it is only a test button in the game (bottom right,
   time trial only), **not a game mode** and not in any menu. Promote it when the user says so.

## Done (October 2026)

- `src/render3d/`: `view3d.ts` (renderer, cameras, two-pass render), `trackMesh.ts` (road,
  edge lines, kerbs, gravel / grass / run-off, walls at the exact collision offsets, pit lane and
  pit wall, start line, DRS and pit lines), `scenery3d.ts` (instanced trees, grandstands with a
  crowd, pit garages, brake boards, start gantry, hills), `carModel.ts` (car, halo, steering wheel
  with live speed / DRS / ERS display, DRS flap that opens and turns green, steered front wheels,
  compound-coloured tyre rings, see-through ghost cars).
- Game screen: test buttons bottom right in time trial ("Test 3D view", "Camera"); keys **V**
  (view) and **C** (camera); the 2D HUD stays on top; mouse steering works from screen position.
  View and camera remembered (`f1td.view`, `f1td.cam3d`).
- Checked in headless Chrome on Silverstone (all four cameras). Not yet measured on a real GPU.

## Roadmap

### Phase 1: make time trial in 3D feel right (next)
- Get the user's feedback on driving it: camera height, field of view, how much of the
  screen the car and wheel cover, sense of speed.
- A 3D-friendly HUD: smaller and lower, less covering the road (the top-down HUD is reused now).
- Racing-line cues for first person: more brake boards (150 / 100 / 50), corner numbers,
  apex markers on kerbs. Braking points are much harder to judge in first person than top-down.
- Ghost car in 3D: check it looks right and isn't distracting in the cockpit.
- Frame-rate check on a normal laptop and a phone; an FPS readout in dev builds.
- Mirrors that show something (cheap: cars behind drawn as markers, not a second render).
- Run all 44 circuits through a quick check (screenshot each) for scenery or wall glitches.

### Phase 2: the rest of single player
- Practice and races against bots in 3D: other cars, the safety car, start lights on the gantry
  (they already exist in the sim; only drawing is missing), pit boxes and pit crew blocks.
- Weather: rain drops / spray / darker sky (cheap), wet track tint.
- Party mode items in 3D (rockets, boxes, drops).
- Suzuka: lift the bridge stretch so the two roads cross at different heights.

### Phase 3: online
- Multiplayer races in 3D: nothing changes in the network code (it sends the same world state);
  the client just draws it in 3D. Interpolated other cars already exist.
- Lobby setting or per-player choice of view (**[OPEN]**: per player, so friends can mix views?).

### Phase 4: maybe later
- **[OPEN]** Elevation (real hills such as Spa's Eau Rouge). The physics is 2D, so this would be
  visual only at first, or need physics changes (slopes affecting speed): ask first.
- **[OPEN]** Steering-wheel / gamepad support (analogue steering suits first person far better
  than on/off keys).
- Car liveries and skins from the Garage on the 3D model (the livery colours are already used).
- Cockpit camera options: field of view slider, seat height, head movement under braking.

## How it works (short)

- Simulation (x, y) is three.js (x, z) with y up; heading h faces (cos h, 0, sin h). A car model is
  built facing +x and turned by `rotation.y = -heading`.
- Pass 1 draws the world (near plane 0.5 m, so distant ground doesn't flicker); pass 2 clears depth
  and draws only your own car (near plane 2 cm), so the cockpit never clips.
- Ground layers are side-by-side bands, never stacked; ground quads are wound to face up.
- The 2D canvas sits over the WebGL canvas and keeps the HUD; in 3D it is cleared, not filled.

## Testing

- `npm test` covers the physics; the 3D view adds no rules, so it shares those tests.
- Visual check: run `npm run dev`, then Time trial → Drive → "Test 3D view". A headless Chrome
  script (puppeteer-core with the local Chrome, `--use-angle=swiftshader`) can screenshot every
  camera when no browser extension is available. Its frame rate is software rendering and means
  nothing; check draw calls instead (`f1game.view3d.renderer.info`, dev builds).
