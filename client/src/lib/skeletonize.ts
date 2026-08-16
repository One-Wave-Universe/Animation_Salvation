/**
 * Turns a binary silhouette mask into a topological bone graph:
 *  1. Zhang-Suen thinning -> 1px skeleton
 *  2. Neighbor-degree graph extraction (endpoints, junctions, path pixels)
 *  3. Junction-pixel clustering (a real branch point often thins to a small
 *     clump rather than one pixel)
 *  4. Path tracing + simplification between graph nodes
 */

export interface SkeletonNode {
  id: number;
  px: number;
  py: number;
  /** True topological degree at extraction time (before tree conversion). */
  degree: number;
}

export interface SkeletonEdge {
  a: number; // node id
  b: number; // node id
  /** Simplified intermediate pixel points along the path, a -> b, excluding endpoints. */
  polyline: [number, number][];
}

export interface SkeletonGraph {
  nodes: SkeletonNode[];
  edges: SkeletonEdge[];
}

export function skeletonize(mask: Uint8Array, width: number, height: number): SkeletonGraph {
  const thin = zhangSuenThin(mask, width, height);
  const graph = extractGraph(thin, width, height);
  // Antialiased/soft-edged source art thins to a skeleton with spurious short
  // side-branches (every small silhouette bump becomes a tiny branch). Prune only
  // genuinely tiny ones (by actual branch length) so real short appendages — hands,
  // feet, a short neck — survive; a uniform raster-level erosion would eat those too.
  const minLeafLength = Math.max(6, Math.round(Math.min(width, height) * 0.015));
  return pruneNoise(graph, minLeafLength);
}

/**
 * Cleans up two kinds of thinning noise below minLength: dead-end spurs (a leaf
 * whose connecting branch is tiny) and doubled junctions (two branch/endpoint nodes
 * sitting right next to each other, connected by a near-zero-length edge — a common
 * artifact where a real joint thins to a small clump that the earlier clustering
 * pass didn't fully merge). Both are handled in one loop since collapsing a doubled
 * junction can itself expose a new short spur, and vice versa.
 */
function pruneNoise(graph: SkeletonGraph, minLength: number): SkeletonGraph {
  let nodes = graph.nodes;
  let edges = graph.edges;

  for (let pass = 0; pass < 6; pass++) {
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const degree = new Map<number, number>();
    for (const e of edges) {
      degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
      degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
    }
    // Real geometric (pixel) length, not simplified point count — Douglas-Peucker
    // collapses a perfectly straight limb down to zero intermediate points, which
    // would otherwise make long straight limbs look exactly like tiny noise spurs.
    const edgeLength = (e: SkeletonEdge) => {
      const a = nodeById.get(e.a);
      const b = nodeById.get(e.b);
      if (!a || !b) return Infinity;
      const pts: [number, number][] = [[a.px, a.py], ...e.polyline, [b.px, b.py]];
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      return len;
    };

    const leavesToRemove = new Set<number>();
    for (const e of edges) {
      if (edgeLength(e) >= minLength) continue;
      const aLeaf = (degree.get(e.a) ?? 0) <= 1;
      const bLeaf = (degree.get(e.b) ?? 0) <= 1;
      if (aLeaf && !bLeaf) leavesToRemove.add(e.a);
      else if (bLeaf && !aLeaf) leavesToRemove.add(e.b);
      // If both ends look like leaves, this is an isolated short fragment; leave it
      // for a later pass once its neighborhood has been simplified.
    }
    if (leavesToRemove.size > 0) {
      edges = edges.filter((e) => !leavesToRemove.has(e.a) && !leavesToRemove.has(e.b));
      nodes = nodes.filter((n) => !leavesToRemove.has(n.id));
      continue;
    }

    // No spurs left to trim — look for a short edge joining two branch points
    // (degree >= 3 each) and merge them into one node at their midpoint.
    const shortBranchEdge = edges.find(
      (e) => edgeLength(e) < minLength && (degree.get(e.a) ?? 0) >= 3 && (degree.get(e.b) ?? 0) >= 3,
    );
    if (!shortBranchEdge) break;

    const a = nodeById.get(shortBranchEdge.a)!;
    const b = nodeById.get(shortBranchEdge.b)!;
    const merged: SkeletonNode = { id: a.id, px: Math.round((a.px + b.px) / 2), py: Math.round((a.py + b.py) / 2), degree: a.degree };
    nodes = nodes.filter((n) => n.id !== a.id && n.id !== b.id).concat(merged);
    edges = edges
      .filter((e) => e !== shortBranchEdge)
      .map((e) => ({ ...e, a: e.a === b.id ? a.id : e.a, b: e.b === b.id ? a.id : e.b }))
      .filter((e) => e.a !== e.b); // drop any edge that became a self-loop from the merge
  }

  return { nodes, edges };
}

function idx(x: number, y: number, w: number) {
  return y * w + x;
}

// Zhang-Suen's A/B conditions are directionally specific (P2=N, P3=NE, P4=E, ...
// clockwise), so this order matters for zhangSuenThin — it is not just "the 8
// neighbors" for the degree/adjacency uses elsewhere in this file, which are
// order-independent.
const N8: [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

function zhangSuenThin(mask: Uint8Array, width: number, height: number): Uint8Array {
  const img = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) img[i] = mask[i] > 0 ? 1 : 0;

  const get = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : img[idx(x, y, width)]);

  let changed = true;
  let guard = 0;
  while (changed && guard++ < 200) {
    changed = false;
    for (const step of [0, 1]) {
      const toRemove: number[] = [];
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          if (!get(x, y)) continue;
          const p = N8.map(([dx, dy]) => get(x + dx, y + dy));
          const [p2, , p4, , p6, , p8] = p;
          const B = p.reduce((a, b) => a + b, 0);
          if (B < 2 || B > 6) continue;
          let A = 0;
          for (let k = 0; k < 8; k++) if (p[k] === 0 && p[(k + 1) % 8] === 1) A++;
          if (A !== 1) continue;
          if (step === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }
          toRemove.push(idx(x, y, width));
        }
      }
      if (toRemove.length) {
        changed = true;
        for (const i of toRemove) img[i] = 0;
      }
    }
  }
  return img;
}

function extractGraph(thin: Uint8Array, width: number, height: number): SkeletonGraph {
  const get = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : thin[idx(x, y, width)]);
  const degreeAt = (x: number, y: number) => N8.reduce((acc, [dx, dy]) => acc + get(x + dx, y + dy), 0);

  const skelPixels: [number, number][] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) if (get(x, y)) skelPixels.push([x, y]);

  if (skelPixels.length === 0) return { nodes: [], edges: [] };

  const isSpecial = (x: number, y: number) => {
    const d = degreeAt(x, y);
    return d === 1 || d >= 3;
  };

  // Cluster adjacent "special" pixels (junction clumps) into single nodes.
  const visited = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;
  const nodes: SkeletonNode[] = [];
  const pixelToNode = new Map<string, number>();

  for (const [sx, sy] of skelPixels) {
    if (!isSpecial(sx, sy) || visited.has(key(sx, sy))) continue;
    const clump: [number, number][] = [];
    const stack = [[sx, sy]];
    visited.add(key(sx, sy));
    while (stack.length) {
      const [x, y] = stack.pop()!;
      clump.push([x, y]);
      for (const [dx, dy] of N8) {
        const nx = x + dx;
        const ny = y + dy;
        if (get(nx, ny) && isSpecial(nx, ny) && !visited.has(key(nx, ny))) {
          visited.add(key(nx, ny));
          stack.push([nx, ny]);
        }
      }
    }
    const cx = Math.round(clump.reduce((a, [x]) => a + x, 0) / clump.length);
    const cy = Math.round(clump.reduce((a, [, y]) => a + y, 0) / clump.length);
    const maxDeg = Math.max(...clump.map(([x, y]) => degreeAt(x, y)));
    const nodeId = nodes.length;
    nodes.push({ id: nodeId, px: cx, py: cy, degree: maxDeg >= 3 ? Math.max(3, clump.length >= 2 ? 3 : maxDeg) : 1 });
    for (const [x, y] of clump) pixelToNode.set(key(x, y), nodeId);
  }

  // Trace degree-2 paths between node-clump pixels.
  const edgeVisited = new Set<string>();
  const edges: SkeletonEdge[] = [];

  const clumpPixelSet = new Set(pixelToNode.keys());

  for (const [sx, sy] of skelPixels) {
    if (!clumpPixelSet.has(key(sx, sy))) continue;
    const startNode = pixelToNode.get(key(sx, sy))!;
    for (const [dx, dy] of N8) {
      const nx = sx + dx;
      const ny = sy + dy;
      if (!get(nx, ny)) continue;
      if (clumpPixelSet.has(key(nx, ny))) {
        // Direct adjacency between two node clumps.
        const endNode = pixelToNode.get(key(nx, ny))!;
        if (endNode === startNode) continue;
        const eKey = [startNode, endNode].sort().join('-') + `@${sx},${sy}`;
        if (edgeVisited.has(eKey)) continue;
        edgeVisited.add(eKey);
        edges.push({ a: startNode, b: endNode, polyline: [] });
        continue;
      }
      // Walk a degree-2 chain starting at (nx,ny) until hitting another clump pixel.
      const startEdgeKey = `${sx},${sy}->${nx},${ny}`;
      if (edgeVisited.has(startEdgeKey)) continue;

      const path: [number, number][] = [[nx, ny]];
      let prev: [number, number] = [sx, sy];
      let cur: [number, number] = [nx, ny];
      edgeVisited.add(startEdgeKey);
      let safety = 0;
      while (!clumpPixelSet.has(key(cur[0], cur[1])) && safety++ < width * height) {
        let next: [number, number] | null = null;
        for (const [ddx, ddy] of N8) {
          const cx2 = cur[0] + ddx;
          const cy2 = cur[1] + ddy;
          if (!get(cx2, cy2)) continue;
          if (cx2 === prev[0] && cy2 === prev[1]) continue;
          next = [cx2, cy2];
          break;
        }
        if (!next) break;
        prev = cur;
        cur = next;
        path.push(cur);
      }
      if (!clumpPixelSet.has(key(cur[0], cur[1]))) continue; // dead end / dangling, skip
      const endNode = pixelToNode.get(key(cur[0], cur[1]))!;
      if (endNode === startNode && path.length < 3) continue;
      path.pop(); // remove the terminal clump pixel; edge stores only in-between points
      // Epsilon of a few pixels absorbs single-pixel thinning/closing wiggle along
      // what should read as a straight limb segment, without flattening genuine bends.
      edges.push({ a: startNode, b: endNode, polyline: simplifyPolyline(path, 4) });
    }
  }

  return { nodes, edges };
}

function simplifyPolyline(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length <= 2) return points;
  const dp = douglasPeucker(points, epsilon);
  // Cap intermediate joints so long limbs don't produce excessive bone counts.
  const MAX_INTERMEDIATE = 3;
  if (dp.length <= MAX_INTERMEDIATE + 2) return dp.slice(1, -1);
  const step = (dp.length - 1) / (MAX_INTERMEDIATE + 1);
  const reduced: [number, number][] = [];
  for (let i = 1; i <= MAX_INTERMEDIATE; i++) reduced.push(dp[Math.round(i * step)]);
  return reduced;
}

function douglasPeucker(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length < 3) return points;
  let maxDist = -1;
  let maxIdx = 0;
  const [x1, y1] = points[0];
  const [x2, y2] = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointLineDistance(points[i], [x1, y1], [x2, y2]);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[points.length - 1]];
}

function pointLineDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}
