# Goblin Raccoon Turnaround Pack

Production anchors for character rigging, stop-motion posing, and dialogue.

- `goblin_raccoon_fullbody_360_8view_v1.png`: masked full-body anchors.
- `goblin_raccoon_fullbody_360_8view_maskoff_v1.png`: matching mask-off anchors.
- `goblin_raccoon_head_visemes_5angle_5state_v1.png`: multi-angle dialogue mouth states.
- `goblin_raccoon_fullbody_midangles_hood_on_v1.png`: masked 22.5-degree
  midpoint anchors with the hood up.
- `goblin_raccoon_fullbody_midangles_hood_off_v1.png`: masked 22.5-degree
  midpoint anchors with the hood down and the ears/head construction exposed.
- `goblin_raccoon_fullbody_8view_maskoff_hoodoff_v1.png`: complete natural-face,
  hood-down full-body turnaround.
- `goblin_raccoon_head_visemes_maskoff_hoodoff_5angle_5state_v1.png`: natural-face,
  hood-down dialogue states across five viewing angles.
- `goblin_raccoon_walk_right_12frame_maskoff_hoodoff_v1.png`: full-body
  right-facing walk cycle with twelve close flipbook poses.

Clockwise full-body order is front, front-right, right, back-right, back,
back-left, left, front-left. Keep the mask-on and mask-off angle indices aligned.

The full-body pages are rotational anchors, not 360 unrelated redraws. Use the
anchor sequence to drive a single rig and render numbered `000` through `359`
frames. This prevents identity, outfit, feet, and tail drift between degrees.
