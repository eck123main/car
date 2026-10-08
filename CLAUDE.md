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

1. **Lobby**: players join, pick a team/colour, the host picks the track and settings
   (laps, weather, etc.).
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
6. **Results**: finishing order, gaps, fastest lap, penalties.

## Driving & physics

Top-down 2D car physics that feels like an F1 car:

- **Throttle / brake / steering**, with acceleration that drops off at higher speed and
  strong braking.
- **Grip model**: grip comes from weight + downforce and is shared between braking/
  accelerating and cornering. Steering sets a turn rate, capped by the tightest turn the
  tyres can hold at the current speed. Too fast for a corner = the car runs wide (onto
  grass/gravel, maybe into the wall); it does **not** spin. This was chosen after a
  slip-angle tyre model proved too hard to control on a keyboard.
- **Downforce**: more grip at high speed and less in slow corners, so fast corners and
  hairpins feel different.
- **Slipstream**: following closely behind another car on a straight lowers drag.
- **DRS**: in marked DRS zones, a player within ~1 second of the car ahead (at the
  detection point) can open DRS for a top-speed boost. DRS closes on braking. Disabled
  on lap 1 and in the wet (real rules).
- **Surfaces**: track (full grip), kerbs (slightly less), grass/gravel/dirt (drivable
  but slower with less grip; you can always drive back onto the track), walls/barriers
  (collision).
- **Track scale**: keep tracks compact. Laps should be roughly 30–60 s, so real circuits
  are scaled down rather than built at full size.
- **Camera**: fixed north-up, following the car and zooming out a little with speed.
  It must **never rotate** with the car (tried it: disorienting, can cause motion sickness).
- **Tyres**: compounds **Soft / Medium / Hard** (and **Intermediate / Wet** if rain is
  added). Softs are faster but wear quickly, hards are slower but last. Grip drops as
  tyres wear.
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
| Pit request / tyre choice | **1 / 2 / 3** (Soft / Medium / Hard) | Pre-select the next tyres while driving; fitted at the next stop |
| Timing tower / standings | **Tab** (hold) | |
| Pause menu / settings | **Esc** | No real pause online; just opens the menu |

- Keys should be **rebindable** later.
- Note: the 2026 F1 rules replaced DRS with active aero plus a manual-override boost. We
  keep **DRS + ERS** because it's well known and fun in a top-down game.

## Rules to enforce

- Start lights and jump-start detection.
- Track limits (cutting corners / going fully off track gives a warning, then a time
  penalty).
- Pit lane speed limit.
- DRS rules (as above).
- **Mandatory pit stop**: every car must pit at least once and use at least two
  different dry compounds (as in real F1 dry races). A car that doesn't gets a time
  penalty added to its result.
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
- **[LATER]** Safety car (and maybe VSC) after big incidents.
- **[OPEN]** Blue flags?

## Collisions

- Cars collide with each other and with walls/barriers using simple physics (bounce,
  lose speed, maybe spin).
- **Carrying too much speed into a corner should end badly**: the car runs wide,
  off the track onto grass/gravel (which slows it hard and has little grip), and can
  end up in the wall.
- **Car damage is in, as one general damage value for now** (0–100%). Damage scales
  with impact force and lowers grip and top speed. Per-part damage (front wing, floor,
  etc.) and visual damage may come **later**.
- Below the crash threshold, a damaged car **always stays drivable enough to reach the
  pits**. Normal damage has a cap and never stops the car. Repairs happen at a pit stop
  (and add time to the stop).
- **Big crashes retire the car**: hitting a wall (or another car) clearly, above a
  set impact speed, means **DNF / out of the race**.

## Pit stops

- The track has a **pit lane** with entry and exit and a speed limit.
- The player drives into their pit box and the car **stops for a few seconds** (simple
  wait timer, no mini-game).
- During the stop the player can **choose new tyres** (and later repair damage or other
  options).
- Stop time = a base tyre-change time, plus extra time if damage is repaired.

## Weather (later)

- Rain events: grip drops, players need to pit for inters/wets, and DRS is disabled.
- Could start dry and turn wet mid-race (or the other way round) to force strategy calls.

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
  0.4 so laps stay short. Silverstone is the first one.
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
  - Transport: **WebRTC data channels**. Use a free public signalling service for the
    initial connection, e.g. **PeerJS** (public PeerServer) or **Trystero** (uses public
    relays). Nothing to deploy ourselves.
  - Clients use **prediction + interpolation** so their own car feels instant even with
    latency to the host.
  - Caveat: some strict networks block P2P without a TURN relay. Acceptable for a
    friends game; could add a free TURN option later if needed.
- The game itself is static files, deployable free to **GitHub Pages** (or similar).
- If the host leaves, the race ends (host migration is out of scope for now).
- **Max 10 players** per race. **No bots** for now.

## Tech stack

- **TypeScript**, running in the browser.
- **HTML5 Canvas 2D** for rendering (flat shapes; no game engine needed).
- **Vite** for dev server + build.
- **Custom top-down car physics** (our own tyre/grip model). Car-to-car and wall
  collisions can be hand-rolled (oriented boxes) or use a small 2D physics lib such as
  planck.js if that's simpler. Decide when we get there.
- Networking: WebRTC via PeerJS or Trystero (see Multiplayer).
- **Fixed-timestep simulation** (e.g. 60 Hz), kept separate from rendering, so the host
  simulation stays deterministic-ish and easy to sync.
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

## Suggested build order

1. Single-player car driving on a simple hard-coded track (get the handling right).
2. Track JSON format + loader, and a simple track editor; make one real circuit.
3. Lap timing, sectors, track limits.
4. Tyres, wear, grip levels, DRS, slipstream.
5. Pit lane + pit stops + tyre choice.
6. Multiplayer networking (lobby, synced race, collisions between players).
7. Qualifying → grid → start lights → race → results flow.
8. Weather, penalties, damage, extras.
