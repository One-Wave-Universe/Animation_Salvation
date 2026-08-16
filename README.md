# Character Animator

Upload a PNG character and get an auto-rigged animatable model, driven either by a
full 3D skeleton or by a set of flat photo-real layers, then direct a scene in plain
English and have it play out on the rig. Two render modes, picked per upload:

- **3D Rig** — a continuous mesh with a full ball/hinge skeleton. Best for big
  mechanical motion (walking, jumping, gestures). The back of the mesh is a mirrored
  guess, and large rotations can look somewhat rubbery since there's only one
  continuous surface.
- **Photo Animation** — the character split into flat per-limb layers that keep the
  original photo's real pixels, composited at the right depth. Best for subtle,
  photorealistic motion (a sway, a head turn) — closer to how tools like Deep
  Nostalgia work. Moving a layer can reveal a gap where it used to overlap another
  part (there was never a photo of what's underneath); an optional AI inpainting pass
  fills those gaps in once, at rig-setup time.

Both modes share the same rig extraction, the same procedural action library
(walk/turn/wave/jump/sit/look-at/move-to/idle/custom-pose), and the same AI scene
director — only what's attached to the bones differs.

## How it works

1. **Upload** — a PNG (transparent background works best) is masked and run through
   a monocular depth model (`onnx-community/depth-anything-v2-small`, via
   `@huggingface/transformers`) **entirely in your browser** — no server, no upload
   of your image anywhere for this step.
2. **Rig** — the silhouette is skeletonized (thinning → topological bone graph),
   rooted at the tree's topological center, and each joint is heuristically tagged
   **ball** (branch points — shoulders/hips-like) or **hinge** (simple bends —
   elbows/knees-like), with an editable list in the UI (click a badge to relabel).
   This step is identical in both modes.
3. **Mode A — Mesh**: the depth map displaces a front + mirrored-back relief mesh,
   stitched at the silhouette edge for a closed, posable volume, then skinned to the
   rig.
   **Mode B — Layers**: every silhouette pixel is assigned to its nearest bone
   (a hard 2D version of the skinning weights), producing one small textured plane
   per bone, parented directly to that bone — no deformation, just a rigid photo
   cutout per part.
4. **Mode B only — Fill hidden areas**: for each parent/child bone pair, a heuristic
   (dilate the parent's own region toward the joint, intersect with the child's
   region) estimates what part of the parent is hidden behind the child in the
   photo. Each such gap is sent once to `/api/inpaint-layer` (OpenAI's image-edit
   API) to be filled in, so moving the child later doesn't reveal a transparent hole.
   This costs a real API call per gap and only needs to run once per character.
5. **Move it** — two ways, no API key required for either to just get the character
   moving:
   - **Quick actions**: one-click built-in motions (wave, walk forward, turn around,
     jump, sit, a short combo) — hand-written timelines, run entirely client-side.
   - **Direct the scene**: free text goes to a small backend endpoint that calls
     Claude or ChatGPT (your choice, whichever key you've configured) with the rig's
     actual bone names and a fixed action-primitive schema, and returns a validated
     JSON timeline for more specific/custom sequences.
   Both produce the same kind of timeline, played back procedurally against the
   rig's joint constraints.
6. **Export** — GLB (current pose, mesh or layers + skeleton), or record a WebM clip
   of whatever's currently playing — recording length automatically matches the
   active action sequence's duration. Made for stitching clips together in an
   external video editor afterward.

## Running it

```bash
npm install          # installs both client/ and server/ workspaces
cp server/.env.example server/.env   # then add your API key(s)
npm run dev           # runs client (5173) + server (8787) together
```

Open http://localhost:5173. `server/.env` accepts `ANTHROPIC_API_KEY` and/or
`OPENAI_API_KEY` — either enables the scene director (pick which one to use per
request in the UI); only `OPENAI_API_KEY` enables the Photo Animation mode's "fill
hidden areas" step, since inpainting is an OpenAI-specific capability. Without any
key, upload/rig/animate/export all still work.

## Honest limitations

- **A single photo only shows one side/angle.** Mode A's mesh back is a mirrored
  guess; Mode B's inpainted regions are a plausible AI guess, not the real hidden
  content. This is true of every single-image animation tool, not a gap specific to
  this one. Full-body, front-facing, T/A-pose art rigs most reliably in both modes.
- **Auto joint classification is a heuristic**, not a solved problem for arbitrary
  creatures — it's right most of the time on clean art and editable when it's wrong
  (click a bone's badge in the rig panel; this affects both modes identically).
- **Best results come from art with overlapping joints** (a shoulder circle
  overlapping the torso, a neck overlapping the head), the way most character art is
  actually drawn. Parts separated by a visible gap in the source image can end up
  disconnected in the rig; a small morphological closing pass bridges tiny
  (antialiasing-level) gaps automatically, but a large intentional gap will not
  produce a bone across it.
- **Mode B's occlusion detection is a geometric heuristic**, not a true physical
  solve — there's no way to know the real hidden shape from one photo. It estimates
  *where* a gap is likely to appear well enough to target inpainting, but the filled
  content is the AI model's plausible guess, not ground truth.
- **The procedural action library is a fixed set**, not free-form physics or IK — the
  scene director maps your instruction onto these, it doesn't synthesize arbitrary
  new motions.
