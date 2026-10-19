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
   picks track, laps, weather, qualifying on/off + release gap, mandatory stop, safety car,
   tyre wear, no contact, then starts.
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

## Party mode

Lobby setting **Mode: Party** (`RaceSettings.mode`, default `classic`): the normal race weekend
plus Mario Kart style items (`src/sim/items.ts`, drawing `src/render/items.ts`).
- **Boxes**: 2-4 rows across the track (3-5 boxes each), spread round the lap on the straightest
  stretch near each share of the lap, clear of the start line and of places where another part of
  the track is close (`placeItemBoxes`; clients work the layout out themselves). A box comes back
  4 s after it is hit. You hold **one item**; driving through a box while holding one just breaks it.
- **E** uses it (on the press). Odds by place (`itemOdds`): the leader only gets boost/rocket;
  further back, more hooks and rainbows.
- **Boost**: 1.5 s straight push (`Car.push`) and less drag, beats normal top speed.
- **Rocket**: flies straight from the nose (car speed + 45 m/s, 4 s max); ends harmlessly in a
  wall; a car it hits is **knocked out**: stopped, ghosted, and restarted on the centreline after
  2 s (`Session.knockOut`, via the reset queue). Keeps any item it held.
- **Hook**: pulls the next car up the road (within 250 m) back for 1.5 s, drawn as a green line.
  Kept if nobody is in range.
- **Rainbow**: 6 s, car flashes through the colours, a gentler boost, rockets and hooks don't
  affect it, and any car it touches is knocked out.
- Bots use them (`BotDriver.wantsItem`): rainbow at once, boost on a straight, rocket with a
  car dead ahead within 90 m, hook with a car in reach. Items only work in the race phase.
- Network: held item/effects/push in `CarSnap` (only when non-empty), boxes gone + rockets in
  the snapshot (`ItemsSnap`), `useItem` input flag, toasts via `item` events.

## Time trial mode

"Time trial" on the welcome screen (`src/app/timeTrial.ts`, rules in `src/sim/timeTrial.ts`).
Pick any real circuit and a ghost in the menu (track leaderboard shown there), then drive
alone: DRS free in every zone, ERS, no other cars.
- **Every lap is set on the same terms**: it starts from the same rolling start (the
  straightest spot 60-300 m before the line, 45 m/s), on fresh softs and a full ERS battery.
  Crossing the line to finish a lap puts the car straight back there, so nobody carries
  speed out of the last corner into the next lap.
- **All four wheels off** (`LapTimer.offTrack`; kerbs count as track), or entering the pit
  lane, cancels the lap. A prompt offers **R / ENTER = restart from the start** or keep
  driving. R, ENTER or the Esc menu's **Restart lap** restart at any time (no wait). Esc
  truly pauses (single player).
- **Leaderboard** (`src/net/leaderboard.ts`): best lap per player (random id per browser,
  `f1td.player`). Global when the build has `VITE_SUPABASE_URL` + `VITE_SUPABASE_KEY`
  (free Supabase project "race", schema in `supabase/time_trial.sql`: the public key can only
  read and add laps; deploy reads repo variables `SUPABASE_URL` / `SUPABASE_KEY`; local dev
  reads `.env.local`), otherwise kept in this browser only. Shown on the left in game with
  "Next:" the time to beat. No anti-cheat beyond sane-value checks.
  **Live**: saving a lap broadcasts "a lap was saved" on the Supabase Realtime channel
  `time_trial:<track>` (`Leaderboard.watch`, `@supabase/realtime-js`); everyone on that track
  re-reads the board from the database (never trusting the message) and gets a
  "NEW RECORD: name" notice if the record fell. Fallback reload every 30 s of driving; the local
  board uses the `storage` event between tabs.
- **Ghosts** (`src/sim/ghost.ts`): every personal best is uploaded with a 20 Hz recording, so
  any player's best can be raced. Default: the record lap, which is **your own best once you
  hold the record**. Beating the ghost you picked moves you on to the next player up. **G** cycles
  the top 5 other players, your best, off. Signed in, your best ghost also loads from the board on
  a new device. Drawn see-through in cyan (`GHOST_COLOR`; the player
  is red). The timing delta is against the ghost shown.

- **Medals** (`src/sim/medals.ts`, times in `src/tracks/medals.json`): Author / Gold / Silver /
  Bronze per track, like Trackmania. Gold/silver/bronze are author +4% / +10% / +20%. **Only
  signed-in players earn them**: a medal is worked out from the account's best lap on the board
  (`Leaderboard.bestsOf`), so it is kept with the account on any device, with no extra tables.
  Guests see the times and "sign in to earn medals". Shown in the time trial menu (per track, a
  count of all medals, medal next to each track name) and under the leaderboard in game (✓ won,
  gap to the next one); a lap that wins a better medal says so. Times come from
  `npx tsx scripts/medal-times.ts` (see its header: author = 0.80 x the Hard bot's lap, kept 1.5-3%
  under the world record where there is one). It only fills in tracks without medals: once players
  chase a time it shouldn't move. Note: good players are ~20% faster than the Hard bot (they carry
  far more corner speed), so bot laps alone are not a pace reference.

## Accounts

`src/net/accounts.ts`, schema `supabase/accounts.sql` (run after `time_trial.sql`). Username +
password only, **no email** (Supabase email sending was a pain), so passwords can't be reset:
after signing up or changing a password a "Save your password now" screen must be confirmed.
Rules (client and database): username 3-16 of `A-Z a-z 0-9 _ . -`, password 8-72 chars with a
letter and a number. Passwords are bcrypt-hashed in Postgres (pgcrypto); sign-in returns a
random session token (stored hashed), kept in `f1td.account`. The tables are closed to the public
key; everything goes through RPC functions (`sign_up`, `sign_in`, `sign_out`, `whoami`,
`change_password`, `submit_lap`). Ten wrong passwords lock an account for 5 minutes. Signed in,
`playerId()` is the account id, the name is the username, and laps are saved with `submit_lap`
so nobody else can post under an account (guests can't insert account ids). Guests still play.

## Sound & settings

- `src/audio/sound.ts`: recordings in `public/sounds/` (named in `sounds.json`, see its README) are
  used when present (engine loops pitched to the revs and crossfaded); anything missing is
  synthesized with Web Audio. Sound follows the car
  the camera is on: V6 engine (revs from speed and gear, drop on upshifts, rev on the grid,
  pops on lift-off, limiter bounce), turbo, ERS whine, wind, tyre squeal, kerb/gravel rumble,
  hits, and beeps: DRS available, DRS flap open/close, pit limiter on/off, each start light.
  Muted while paused, in a hidden tab or off the game screen.
- `src/app/settings.ts` (`f1td.settings`): sound on/off, volume, engine sounds (**off by default**
  until the engine sound is improved; players opt in), beeps, and the
  **big live delta** (top centre, green ahead / red behind, against your best or the ghost).
  On the welcome screen (Settings) and in the Esc menu.

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
- **Slipstream**: following within 60 m behind another car (and up to 4 m to the side,
  so it holds while pulling out to pass) lowers drag, up to 35%.
- **DRS**: in marked DRS zones, a player within ~1 second of the car ahead (at the
  detection point) can open DRS for a top-speed boost. DRS closes on braking. Disabled
  on lap 1 and in the wet (real rules). Cars in the pit lane or wrecked don't count at
  detection and can't open DRS. When open, the whole rear wing is drawn bright green.
  In a zone the HUD shows "press SPACE", or why not: "not within 1 s", "from lap 2",
  "off: rain", "off: safety car" (`DrsHint` in `src/sim/world.ts`).
  **Fairness**: every track's zones are worth 0.4-1.2 s a lap to a Hard bot (tested in
  `src/sim/drs.test.ts`; currently 0.54-1.01 s). Full bot races on every map check that
  each car crossing a detection line gets DRS exactly when it is within 1 s and past lap
  1, and a network test checks a client's DRS reaches the host and back.
- **Surfaces**: track (full grip), kerbs (slightly less), grass/gravel/dirt (drivable
  but slower with less grip; you can always drive back onto the track), walls/barriers
  (collision).
- **Walls**: a car only meets the walls of the stretch of track it is on (`Track.wallContact`),
  so where two parts of a track run close together (Baku's castle section next to the
  main straight) it can't be pushed through onto the other one.
- **Track width**: 21 m (wider than real F1 tracks, ~12-15 m): at half scale with keyboard
  steering, narrower tracks made it too easy to hit the walls and each other.
- **Track scale**: keep tracks compact. Laps should be roughly 30–60 s, so real circuits
  are scaled down rather than built at full size.
- **Camera**: follows the car and zooms out a little with speed. **Default: fixed north-up
  map.** Press **C** for the optional rotating view (the map turns so you always drive up),
  remembered between games. The rotating view must stay opt-in: a turning map is
  disorienting for some players and can cause motion sickness.
- **Tyres**: **Soft / Medium / Hard / Intermediate / Wet** (`src/sim/tyres.ts`). Life (laps to
  the 75% cliff, `tyreLife`) is a **share of the race** so every race length has a strategy:
  S 50%, M 75%, H 110%, I 80%, W 100%, but **never under S 4 / M 6 / H 9 / I 6 / W 7.5 laps**
  (also the life outside races). Dry grip S 1.025 / M 1.0 / H 0.975. Grip drops slowly with
  wear, then sharply past the cliff. A lap at the limit (`PUSHING_LOAD`) wears exactly the
  listed rate, so the life shown is what a fast player gets; gentle driving saves up to 25%,
  sliding / going off cost a little (max 1.5x). Rain tyres wear double on a dry track.
  **Balance** (`npx tsx scripts/tyre-strategy.ts`, test `tyreBalance.test.ts`): with the
  two-compound rule all one-stop pairings are within ~0-3 s; without it the best no-stop
  tyre wins (softs only in races of ~5 laps), as a stop costs 15-27 s.
  **Host setting "Tyre wear"** (on by default); always off in races under 5 laps without a
  mandatory stop (`Session.tyreWear`).
- **Brake boards** (100 / 50 m) are drawn before slow corners that follow a fast stretch.
- **[OPEN]** Fuel load / car getting lighter over the race? (Probably skip at first.)
- **ERS boost** button with a battery meter (see Controls).

## Controls

About 7 race keys, like the handful of buttons an F1 driver really uses on the wheel.
No handbrake: F1 cars don't have one, and drifting comes from overdriving the grip.

| Action | Key | Notes |
|---|---|---|
| Throttle / brake / steer | **W A S D** and **arrow keys** (both work) | Keyboard is on/off, so throttle and steering ramp smoothly in code |
| DRS | **Space** | Press once (or hold): opens in a DRS zone when allowed (within 1 s at detection in races) and stays open to the end of the zone or until you brake. A press up to 0.75 s before the zone counts. The HUD says why when it isn't allowed |
| ERS boost | **Shift** (hold) | Extra power from a battery meter that drains while used and recharges under braking |
| Pit limiter | **P** | Must be on in the pit lane, otherwise a speeding penalty |
| Tyre choice | **1-5** (Soft / Medium / Hard / Inter / Wet) | Next tyres for the pit stop; on the grid it picks starting tyres |
| Camera view | **C** | Fixed map (default) or rotating (you always drive up) |
| Switch driver | **← / →** (or A / D) | Spectating only: after your qualifying lap, once you've finished, or when you joined late |
| Use item (party mode) | **E** | Fires on the press |
| Reset to track | **R** | 5 s wait, no penalty. Qualifying: back to pit exit |
| Menu | **Esc** | No real pause online; just opens the menu |
| Mouse driving | **click the track** | Car steers towards the cursor (full lock 25° off its heading, `GameScreen.mouseSteer`); left button throttle, right brake, middle DRS; keys still work. Pressing a steering key switches back to the keyboard, so a resting mouse never steers (`Mouse` in `src/game/input.ts`) |

The timing tower is always shown (no Tab needed).

- Keys should be **rebindable** later.
- Note: the 2026 F1 rules replaced DRS with active aero plus a manual-override boost. We
  keep **DRS + ERS** because it's well known and fun in a top-down game.

## Rules to enforce

- **Start**: 4 s on the grid (held still), then 5 red lights 1 s apart, then lights out
  after 0.5-2.5 s. Moving forwards more than 1 m before lights out = **+5 s jump start**.
  No reversing on the grid.
- **Track limits: none.** Running wide never gives a warning, a deleted lap or a penalty
  (players found it too punishing). Grass and gravel slow the car hard, so cutting never
  pays. `LapTimer.offTrack` (all four wheels past the edge; kerbs count as track) is still
  tracked, e.g. to check bots stay on the road.
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
  - **Implemented** in `src/sim/collisions.ts` (`judge`), using each car's track position
    over the last 1.5 s: wrong-way driver is at fault; on a straight, a car that **moved
    across in front** of another less than 0.8 s before being hit is at fault (not the car
    that hit it); a car that **moved sideways into a car alongside** (front wheels level
    with its middle) is at fault; a car turning in on one that is *not* alongside is only
    blamed on the other car if it came >6 m/s faster (a dive-bomb), else racing incident;
    otherwise nose into gearbox = car behind; nose into side while closing >2 m/s faster =
    the hitter; everything else = racing incident. The penalty reason says which.
    **The car in front is almost never at fault for being hit from behind**, even while braking
    or drifting over to its line: it's only blamed for "moved across in front" if it cut
    across on a straight less than ~a car length (11 m centre to centre) ahead, under 0.8 s
    before the hit. In a corner, a car turning in only owes room to a car properly alongside
    (front wheels past its middle). "Wrong way" means moving backwards, so a spun car that
    is hit is never blamed. Only hits over 11 m/s (~40 km/h closing) are judged. A driver's
    first **two** minor at-fault hits are **warnings**; after that +5 s. Hits over 18 m/s: +5 s
    at once; wrecking the victim: +10 s. A pair is judged at most once every 3 s.
- **Safety car** (`src/sim/safetyCar.ts`, rules in `Session.updateSafetyCar`; host setting,
  on by default). A **wreck** brings it out (max 2 per race, 60 s apart, never once anyone
  is on the last lap). It appears 150 m ahead of the leader and drives the racing line at
  an easy pace (70% grip, max 160 km/h), slowing to 80 km/h if the field is far behind
  (e.g. everyone pitting). It is not a racer: no physics, no collisions.
  - While out: **no overtaking**, **no passing the SC**, **DRS off**. Breaking either rule is
    **+5 s, at most once per driver per safety car**. Passing a car under 22 km/h
    (`SC_SLOW_CAR`), anything in the pits, or a car that left the pits under 5 s ago is fine. Pit lane open, and the race engineer
    says box for a **cheap stop** if a stop is still owed or tyres are 40%+ worn.
  - **"SC in this lap"** after at least 25 s once no car is still wrecked and the whole
    field has queued up behind it (after 60 s, just the leader; after 90 s, regardless).
    Lights go out and it turns into the pit entry. **Restart at the line**: each car may
    overtake once it crosses it. DRS is back a lap after the restart.
  - Bots queue at the SC's pace (so nobody brakes mid-corner), in single file on the line of
    the car ahead (on a different line through a hairpin they'd get ahead without passing),
    never overtake under it (any car ahead, wherever it is across the track), and take the
    cheap stop. Tested with a slow human off the racing line in `safetyCar.test.ts`. Clients get its state in `SessionSnap` and its position in
    each 20 Hz snapshot. Drawn as a silver road car with a flashing amber light bar.
  - Why it's worth having even though everyone can reset: it bunches the field (gaps
    vanish, so restarts are a fight), makes a cheap pit stop a strategy call, and makes a
    crash matter to everyone.
- **[LATER]** Virtual safety car.
- **[OPEN]** Blue flags?

## Collisions

- Cars collide with each other (oriented-box SAT + impulses with spin) and with walls.
  Car-to-car hits count 60% as hard as wall hits for damage. Off in qualifying (ghosts).
- **No contact** (host setting, off by default): in the race, cars pass through each other (no
  hits, damage or collision penalties); slipstream, DRS and the safety car still work. Cars
  overlapping another one are drawn see-through (yours too) while they pass (`overlapping` in
  `src/app/game.ts`).
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
- Pit boxes are spread over the lane (about 13 m apart at Silverstone) and the autopilot
  only moves over into its box at the last moment, so a car parked in the box before
  never blocks it (this jammed the lane when the whole field pitted under the SC).
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
  0.5 (0.4 made slow corners too tight to drive). Tracks: Silverstone (3 DRS zones), Bahrain (3 DRS
  zones like the real one), Albert Park (4 DRS zones), Monaco (full scale, 13.5 m wide, 3 DRS zones,
  pits left), COTA (2 zones, pits left), Spa (2 zones, pits left), Baku (0.8 scale, 13 m wide for the
  castle section, 2 zones, pits left), Yas Marina (2 zones, pits right; no exit tunnel).
  **All 24 circuits of the 2026 calendar** are in (`src/tracks/index.ts`, calendar order;
  tests run on every one via `REAL_TRACK_IDS`). Exceptions to 0.5 scale / 21 m: Miami and
  Montreal 0.6 scale, 16.5 m (their close sections would overlap); Hungaroring 0.6 (DRS was
  worth too little on its short straights); Jeddah 16.5 m; Zandvoort and Suzuka 18.5 m;
  Shanghai 19.5 m, Monaco 13.5 m, Baku 13 m (any wider and walls reach other parts of the track). Where
  the real pit side had no room, the other side is used. Suzuka is a figure of eight: the
  two roads cross at the bridge, so each car tracks which stretch it's on
  (`Car.trackIndex`, `Track.query` hint; kept through resets and while held still), and
  cars on different stretches of the lap never collide (`onOtherStretches`: one goes over
  the bridge, the other under). Bots ignore cars on other stretches too.
  **10 circuits from earlier seasons** too (listed after the calendar in `TRACKS`): Imola, Hockenheim
  (0.6 scale, 18.5 m: its hairpin folded onto itself at 0.5), Nürburgring, Sepang, Istanbul Park,
  Portimão, Paul Ricard (the GeoJSON ran backwards; reversed to the real clockwise direction),
  Mugello, Estoril, Indianapolis (F1 road course). Menus list tracks **A-Z by name** (`trackChoices`).
  Import new circuits with
  `scripts/import-track.ts` (see its header).
  For DRS zones on new tracks, use the full-throttle sections from
  `npx tsx scripts/track-report.ts <id>` (start ~40 m in, end at the braking point), and
  check the "worth" figure stays in the fair band. Zones mostly follow the real circuits;
  game-only extras: Silverstone's Hamilton Straight, and Monaco's tunnel and Beau Rivage
  (its real main-straight zone alone was worth nothing).
- **Track review (Oct 2026)**: shapes match the real circuits; at half scale the share of
  the lap at full throttle (58-71%) is close to real F1, so straights were not stretched.
- Rendering is simple: grey track, red/white kerbs, green grass, beige gravel, and the
  start/finish line, DRS zone markers and pit lane drawn plainly.
- **Scenery** (`src/render/scenery.ts`, game only): grandstands with a crowd on the main
  straight and outside up to 4 big braking zones, pit garages, tyre walls, tree clumps and
  lighter grass patches. Static, built once per track (~0.1-0.2 s), drawn per visible cell,
  always clear of the walls and pit lane. Keep it light: no animation.

## Cars & teams

- Each car is a **small, simple top-down shape** (rectangle/wedge with a nose and
  wheels at most). It must be small relative to the track so there's room to race
  side by side and overtake.
- Players can pick a **team** (real F1 team colours) or a **custom colour**.
  **[OPEN]** Teams, free colours, or both.
- **All cars have identical performance** (for now). Team choice is only cosmetic.
- **Liveries** (`src/render/livery.ts`): each of the 10 lobby colours is painted as a
  team-inspired scheme (e.g. papaya with anthracite sidepods, silver/black with teal),
  colours and shapes only, no names/logos/sponsors. The colour stays the player's
  identity on the minimap and name tags. Every car also has a floor edge, two-element
  front wing with endplates, sidepod inlets, halo + helmet, mirrors, tyre sidewalls in
  the compound colour, a green rear wing with DRS open and a blinking rain light in the
  wet (`src/render/drawCar.ts`). A car is only ~35 px long, so details stay bold.
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
  - **Ping display**: the host pings each player once a second (`HostGame.tickNet`, from the
    race loop and a lobby timer) and reads WebRTC stats to see if the link is direct or
    **relayed** (PeerJS falls back to its public TURN servers in the EU/US, which adds a lot
    of ping even between neighbours). Everyone gets everyone's numbers (`net` message):
    shown in the lobby ("42 ms · direct"), in the timing tower (orange "R 140" = relayed) and
    as your own ping top right. Green < 60 ms, yellow < 120, red above.
  - **Two channels per player** (`src/net/peer.ts`): PeerJS's reliable one for the lobby, start,
    timing and events, and a **fast** one (a negotiated RTCDataChannel, id 100, unordered, never
    resent; `Connection.sendFast`) for snapshots, inputs and pings, so one lost packet doesn't hold
    up everything after it. Inputs are packed (`packInput`, ~20 bytes) and each packet repeats the
    last 8 unacknowledged ones; the host ignores ones it has seen. Clients drop snapshots older
    than the last. Snapshot numbers are rounded (mm). The host drains an input backlog that
    persists (queue never under 2 for 60 steps) so a player's car doesn't lag behind their keys.
    `LoopbackNetwork` can drop and reorder fast messages for tests.
  - Caveat: some strict networks block P2P without a TURN relay. Acceptable for a
    friends game; could add a free TURN option later if needed.
- The game itself is static files, deployable free to **GitHub Pages** (or similar).
- If the host leaves, the race ends (host migration is out of scope for now). A client
  who disconnects mid-race is retired (DNF).
- **Spectating** (`src/app/spectate.ts`, `GameScreen.updateSpectating`): someone who joins
  after the weekend has started gets the track and every car straight away and watches
  (they're in the lobby, so they race in the next weekend; only a full lobby turns people
  away). Drivers also spectate while waiting for their qualifying run, once it's done,
  and once they've finished the race. **← / →** (or A / D) switch between the cars out on
  track (everyone, if nobody is); the camera and HUD (speed, tyres, DRS, timing) follow
  that car, with a "SPECTATING name" banner. If the watched car parks, the view moves on.
- **Max 10 players** per race, bots included.
- **Bots** (`src/sim/ai/`): the host adds them in the lobby (Easy / Medium / Hard), or uses
  "Race against bots" on the welcome screen (offline, starts with 5 bots). They follow a
  minimum-curvature racing line with a planned speed profile (pace: Easy 74%, Medium 86%,
  Hard 95% of grip), follow by braking distance (as close as they could still stop from, so equal cars race
  within DRS range), keep safe gaps (measured directly, not just along the track, so hairpins work), overtake
  when there is room (never starting a pass once braking for a corner: no dive-bombs),
  never box from the grid, never steer towards a car alongside (more room the faster they're
  closing sideways) or move across in front of a car close behind, defend with **one move
  per straight** (Medium/Hard only, made early, covering the inside of the next braking
  corner, held until braking), hold their grid column
  for 4 s at the start, use DRS/ERS, pit using the race engineer, change to wets in the
  rain, reverse out if stuck, and press R if still stuck after 8 s. Bots run only on the host. `src/sim/bot.ts` is a
  simpler driver used by older tests.
- Dev server only: `window.f1game` is the running game (any mode; `f1game.driver.world()`),
  and the offline/host race is `window.f1host` in the browser console (e.g.
  `f1host.session.world.racers[2].car.retired = true` to trigger the safety car).
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

- Detailed graphics, animations, 3D, cinematic cameras. (Simple flat liveries are in.)
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
