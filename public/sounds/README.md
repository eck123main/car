# Game sounds

Drop sound files in this folder with the names below. The game uses every file it finds;
anything missing keeps the built-in made-up sound. Reload the page after adding files.

| File | What it is |
|---|---|
| `engine-low.mp3` | Steady engine loop at about 6000 rpm |
| `engine-mid.mp3` | Steady engine loop at about 9000 rpm |
| `engine-high.mp3` | Steady engine loop at about 12000 rpm |
| `drs-open.mp3` | DRS flap opening (also used for closing if there's no `drs-close`) |
| `drs-close.mp3` | DRS flap closing |
| `drs-beep.mp3` | "DRS available" beep |
| `start-light.mp3` | Beep for each red start light |
| `gear-shift.mp3` | Upshift crack |
| `crash.mp3` | Hitting a wall or a car |
| `tyre-squeal.mp3` | Tyre squeal loop |
| `wind.mp3` | Wind noise loop |

- **Engine loops** matter most. Each one should hold the same revs the whole time (no gear
  changes, no fade in/out) and loop without a click. One loop is enough: the game speeds it up
  and slows it down to follow the revs. With two or three it crossfades between them.
  If you know a loop's real revs, change its `rpm` in `sounds.json`.
- **Other formats** (`.wav`, `.ogg`): change the file name in `sounds.json` to match.
- **Licences**: this folder is published with the game, so only use sounds you're allowed to
  share (e.g. CC0 from freesound.org, or pixabay). No rips from F1 games or broadcasts.
