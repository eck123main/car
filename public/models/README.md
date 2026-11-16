# Car models (optional)

Drop a car model here to replace the built-in **GT3** or **Hypercar** body in the 3D view:

- `gt3.glb` – used for the GT3 class
- `lmh.glb` – used for the Hypercar class

No file = the built-in car. Physics never changes; this is looks only.

**Several cars per class**: put them in `gt3/` and `lmh/` and list them in `models.json` (below).
Other cars get a mix of them (fixed per car), and **K** in the 3D view (or open road) switches your
own car to the next one (remembered per class).

**From Sketchfab**: on the model's page, Download → "glTF Binary (.glb)" (or "Autoconverted format (glb)").
Check the license (CC BY = credit the author; skip NonCommercial / NoDerivatives / Editorial ones).

What the game does with it (`src/render3d/customBody.ts`):
- hides the model's own wheels (by mesh/material name) and keeps the game's, so they spin, steer and show the tyre;
- turns it to face forward and scales it so its axles sit on the game's wheels;
- merges it into one mesh per material (few draw calls) and paints untextured materials named like "paint" in the player's colour (a textured paint is the model's own livery and is kept);
- leaves the model's interior off other cars; your own car keeps it: the cockpit cameras sit where a driver
  sits from the model's steering wheel, which turns with the game's (the game's gloves and arms hold it)
  and its mirrors show the rear view. No steering wheel found (names like steer / volante / `sw_`): the built-in cockpit;
- puts the roof / bonnet / bumper / rear cams on the new body.

The browser console says how it went: `[models] gt3: gt3.glb, 238000 triangles, 14 draw calls, fitted by axles`.

Keep models light: aim for under ~100k triangles and a few MB (Blender: Decimate modifier; or
`npx @gltf-transform/cli optimize in.glb gt3.glb --compress meshopt`, which the game can read).

## models.json (only if the defaults are wrong)

```json
{
  "gt3": [
    { "file": "gt3/porsche-992-gt3-r.glb", "name": "Porsche 911 GT3 R" },
    { "file": "gt3/bmw-m4-gt3.glb", "name": "BMW M4 GT3" }
  ],
  "lmh": { "file": "lmh.glb", "tint": false }
}
```

One spec or a list per class. Each takes these options:

```json
{
  "gt3": { "file": "gt3.glb", "turn": 180, "scale": 1.0, "lift": 0, "hide": "wheel|tire|rim|brake", "tint": "paint" },
  "lmh": { "file": "lmh.glb", "tint": false }
}
```

- `turn`: degrees, if the car comes out backwards (180) or sideways (90)
- `scale` / `lift`: nudge size and height after the automatic fit
- `hide`: which parts are the wheels (regex on mesh and material names)
- `drop`: parts left out (regex on material names; default: the interior, as the game's own cockpit is used), `""` keeps everything
- `tint`: which materials take the player's colour (regex), or `false` to keep the model's own paint
