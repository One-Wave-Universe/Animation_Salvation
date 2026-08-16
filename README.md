# Character Animator

Upload a PNG character, get an auto-rigged 3D model (mesh + skeleton with ball/hinge
joints), then direct a scene in plain English and have it play out on the rig.

## How it works

1. **Upload** — a PNG (transparent background works best) is masked and run through
   a monocular depth model (`onnx-community/depth-anything-v2-small`, via
   `@huggingface/transformers`) **entirely in your browser** — no server, no upload
   of your image anywhere.
2. **Mesh** — the depth map displaces a front + mirrored-back relief mesh, stitched
   at the silhouette edge for a closed, posable volume.
3. **Rig** — the silhouette is skeletonized (thinning → topological bone graph),
   rooted at the tree's topological center, and each joint is heuristically tagged
   **ball** (branch points — shoulders/hips-like) or **hinge** (simple bends —
   elbows/knees-like), with an editable list in the UI (click a badge to relabel).
4. **Direct** — free text goes to a small backend endpoint that calls Claude with the
   rig's actual bone names and a fixed action-primitive schema (walk_to, turn_to_face,
   wave, jump, sit, look_at, move_to, custom_pose), returns a validated JSON timeline,
   and the client plays it back procedurally against the rig's joint constraints.
5. **Export** — GLB (mesh + skeleton + current pose) or a recorded WebM of the
   viewport.

## Running it

```bash
npm install          # installs both client/ and server/ workspaces
cp server/.env.example server/.env   # then add your ANTHROPIC_API_KEY
npm run dev           # runs client (5173) + server (8787) together
```

Open http://localhost:5173. The scene director needs `ANTHROPIC_API_KEY` set in
`server/.env` — without it, upload/rig/animate/export all still work, only the
text-to-timeline feature needs the key.

## Honest limitations

- **A single photo only shows one side.** The back/sides of the mesh are a mirrored
  guess, not a real reconstruction — this is true of every single-image 3D tool, not
  a gap specific to this one. Full-body, front-facing, T/A-pose art rigs most reliably.
- **Auto joint classification is a heuristic**, not a solved problem for arbitrary
  creatures — it's right most of the time on clean art and editable when it's wrong
  (click a bone's badge in the rig panel).
- **Best results come from art with overlapping joints** (a shoulder circle
  overlapping the torso, a neck overlapping the head), the way most character art is
  actually drawn. Parts separated by a visible gap in the source image can end up
  disconnected in the rig; a small morphological closing pass bridges tiny
  (antialiasing-level) gaps automatically, but a large intentional gap will not
  produce a bone across it.
- **The procedural action library is a fixed set** (walk/turn/wave/jump/sit/look-at/
  move-to/idle/custom-pose), not free-form physics or IK — the scene director maps
  your instruction onto these, it doesn't synthesize arbitrary new motions.
