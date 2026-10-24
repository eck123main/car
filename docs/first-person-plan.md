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
- Game screen: test buttons bottom right ("Test 3D view", "Camera" with a list of all cameras);
  keys **V** (view), **C** (camera), **M** (mirror); the 2D HUD stays on top; mouse steering works
  from screen position. View and camera remembered (`f1td.view`, `f1td.cam3d`).
- 8 cameras: cockpit, cockpit without the halo (the centre bar blocked the view), T-cam, nose,
  front wing, rear wing, chase, far chase.
- Rear-view mirror: one 512x128 render of what's behind every other frame, on the car's wing
  mirrors (cockpit) or at the top of the screen (other cameras). It costs a second (small) pass.
- **In races** (practice, bots, online, party mode): other cars, ghosts in qualifying, the
  safety car, name tags. Each player picks their own view; the network code didn't change.
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

### Phase 2: the rest of the game
- Done: practice, bots and online races in 3D, safety car, mirrors, name tags, hold Q to look
  behind.
- Done: **circuit identity** (the `scenery` block in track files, see CLAUDE.md): night races,
  desert, Alps, Fuji, seas, city skylines and landmarks on 22 circuits (Monaco tunnel and
  harbour, Suzuka bridge and wheel, Baku walls and Flame Towers, Singapore Flyer and Marina Bay
  Sands, Yas hotel, Las Vegas Strip and Sphere, Montreal basin and Wall of Champions, Mexico
  stadium, Albert Park lake). Placed from maps of each circuit with lap-share marks (north up).
  Next candidates: COTA tower, Monza's old banking, Spa's Eau Rouge (needs real elevation),
  Interlagos, Miami's stadium, Zandvoort's banked corners.
- Start lights on the gantry (the HUD shows them now), pit boxes and pit crew blocks.
- Weather: rain drops / spray / darker sky (cheap), wet track tint.
- Done: party mode items in 3D (`items3d.ts`: boxes, rockets, drops, every item's effect).
- Suzuka: lift the bridge stretch so the two roads cross at different heights.

- Done: **real elevation** (see CLAUDE.md, Driving & physics): hills in the physics for both
  views, terrain in 3D, cars and cameras pitch with the slope, top-down shading. Spa's Eau
  Rouge/Raidillon, Red Bull Ring, COTA's turn 1 and Suzuka's bridge are all in.
  Next: the four OpenStreetMap circuits (Fuji especially), banking (Zandvoort, Indianapolis).

### Phase 3: online
- Done: online races draw in 3D with no network changes; each player picks their own view.
- Test with real friends over the internet: other cars are drawn 100 ms behind (interpolation),
  which may look different up close in first person than top-down.
- **[OPEN]** Should the host be able to force one view for everyone (fairness: the mirror and
  map show different things)?

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
