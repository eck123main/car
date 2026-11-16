# Car models (optional)

Drop a car model here to replace the built-in **GT3** or **Hypercar** body in the 3D view:

- `gt3.glb` – used for the GT3 class
- `lmh.glb` – used for the Hypercar class

No file = the built-in car. Physics never changes; this is looks only.

**From Sketchfab**: on the model's page, Download → "glTF Binary (.glb)" (or "Autoconverted format (glb)").
Check the license (CC BY = credit the author; skip NonCommercial / NoDerivatives / Editorial ones).

What the game does with it (`src/render3d/customBody.ts`):
- hides the model's own wheels (by mesh/material name) and keeps the game's, so they spin, steer and show the tyre;
- turns it to face forward and scales it so its axles sit on the game's wheels;
- merges it into one mesh per material (few draw calls) and paints materials named like "paint" in the player's colour;
- uses the built-in cockpit for the cockpit cameras and puts the roof / bonnet / bumper / rear cams on the new body.

The browser console says how it went: `[models] gt3: gt3.glb, 238000 triangles, 14 draw calls, fitted by axles`.

Keep models light: aim for under ~100k triangles and a few MB (Blender: Decimate modifier; or
`npx @gltf-transform/cli optimize in.glb gt3.glb --compress meshopt`, which the game can read).

## models.json (only if the defaults are wrong)

```json
{
  "gt3": { "file": "gt3.glb", "turn": 180, "scale": 1.0, "lift": 0, "hide": "wheel|tire|rim|brake", "tint": "paint" },
  "lmh": { "file": "lmh.glb", "tint": false }
}
```

- `turn`: degrees, if the car comes out backwards (180) or sideways (90)
- `scale` / `lift`: nudge size and height after the automatic fit
- `hide`: which parts are the wheels (regex on mesh and material names)
- `tint`: which materials take the player's colour (regex), or `false` to keep the model's own paint
