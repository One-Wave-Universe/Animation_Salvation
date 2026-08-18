# One Wave Production Art Pack

This folder is the canonical handoff for Claude and other animation agents.
It contains the current Goblin Raccoon Episode 01 production art, supporting
cast sheets, and identity references. Use these files directly; do not try to
recover artwork from pasted chat images.

## Episode 01: The Button

### Locked backgrounds

- `episode-01/backgrounds/forest-fork-machine-v1.png`
- `episode-01/backgrounds/forest-fork-machine-activated-v1.png`

Both plates use the same camera and road geometry. Do not pan, recrop, mirror,
or regenerate one plate independently of the other.

### Goblin Raccoon action sheets

- `walk-toward-24-v1.png` — 6 columns × 4 rows
- `walk-away-to-machine-24-v1.png` — 6 columns × 4 rows
- `stop-notice-poke-16-v1.png` — 4 columns × 4 rows
- `conduct-react-24-v1.png` — 6 columns × 4 rows

Read every sheet left-to-right, then top-to-bottom. The cyan color is a chroma
key, not part of the character. Anchor characters by the ground contact point,
not the changing sprite bounding box.

### Secondary action

- `squirrel-march-tree-loop-16-v1.png` — 4 columns × 4 rows

The squirrel sequence is chronological: pulse, rigid march, collision, squash,
recoil, dizzy hold, restart.

## Supporting cast

- `cast/noobs-acting-8.png` — male Crossing guardian
- `cast/cerberus-acting-8.png` — female three-headed boundary guardian
- `cast/nexus-acting-8.png` — female crystalline android, Oversight/Override

These are acting references, not complete locomotion cycles. Do not slide them
across a scene and call that walking. Generate a dedicated chronological action
sheet before locomotion.

## Continuity references

- `references/gr-canonical-model-sheet.png`
- `references/nexus-character-page.png`
- `references/nexus-story-world-page.png`

## Animation rules

1. Use true flip-book frame order.
2. Keep a fixed camera within a shot.
3. Ground-plane motion controls both character position and scale.
4. Hold contact poses long enough to communicate weight.
5. Use anticipation, action, overshoot, and settle.
6. Never use camera shake as a substitute for character movement.
7. Never place captions over a character.
8. Reject frames with costume drift, duplicated limbs, detached tails, or
   background fragments.

`manifest.json` gives the same information in machine-readable form.

