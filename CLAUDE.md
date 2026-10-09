# F1 Top-Down Multiplayer Racer — Project Context

This file describes what we're building. Read it before any work on this project.
Things marked **[OPEN]** haven't been decided yet. Don't pick one quietly; raise it with the user.

## The idea in one paragraph

A **bird's-eye-view (top-down) multiplayer racing game** with **simple visuals** but
**F1 physics and F1 rules**. Each player drives a small car around a real-world F1
circuit. A race weekend runs as a **qualifying session**, then a **starting grid** set by
qualifying times, then a **race** with a proper start procedure, pit stops, tyre choices,
DRS, collisions and maybe weather. The fun comes from racing well: taking the right line,
braking late, defending the inside, timing overtakes. Races are short, "mini races".

## Design pillars

1. **Simple look, deep driving.** Flat 2D shapes. No fancy animation, sprites, particles
   or 3D. A car is a small coloured shape. A track is a plain strip with kerbs and
   run-off. The depth is in the handling and the rules.
2. **Racecraft matters.** Racing lines, braking points, inside/outside lines, slipstream
   and DRS should all make a real difference. A player who drives a better line should
   be faster.
3. **F1-style, not a full simulation.** Use real F1 ideas (grip, tyre wear, downforce,
   DRS, pit stops) but keep them readable and fun. Choose game feel over strict realism
   when the two conflict.
4. **Easy to pick up.** Handling leans arcade: forgiving grip, traction help, a car that
   would rather understeer than spin. Overdriving still costs time and can end in the
   wall, but driving normally shouldn't be a fight. Off-track surfaces are drivable,
   just slow.
5. **Short sessions.** Short qualifying, short races (a few laps), quick to jump into
   with friends.
6. **Data-driven content.** Tracks (and ideally teams/cars) load from data files, so you
   can add real F1 circuits without changing code.

## Race weekend flow

1. **Welcome → lobby**: opening an invite link shows a welcome screen; the player enters a
   name, gets a colour assigned automatically and joins the lobby. The lobby owner (host)
   picks track, laps, weather, qualifying on/off + release gap, mandatory stop, then starts.
2. **Qualifying**: each player gets **one timed flying lap**. Fastest time takes pole.
   - All players are on track together but **ghosted (no car-to-car collisions)**.
   - Players are released **one at a time, 10–15 s apart** (configurable). Each player
     gets their own countdown before release (player 1 goes, player 2 goes 10 s later,
     etc.) so nobody gets in anyone's way or gets a tow.
   - Each player's run is: **out-lap** (untimed, a practice lap to learn the track and
     build speed) then **one timed flying lap** that starts when they cross the line.
3. **Starting grid**: cars line up in qualifying order, in the F1 staggered 2-wide grid.
4. **Race start**: F1 start procedure. Lights come on one by one (5 red lights), then go
   out after a random delay, and the race starts. Players can rev on the grid. A
   **jump start** (moving before lights out) should be detected and penalised.
5. **Race**: N laps. Pit stops, tyre strategy, DRS, collisions, possible weather.
6. **Results**: finishing order, gaps, fastest lap, penalties. The host can **Play again**
   (same lobby and settings, straight into a new weekend) or go back to the lobby.

## Driving & physics

Top-down 2D car physics that feels like an F1 car:

- **Throttle / brake / steering**, with acceleration that drops off at higher speed and
  strong braking.
- **Grip model**: grip comes from weight + downforce and is shared between braking/
  accelerating and cornering. Steering sets a turn rate, capped by the tightest turn the
  tyres can hold at the current speed. Too fast for a corner = the car runs wide (onto
  grass/gravel, maybe into the wall); it does **not** spin. This was chosen after a
  slip-angle tyre model proved too hard to control on a keyboard.
- **Racing line matters**: corner speed depends on the radius actually driven, so the classic
  wide-in, apex, wide-out line is faster than the middle of the road, and hugging the
  inside is slowest (tested in `src/sim/ai/lines.test.ts`). The bots' line minimises
  curvature (4th-order smoothing), not length.
- **Downforce**: more grip at high speed and less in slow corners, so fast corners and
  hairpins feel different.
- **Slipstream**: following closely behind another car on a straight lowers drag.
- **DRS**: in marked DRS zones, a player within ~1 second of the car ahead (at the
  detection point) can open DRS for a top-speed boost. DRS closes on braking. Disabled
  on lap 1 and in the wet (real rules).
- **Surfaces**: track (full grip), kerbs (slightly less), grass/gravel/dirt (drivable
  but slower with less grip; you can always drive back onto the track), walls/barriers
  (collision).
- **Track width**: 19 m (wider than real F1 tracks, ~12-15 m): at half scale with keyboard
  steering, narrower tracks made track limits too easy to hit.
- **Track scale**: keep tracks compact. Laps should be roughly 30–60 s, so real circuits
  are scaled down rather than built at full size.
- **Camera**: follows the car and zooms out a little with speed. **Default: fixed north-up
  map.** Press **C** for the optional rotating view (the map turns so you always drive up),
  remembered between games. The rotating view must stay opt-in: a turning map is
  disorienting for some players and can cause motion sickness.
- **Tyres**: **Soft / Medium / Hard / Intermediate / Wet** (`src/sim/tyres.ts`). Life in
  laps (S 4, M 7, H 11, I 8, W 10, scaled to track length). Grip drops slowly with wear,
  then sharply past 75% (the cliff). Rain tyres wear double on a dry track.
- **Brake boards** (100 / 50 m) are drawn before slow corners that follow a fast stretch.
- **[OPEN]** Fuel load / car getting lighter over the race? (Probably skip at first.)
- **ERS boost** button with a battery meter (see Controls).

## Controls

About 7 race keys, like the handful of buttons an F1 driver really uses on the wheel.
No handbrake: F1 cars don't have one, and drifting comes from overdriving the grip.

| Action | Key | Notes |
|---|---|---|
| Throttle / brake / steer | **W A S D** and **arrow keys** (both work) | Keyboard is on/off, so throttle and steering ramp smoothly in code |
| DRS | **Space** | Only works in a DRS zone when within 1 s at detection; closes on braking |
| ERS boost | **Shift** (hold) | Extra power from a battery meter that drains while used and recharges under braking |
| Pit limiter | **P** | Must be on in the pit lane, otherwise a speeding penalty |
| Tyre choice | **1-5** (Soft / Medium / Hard / Inter / Wet) | Next tyres for the pit stop; on the grid it picks starting tyres |
| Camera view | **C** | Fixed map (default) or rotating (you always drive up) |
| Reset to track | **R** | 5 s wait, no penalty. Qualifying: back to pit exit |
| Menu | **Esc** | No real pause online; just opens the menu |

The timing tower is always shown (no Tab needed).

- Keys should be **rebindable** later.
- Note: the 2026 F1 rules replaced DRS with active aero plus a manual-override boost. We
  keep **DRS + ERS** because it's well known and fun in a top-down game.

## Rules to enforce

- **Start**: 4 s on the grid (held still), then 5 red lights 1 s apart, then lights out
  after 0.5-2.5 s. Moving forwards more than 1 m before lights out = **+5 s jump start**.
  No reversing on the grid.
- **Track limits**: off track = all four wheels beyond the track edge. Kerbs count as
  track (friendlier than the strict F1 white-line rule, which flagged nearly every corner). Each
  excursion is a warning and deletes the current lap time. Wheels may go 1 m past the edge
  before it counts. In races, only **every 20th** warning costs **+5 s**. Grass/gravel also slow the car hard, so
  cutting never pays.
- **Timing**: three equal sectors; a lap only counts if the car passes every sector line
  in order (no faking laps by reversing). Uses simulation time, not wall-clock time.
- Pit lane speed limit.
- DRS rules (as above).
- **Mandatory pit stop**: every car must pit at least once and use at least two
  different dry compounds (as in real F1 dry races). A car that doesn't gets **+30 s**
  at the finish. Only in dry races, and only when the host enables it.
- **Finish**: when the leader completes the laps, everyone else finishes on their next
  line crossing (or 60 s later). Results order = race time + penalties.
- **Collision penalties, fairly assigned.** Only the driver **at fault** gets penalised,
  never the victim. The game decides fault with simple checks:
  - Who hit whom: the car whose front hits the other car's rear or side is the likely
    culprit.
  - Closing speed: the faster car running into a slower car ahead is at fault.
  - Position before contact: the car that was clearly ahead/alongside and holding its
    line counts as the victim.
  - Divebombs: a car that brakes far too late and slides into someone gets penalised.
  - Unclear or racing incidents (both partly at fault, light contact) get **no
    penalty**. When unsure, don't penalise.
  - Penalties are time penalties (e.g. +5 s / +10 s) shown to everyone with a short
    reason.
  - **Implemented** in `src/sim/collisions.ts` (`judge`): wrong-way driver is at fault;
    nose into gearbox = car behind; nose into side while closing >2 m/s faster = the
    hitter; everything else (side-by-side, nose-to-nose) = racing incident. Only hits
    over 8 m/s (~29 km/h closing) are judged. A driver's first minor at-fault hit is a
    **warning**; after that +5 s. Hits over 14 m/s or that wreck the victim: +10 s at once.
    A pair is judged at most once every 3 s.
- **[LATER]** Safety car (and maybe VSC) after big incidents.
- **[OPEN]** Blue flags?

## Collisions

- Cars collide with each other (oriented-box SAT + impulses with spin) and with walls.
  Car-to-car hits count 60% as hard as wall hits for damage. Off in qualifying (ghosts).
- **Carrying too much speed into a corner should end badly**: the car runs wide,
  off the track onto grass/gravel (which slows it hard and has little grip), and can
  end up in the wall.
- **Per-part damage** (`CarParts` in `src/physics/car.ts`), where the hit lands decides
  the part: **front wing** (understeer: up to -40% turning grip), **rear wing** (-45%
  downforce, -12% power), **left/right side** (more drag, -15% grip, and the car pulls
  towards the damaged side). Overall damage = the worst part. Shown as a green/yellow/red
  car diagram under the minimap. Visual damage on the car itself may come later.
- Below the crash threshold, a damaged car **always stays drivable enough to reach the
  pits**. Normal damage has a cap and never stops the car. Repairs happen at a pit stop
  (and add time to the stop).
- **Big crashes wreck the car** (above a set impact speed). Then **R** (for every player,
  online too): in a race, back on track where you crashed, repaired; in qualifying,
  back to the pit exit (a timed lap in progress is lost). Always a **5 s wait** as a ghost,
  never a penalty (practice too). Bots reset
  themselves 2 s after wrecking. Leaving the race counts as DNF.

## Pit stops

- The pit lane runs alongside the **start/finish straight** (and gentle bends either side),
  like real circuits. Track files can set the real side: `"pit": {"side": "right"}`
  (Silverstone: right). Without it, the side with more room is used.
- A pit wall separates the lane from the track, with openings at the entry and exit.
- **Entering**: drive into the lane through the entry opening. Over 100 km/h at entry
  = **+5 s penalty** (the autopilot brakes you to 80 anyway). From then on the car **drives itself** to the
  driver's own box (one box per car, 10 boxes), with the limiter on.
- **The stop**: 3-4 s stationary (3 s + up to 1 s crew variation, deterministic), plus
  5 s per 100% damage for repairs. The tyres chosen with keys 1-5 are fitted.
- **Leaving**: the driver drives off; the pit limiter (80 km/h) stays forced on until the
  car is past the lane.
- **Race engineer** (`src/sim/strategy.ts`): the HUD shows a pit window for the mandatory
  stop (from tyre life and laps left) and a "BOX THIS LAP" banner near the pit entry
  only when it makes sense: middle-to-end of the window, tyres >70% worn, damage >30%, or
  the wrong tyres for the weather. Never every lap.
- Logic: `src/sim/pit.ts`; lane geometry: `buildPitLane` in `src/track/track.ts`.

## Weather

- Host setting: **Dry**, **Wet**, **Rain later** (dry, then wet over 60 s starting ~45% into
  the session) or **Drying** (wet, dries from ~35%). Track wetness 0-1.
- Wetness changes tyre grip (slicks are poor in the wet, inters/wets good), disables DRS
  at 30%+, and draws a rain overlay.

## Tracks

- Tracks must be **importable from data files**, so real F1 circuits can be added
  without code changes.
- A track file should hold at least: centreline/racing surface shape, track width, start/finish
  line, starting grid slots, sector lines, DRS detection + activation zones, pit lane
  path + pit boxes + speed-limit zone, track-limit boundaries, and surface regions
  (kerbs, grass, gravel, walls).
- **We design the tracks ourselves**, based on real F1 circuits.
- Format: **JSON**. The core is a **centreline** (a list of points, smoothed into a
  spline) with a **width per point**. Everything else (kerbs, sectors, DRS zones, pit
  lane, grid slots) is placed relative to the centreline, by distance along it.
- To make tracks: the **track editor** at `/editor.html` (`npm run dev`, then open
  http://localhost:5173/editor.html). Trace over a circuit image or import GeoJSON, drag
  points, set the start point/direction, export JSON into `src/tracks/` and register it in
  `src/tracks/index.ts`. "Test drive" opens the game with `?track=custom`.
- Real circuit layouts come from **bacinger/f1-circuits** (MIT) GeoJSON, scaled to about
  0.5 (0.4 made slow corners too tight to drive). Tracks: Silverstone, Bahrain (3 DRS
  zones like the real one), Albert Park (4 DRS zones), Monaco (full scale, 13 m wide, 1 DRS zone,
  pits left), COTA (2 zones, pits left), Spa (2 zones, pits left), Baku (0.8 scale, 13 m wide for the
  castle section, 2 zones, pits left), Yas Marina (2 zones, pits right; no exit tunnel). Import new circuits with
  `scripts/import-track.ts` (see its header).
  For DRS zones on new tracks, use the flat-out sections of the bots' speed profile.
- Rendering is simple: grey track, red/white kerbs, green grass, beige gravel, and the
  start/finish line, DRS zone markers and pit lane drawn plainly.

## Cars & teams

- Each car is a **small, simple top-down shape** (rectangle/wedge with a nose and
  wheels at most). It must be small relative to the track so there's room to race
  side by side and overtake.
- Players can pick a **team** (real F1 team colours) or a **custom colour**.
  **[OPEN]** Teams, free colours, or both.
- **All cars have identical performance** (for now). Team choice is only cosmetic.
- Show a name/number label above each car.

## Multiplayer

- **Online, friends only.** A player creates a lobby and shares an **invite link/code**.
  Friends open it in their browser and join. No accounts, no matchmaking.
- **No dedicated server.** The user does not want to host or pay for anything:
  - **Host-authoritative peer-to-peer**: the lobby creator's browser is the host. It
    runs the real simulation (physics, collisions, lap timing, penalties) and sends
    state to the others. Other players send only their inputs.
  - Transport: **WebRTC data channels via PeerJS** (free public PeerServer for the
    introduction only). Invite link = `?join=<6-char code>`. Nothing to deploy ourselves.
  - Clients use **prediction + interpolation** so their own car feels instant even with
    latency to the host.
  - Caveat: some strict networks block P2P without a TURN relay. Acceptable for a
    friends game; could add a free TURN option later if needed.
- The game itself is static files, deployable free to **GitHub Pages** (or similar).
- If the host leaves, the race ends (host migration is out of scope for now). A client
  who disconnects mid-race is retired (DNF). Joining mid-race is refused.
- **Max 10 players** per race, bots included.
- **Bots** (`src/sim/ai/`): the host adds them in the lobby (Easy / Medium / Hard), or uses
  "Race against bots" on the welcome screen (offline, starts with 5 bots). They follow a
  minimum-curvature racing line with a planned speed profile (pace: Easy 74%, Medium 86%,
  Hard 95% of grip), keep safe gaps, overtake when there is room, hold their grid column
  for 4 s at the start, use DRS/ERS, pit using the race engineer, change to wets in the
  rain, and reverse out if stuck. Bots run only on the host. `src/sim/bot.ts` is a
  simpler driver used by older tests.
- Code: `src/net/` — `host.ts` (lobby + authoritative session, snapshots 20 Hz,
  timing/standings 4 Hz), `client.ts` (mirror world, own-car prediction + reconciliation,
  interpolation 100 ms behind for other cars), `protocol.ts`, `peer.ts` (PeerJS),
  `transport.ts` (interfaces + in-memory `LoopbackNetwork` used by tests).
- The game loop keeps simulating in background tabs (a worker timer), because the host's
  browser runs the race for everyone.
- Session flow (qualifying → grid → lights → race → finished): `src/sim/session.ts`.
- **Deploy**: `.github/workflows/deploy.yml` builds and publishes to GitHub Pages on
  every push to main, once Pages is enabled (Settings → Pages → Source: GitHub Actions).

## Tech stack

- **TypeScript**, running in the browser.
- **HTML5 Canvas 2D** for rendering (flat shapes; no game engine needed).
- **Vite** for dev server + build.
- **Custom top-down car physics** (our own grip model), hand-rolled collisions.
- Networking: WebRTC via PeerJS (see Multiplayer).
- **Fixed-timestep simulation at 120 Hz**, kept separate from rendering, so the host
  simulation stays deterministic and clients can predict their own car.
- Godot was considered and rejected: the visuals don't need an engine, and a browser
  invite link is easiest with plain web tech.

## HUD (keep it minimal)

Speed, gear (optional), current position, lap X/Y, current/last/best lap time, gap to
car ahead/behind, tyre compound + wear, DRS available/active indicator, a small
minimap/timing tower, and penalty notices.

## Out of scope (for now)

- Detailed graphics, animations, 3D, car liveries, cinematic cameras.
- Full simulation-level physics (tyre temperature, setups, etc.) unless added later.
- Career mode, championships, accounts. Possible later additions.

## Testing

- `npm test` runs Vitest. Keep game rules (timing, physics behaviour) covered by tests,
  especially anything the host will rely on in multiplayer.

## Git workflow

- Remote: `origin` → https://github.com/eck123main/car (GitHub).
- **Commit often**: one commit per small, working change. Push to GitHub after each
  commit.
- Commit messages: short, plain, imperative, e.g. `Add car steering`, `Fix lap timer
  reset`. No long descriptions needed.
- Don't commit broken builds to `main`. Use a feature branch for bigger or experimental
  work and merge it when it works.
- Keep `node_modules/`, build output (`dist/`) and editor files out of git via
  `.gitignore`.

## Build order (status)

1. ✅ Single-player car driving.
2. ✅ Track JSON format + loader, track editor, Silverstone.
3. ✅ Lap timing, sectors, track limits.
4. ✅ Tyres, wear, ERS, DRS, slipstream.
5. ✅ Pit lane + pit stops + tyre choice.
6. ✅ Multiplayer: welcome screen, lobby, host settings, synced race.
7. ✅ Qualifying → grid → start lights → race → results.
8. ✅ Weather, collision penalties, car-to-car damage.

Possible next: more real circuits, safety car, per-part/visual damage, bots, rebindable
keys, TURN relay for strict networks, tuning top speed vs. the half-size tracks.
