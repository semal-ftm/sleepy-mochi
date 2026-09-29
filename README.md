# Sleepy Mochi

*A tiny squish break for your busy brain.*

Sleepy Mochi is a small interactive 3D toy. You poke, drag, squish, and jiggle a sleepy mochi. The mesh itself deforms as a spring-driven soft body, and the face stays attached to the moving surface.

## Run it

Requires Node.js 18 or newer.

```bash
npm install
npm run dev       # start the dev server, then open the printed URL
npm run build     # production build into dist/
npm run preview   # serve the production build locally
```

## How to play

- **Poke** (click or tap): makes a local dent, and a ripple spreads across the body. Poke it too often and it gets a little grumpy.
- **Drag**: grab any spot to lift the mochi off its plate and carry it wherever the cursor goes. It follows with a soft lag: the grabbed spot stretches toward the cursor, and the rest of the body dangles and sways. Pull down into the plate to stretch it instead.
- **Release**: it drops back onto the plate with a squishy landing (a quick flick tosses it a little), slides back to the middle, wobbles, smiles, and slowly falls back asleep.
- **Squish / Jiggle**: buttons that compress the body (it bulges sideways and rebounds) or give it a playful shake.
- **Softness / Bounciness / Damping**: change how the body feels. Softness sets spring stiffness, grab radius, and how far it can stretch. Bounciness sets impulse strength and rebound overshoot. Damping sets how quickly the wobble dies down.
- **Flavor**: Strawberry, Lavender, or Vanilla. The color fades smoothly, and the animation keeps running.
- **Sound**: off by default. Turn it on to hear quiet pop, squish, boing, and sleepy sounds, generated with the Web Audio API.
- **Reset**: brings back the original shape, expression, and motion.

## How it works

| File | Purpose |
| --- | --- |
| `src/softbody.js` | Procedural mochi mesh (welded icosphere, about 10.9k vertices) and the soft-body solver |
| `src/face.js` | Canvas-drawn eyes, mouth, and cheeks as decals anchored to the surface; feet; nose bubble |
| `src/expression.js` | Expression state machine with smoothly blended facial parameters |
| `src/zzz.js` | Floating "z" sprites shown while asleep |
| `src/audio.js` | Procedural, rate-limited Web Audio sound effects |
| `src/main.js` | Scene, lighting, fixed-step loop, pointer input, and UI wiring |

**Soft body.** Each vertex stores its rest position, a displacement, and a velocity. The solver runs at a fixed 120 Hz, with at most 6 substeps per frame. Each step:

- Pulls every vertex toward a target with a spring. The target is its rest position, the squish field, or the grab field.
- Adds Laplacian coupling to neighboring vertices, which acts as surface tension and makes dents spread and ripple.
- Applies damping.
- Adds a volume-preservation force along the rest normals.
- Enforces a floor constraint so the base never sinks.

Displacement and velocity are clamped, so the mesh can't blow up. After a long frame gap (such as a hidden tab), the elapsed time is dropped instead of simulated. Normals are recomputed every frame, so the lighting follows the shape.

**Grabbing.** A raycast finds the triangle under the pointer. The hit point is mapped back to rest space using barycentric coordinates. Pointer movement is projected onto a camera-facing drag plane through the hit point and then converted to the body's local space.

**Face attachment.** Each facial feature keeps three barycentric anchors on the body: its center, a point to one side, and a point above. They are evaluated on the deformed vertices every frame. That gives each decal its position, a tangent frame that follows the surface normal, and a mild stretch that is clamped so the face stays readable.

## Notes

- Everything is procedural: there are no model, texture, or audio files.
- Dependencies are pinned exactly: `three@0.169.0` and `vite@5.4.10`.
- The device pixel ratio is capped at 2. The render loop avoids per-frame allocations.
- If WebGL isn't available, a friendly message is shown instead.
