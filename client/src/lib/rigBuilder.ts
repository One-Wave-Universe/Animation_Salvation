import type { BoneNode, RigDescription } from '../types';
import type { SkeletonGraph } from './skeletonize';
import type { MeshBuildResult } from './meshBuilder';

interface RawNode {
  id: number;
  px: number;
  py: number;
}

export function buildRig(
  graph: SkeletonGraph,
  mesh: Pick<MeshBuildResult, 'sampleFront'>,
  mask: Uint8Array,
  imgWidth: number,
  imgHeight: number,
): RigDescription {
  if (graph.nodes.length === 0) {
    throw new Error('Could not extract a skeleton from this image (empty silhouette).');
  }

  const rawNodes: RawNode[] = graph.nodes.map((n) => ({ id: n.id, px: n.px, py: n.py }));
  let nextId = rawNodes.length;
  const adjacency = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a)!.push(b);
    adjacency.get(b)!.push(a);
  };

  for (const edge of graph.edges) {
    if (edge.polyline.length === 0) {
      link(edge.a, edge.b);
      continue;
    }
    let prev = edge.a;
    for (const [px, py] of edge.polyline) {
      const id = nextId++;
      rawNodes.push({ id, px, py });
      link(prev, id);
      prev = id;
    }
    link(prev, edge.b);
  }

  const nodeById = new Map(rawNodes.map((n) => [n.id, n]));

  // Root = the tree's topological center (iteratively trim leaves until the center
  // remains), not "whichever pixel happens to have the highest local degree" — that
  // heuristic is fragile to skeletonization noise (a stray extra branch pixel
  // shouldn't relocate the root from the torso out to a limb). The center of a tree
  // is exactly the anatomically central point equidistant from its extremities,
  // which for a humanoid lands at/near the torso regardless of local noise.
  const rootId = findTreeCenter(adjacency);

  // BFS to turn the (possibly cyclic) adjacency graph into a tree.
  const parentOf = new Map<number, number | null>();
  const childrenOf = new Map<number, number[]>();
  parentOf.set(rootId, null);
  const queue = [rootId];
  const visited = new Set([rootId]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of adjacency.get(cur) ?? []) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      parentOf.set(nb, cur);
      if (!childrenOf.has(cur)) childrenOf.set(cur, []);
      childrenOf.get(cur)!.push(nb);
      queue.push(nb);
    }
  }

  const modelPos = new Map<number, [number, number, number]>();
  for (const n of rawNodes) {
    if (!visited.has(n.id)) continue;
    modelPos.set(n.id, resolveModelPosition(mesh, mask, imgWidth, imgHeight, n.px, n.py));
  }

  const names = assignNames(rootId, childrenOf, nodeById, modelPos);

  const bones: BoneNode[] = [];
  for (const id of visited) {
    const parentId = parentOf.get(id) ?? null;
    const children = childrenOf.get(id) ?? [];
    const pos = modelPos.get(id)!;

    let jointType: BoneNode['jointType'];
    if (parentId === null) jointType = 'root';
    else if (children.length >= 2) jointType = 'ball';
    else jointType = 'hinge';

    const node = nodeById.get(id)!;
    const bone: BoneNode = {
      id: `b${id}`,
      name: names.get(id) ?? `Bone${id}`,
      parentId: parentId === null ? null : `b${parentId}`,
      position: pos,
      pixelPosition: [node.px, node.py],
      jointType,
    };

    if (jointType === 'ball') {
      bone.ballConeLimitDeg = 70;
    } else if (jointType === 'hinge') {
      const parentPos = parentId !== null ? modelPos.get(parentId) : null;
      const childPos = children.length === 1 ? modelPos.get(children[0]) : null;
      bone.hingeAxis = computeHingeAxis(parentPos, pos, childPos);
      bone.hingeMinDeg = -100;
      bone.hingeMaxDeg = 100;
    }

    bones.push(bone);
  }

  return { bones: capFinalBoneCount(bones, MAX_BONES) };
}

const MAX_BONES = 40;

/**
 * skeletonize.ts already caps the raw skeleton graph, but each surviving edge can
 * still contribute a few simplified-polyline midpoints as their own bones here —
 * so the graph-level cap doesn't bound what the user actually sees. Enforce the
 * real ceiling on the final bone list: repeatedly drop whichever leaf bone sits
 * closest to its parent (least anatomically significant) until under the cap.
 */
function capFinalBoneCount(bones: BoneNode[], maxBones: number): BoneNode[] {
  let result = bones;
  while (result.length > maxBones) {
    const childCount = new Map<string, number>();
    for (const b of result) {
      if (b.parentId) childCount.set(b.parentId, (childCount.get(b.parentId) ?? 0) + 1);
    }
    let shortestLeaf: BoneNode | null = null;
    let shortestDist = Infinity;
    for (const b of result) {
      if (b.jointType === 'root' || (childCount.get(b.id) ?? 0) > 0) continue; // not a leaf
      const parent = result.find((p) => p.id === b.parentId);
      const dist = parent
        ? Math.hypot(b.position[0] - parent.position[0], b.position[1] - parent.position[1], b.position[2] - parent.position[2])
        : Infinity;
      if (dist < shortestDist) {
        shortestDist = dist;
        shortestLeaf = b;
      }
    }
    if (!shortestLeaf) break; // no leaves left to trim (shouldn't happen for a tree with >1 node)
    result = result.filter((b) => b.id !== shortestLeaf!.id);
  }
  return result;
}

/**
 * Standard tree-center algorithm: repeatedly strip leaves until 1-2 nodes remain.
 * Requires an acyclic graph — cycle nodes never drop below degree 2, so leaf-trimming
 * stalls with nodes still unresolved. Junction-pixel clustering can occasionally leave
 * a spurious short cycle (e.g. two adjacent branch pixels both linking to the same
 * neighbor), so build a spanning tree first rather than trust the raw adjacency to be
 * cycle-free.
 */
function findTreeCenter(rawAdjacency: Map<number, number[]>): number {
  const adjacency = spanningTreeAdjacency(rawAdjacency);
  const degree = new Map<number, number>();
  const neighbors = new Map<number, Set<number>>();
  for (const [id, adj] of adjacency) {
    neighbors.set(id, new Set(adj));
    degree.set(id, adj.length);
  }

  let frontier = [...degree.entries()].filter(([, d]) => d <= 1).map(([id]) => id);
  let remaining = degree.size;

  while (remaining > 2 && frontier.length > 0) {
    const next: number[] = [];
    for (const leaf of frontier) {
      remaining--;
      for (const nb of neighbors.get(leaf) ?? []) {
        neighbors.get(nb)?.delete(leaf);
        const d = (degree.get(nb) ?? 1) - 1;
        degree.set(nb, d);
        if (d === 1) next.push(nb);
      }
    }
    frontier = next;
  }

  return frontier[0] ?? degree.keys().next().value!;
}

function spanningTreeAdjacency(adjacency: Map<number, number[]>): Map<number, number[]> {
  const start = adjacency.keys().next().value;
  if (start === undefined) return new Map();
  const tree = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    if (!tree.has(a)) tree.set(a, []);
    if (!tree.has(b)) tree.set(b, []);
    tree.get(a)!.push(b);
    tree.get(b)!.push(a);
  };
  const visited = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of adjacency.get(cur) ?? []) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      link(cur, nb);
      queue.push(nb);
    }
  }
  return tree;
}

function resolveModelPosition(
  mesh: Pick<MeshBuildResult, 'sampleFront'>,
  mask: Uint8Array,
  imgWidth: number,
  imgHeight: number,
  px: number,
  py: number,
): [number, number, number] {
  let sample = mesh.sampleFront(px, py);
  if (!sample) {
    // Spiral outward to the nearest in-mask pixel (thinning can leave a skeleton
    // pixel one step outside the grid-sampled silhouette at low resolutions).
    for (let r = 1; r < 12 && !sample; r++) {
      for (let dy = -r; dy <= r && !sample; dy++) {
        for (let dx = -r; dx <= r && !sample; dx++) {
          const x = px + dx;
          const y = py + dy;
          if (x < 0 || y < 0 || x >= imgWidth || y >= imgHeight) continue;
          if (mask[y * imgWidth + x] > 0) sample = mesh.sampleFront(x, y);
        }
      }
    }
  }
  if (!sample) return [0, 0, 0];
  return [sample.x, sample.y, sample.z];
}

function computeHingeAxis(
  parentPos: [number, number, number] | null | undefined,
  pos: [number, number, number],
  childPos: [number, number, number] | null | undefined,
): [number, number, number] {
  if (!parentPos || !childPos) return [0, 0, 1];
  const inDir = normalize(sub(pos, parentPos));
  const outDir = normalize(sub(childPos, pos));
  const axis = cross(inDir, outDir);
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  if (len < 1e-4) return [0, 0, 1];
  return [axis[0] / len, axis[1] / len, axis[2] / len];
}

function sub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(a: [number, number, number]): [number, number, number] {
  const len = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / len, a[1] / len, a[2] / len];
}

/**
 * Best-effort anatomical labeling for the rig editor UI and for the action library's
 * name-prefix lookups (findByPrefix('Arm') etc.) — so it has to stay correct at every
 * branch point in the tree, not just root's immediate children. Whenever a branch
 * forks again further down (e.g. root's single "downward" child turns out to be the
 * hip, which then forks into two legs), each fork gets its own L/R decision relative
 * to *that* fork point, rather than inheriting one label for the whole subtree.
 */
type BodyPartCategory = 'Head' | 'Leg' | 'Arm' | 'Limb';

/**
 * What kind of body part does this branch look like, judged from `originPos`
 * (the point it forks off from) rather than the ultimate root - a sub-fork
 * needs to be judged on its own local geometry, not the whole trunk it
 * happens to hang off of. See the recursive re-classification in nameChain.
 */
function classifyBranch(
  branchId: number,
  originPos: [number, number, number],
  childrenOf: Map<number, number[]>,
  modelPos: Map<number, [number, number, number]>,
): { category: BodyPartCategory; dx: number } {
  const tip = deepestDescendant(branchId, childrenOf);
  const tipPos = modelPos.get(tip) ?? modelPos.get(branchId)!;
  const dx = tipPos[0] - originPos[0];
  const dy = tipPos[1] - originPos[1];
  // How far *any* node in this branch gets from its origin - not joint count.
  // A detailed head (ears, glasses, snout) can easily out-joint a real arm
  // (2-3 bones) while staying anatomically compact; a chain that's merely
  // deep isn't the same as a chain that reaches far.
  const reach = subtreeMaxReach(branchId, childrenOf, modelPos, originPos);

  if (dy > 0.15 && Math.abs(dx) < 0.35 && reach < 0.5) return { category: 'Head', dx };
  if (dy < -0.25) return { category: 'Leg', dx };
  if (Math.abs(dx) > 0.2) return { category: 'Arm', dx };
  return { category: 'Limb', dx };
}

function assignNames(
  rootId: number,
  childrenOf: Map<number, number[]>,
  nodeById: Map<number, RawNode>,
  modelPos: Map<number, [number, number, number]>,
): Map<number, string> {
  const names = new Map<number, string>();
  names.set(rootId, 'Root');
  const rootPos = modelPos.get(rootId)!;

  const directChildren = childrenOf.get(rootId) ?? [];
  // Shared across the whole tree (not just root's direct children) so a limb
  // rediscovered deeper down via re-classification (see nameChain) still gets
  // a unique index instead of colliding with one found at the top level.
  const counters = { armCount: 0, legCount: 0, limbCount: 0 };

  for (const childId of directChildren) {
    const { category, dx } = classifyBranch(childId, rootPos, childrenOf, modelPos);
    // Top-level Arm.L / Arm.R / Leg.L / Leg.R naming is a contract the procedural
    // action library (actions.ts) relies on via findByPrefix — keep the L/R suffix
    // at this level even though deeper re-forks (below) use position-relative L/R too.
    const base = labelFor(category, dx, counters);
    nameChain(childId, base, childrenOf, names, modelPos, 1, counters);
  }

  // Any node not yet named (shouldn't normally happen) gets a generic fallback.
  for (const id of nodeById.keys()) if (!names.has(id)) names.set(id, `Bone${id}`);

  // Final safety net: custom_pose targets bones by name, so no two bones may share
  // one even if some earlier heuristic step still produced a collision.
  const seen = new Map<string, number>();
  for (const [id, name] of names) {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    if (count > 1) names.set(id, `${name}#${count}`);
  }

  return names;
}

function labelFor(category: BodyPartCategory, dx: number, counters: { armCount: number; legCount: number; limbCount: number }): string {
  if (category === 'Head') return 'Head';
  if (category === 'Leg') {
    counters.legCount++;
    return `Leg.${dx <= 0 ? 'L' : 'R'}${counters.legCount > 1 ? counters.legCount : ''}`;
  }
  if (category === 'Arm') {
    counters.armCount++;
    return `Arm.${dx <= 0 ? 'L' : 'R'}${counters.armCount > 1 ? counters.armCount : ''}`;
  }
  counters.limbCount++;
  return `Limb${counters.limbCount}`;
}

function categoryOfBase(base: string): BodyPartCategory {
  if (base.startsWith('Head')) return 'Head';
  if (base.startsWith('Leg')) return 'Leg';
  if (base.startsWith('Arm')) return 'Arm';
  return 'Limb';
}

function nameChain(
  id: number,
  base: string,
  childrenOf: Map<number, number[]>,
  names: Map<number, string>,
  modelPos: Map<number, [number, number, number]>,
  depth: number,
  counters: { armCount: number; legCount: number; limbCount: number },
) {
  const label = depth === 1 ? base : `${base}.${depth}`;
  const kids = childrenOf.get(id) ?? [];

  if (kids.length >= 2) {
    // Re-fork: this node is itself a branch point further down the chain (e.g. a hip
    // under a single "legs" branch, or - as found on a real test character - a head
    // with ears/glasses/snout detail hanging off what looked like one long "arm" from
    // the root). Each child is re-classified from *this* fork's own local geometry
    // rather than blindly inheriting the parent's category: a trunk being arm-shaped
    // overall doesn't mean everything branching off it is an arm.
    names.set(id, label);
    const pos = modelPos.get(id)!;
    const inherited = categoryOfBase(base);
    const sideCounts = new Map<string, number>();
    for (const kid of kids) {
      const { category, dx: localDx } = classifyBranch(kid, pos, childrenOf, modelPos);
      if (category !== 'Limb' && category !== inherited) {
        nameChain(kid, labelFor(category, localDx, counters), childrenOf, names, modelPos, 1, counters);
        continue;
      }
      const kidPos = modelPos.get(kid) ?? pos;
      const side = kidPos[0] <= pos[0] ? 'L' : 'R';
      const n = (sideCounts.get(side) ?? 0) + 1;
      sideCounts.set(side, n);
      const sideLabel = n > 1 ? `${side}${n}` : side;
      nameChain(kid, `${base}.${sideLabel}`, childrenOf, names, modelPos, 1, counters);
    }
    return;
  }

  names.set(id, label);
  for (const kid of kids) nameChain(kid, base, childrenOf, names, modelPos, depth + 1, counters);
}

function deepestDescendant(id: number, childrenOf: Map<number, number[]>): number {
  const kids = childrenOf.get(id) ?? [];
  if (kids.length === 0) return id;
  return deepestDescendant(kids[0], childrenOf);
}

/** Max Euclidean distance from `origin` to any node in this subtree - see assignNames. */
function subtreeMaxReach(
  id: number,
  childrenOf: Map<number, number[]>,
  modelPos: Map<number, [number, number, number]>,
  origin: [number, number, number],
): number {
  const p = modelPos.get(id)!;
  let maxDist = Math.hypot(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]);
  for (const kid of childrenOf.get(id) ?? []) {
    maxDist = Math.max(maxDist, subtreeMaxReach(kid, childrenOf, modelPos, origin));
  }
  return maxDist;
}
