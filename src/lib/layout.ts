import dagre from "@dagrejs/dagre"
import { Position, type Edge, type Node } from "@xyflow/react"

const NODE_WIDTH = 190
const NODE_HEIGHT = 36
const NODE_GAP = 340
// Ranksep is the gap along the edge direction, where edge labels sit -- it
// needs enough room that a label never crowds the nodes on either side.
const RANK_GAP = 640
const BACKGROUND_BRANCH_NODE_GAP = 460
const BACKGROUND_BRANCH_RANK_GAP = 700
// Extra clearance kept between any two nodes' boxes once positioned, on top
// of their real measured size, so labels and connecting arrows stay legible.
const OVERLAP_PADDING = 40

export function measuredDimensions<T extends Record<string, unknown>>(
  nodes: Node<T>[],
): Map<string, { width: number; height: number }> {
  return new Map(nodes.map((node) => [node.id, {
    width: Math.max(node.measured?.width ?? NODE_WIDTH, NODE_WIDTH),
    height: Math.max(node.measured?.height ?? NODE_HEIGHT, NODE_HEIGHT),
  }]))
}

/**
 * Nudges any two overlapping nodes apart along whichever axis needs the
 * smaller push, so a node that ends up on top of another (a fresh label
 * measured wider than guessed, or a manually placed background-branch node)
 * lands in nearby clear space instead of hiding another node or its arrows.
 * Dagre already tries to avoid this given accurate sizes; this is the
 * safety net for the cases it does not cover -- a few passes over all pairs
 * is plenty since graphs here run to dozens of nodes, not thousands.
 */
export function resolveNodeOverlaps<T extends Record<string, unknown>>(
  nodes: Node<T>[],
  dimensions: Map<string, { width: number; height: number }> = measuredDimensions(nodes),
): Node<T>[] {
  const positions = new Map(nodes.map((node) => [node.id, { ...node.position }]))
  const visible = nodes.filter((node) => !node.hidden)

  for (let pass = 0; pass < 8; pass += 1) {
    let moved = false
    for (let i = 0; i < visible.length; i += 1) {
      for (let j = i + 1; j < visible.length; j += 1) {
        const a = visible[i]
        const b = visible[j]
        const aSize = dimensions.get(a.id) ?? { width: NODE_WIDTH, height: NODE_HEIGHT }
        const bSize = dimensions.get(b.id) ?? { width: NODE_WIDTH, height: NODE_HEIGHT }
        const aPos = positions.get(a.id)!
        const bPos = positions.get(b.id)!
        const aLeft = aPos.x - OVERLAP_PADDING / 2
        const aTop = aPos.y - OVERLAP_PADDING / 2
        const aWidth = aSize.width + OVERLAP_PADDING
        const aHeight = aSize.height + OVERLAP_PADDING
        const bLeft = bPos.x - OVERLAP_PADDING / 2
        const bTop = bPos.y - OVERLAP_PADDING / 2
        const bWidth = bSize.width + OVERLAP_PADDING
        const bHeight = bSize.height + OVERLAP_PADDING

        const overlapX = Math.min(aLeft + aWidth, bLeft + bWidth) - Math.max(aLeft, bLeft)
        const overlapY = Math.min(aTop + aHeight, bTop + bHeight) - Math.max(aTop, bTop)
        if (overlapX <= 0 || overlapY <= 0) continue

        moved = true
        if (overlapX < overlapY) {
          const push = overlapX / 2 + 1
          const aFirst = aLeft <= bLeft
          positions.set(a.id, { ...aPos, x: aPos.x + (aFirst ? -push : push) })
          positions.set(b.id, { ...bPos, x: bPos.x + (aFirst ? push : -push) })
        } else {
          const push = overlapY / 2 + 1
          const aFirst = aTop <= bTop
          positions.set(a.id, { ...aPos, y: aPos.y + (aFirst ? -push : push) })
          positions.set(b.id, { ...bPos, y: bPos.y + (aFirst ? push : -push) })
        }
      }
    }
    if (!moved) break
  }

  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }))
}

export function layoutNodes<T extends Record<string, unknown>>(
  nodes: Node<T>[],
  edges: Edge[],
  options: { orientation?: "vertical" | "horizontal" } = {},
): Node<T>[] {
  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  const hasBackgroundBranches = nodes.filter((node) => node.data.scope === "background").length > 1
  graph.setGraph({
    rankdir: options.orientation === "vertical" ? "BT" : "LR",
    nodesep: hasBackgroundBranches ? BACKGROUND_BRANCH_NODE_GAP : NODE_GAP,
    ranksep: hasBackgroundBranches ? BACKGROUND_BRANCH_RANK_GAP : RANK_GAP,
    marginx: 32,
    marginy: 32,
    ranker: "network-simplex",
    acyclicer: "greedy",
  })

  // Dagre's crossing-minimization has ties it breaks by insertion order, so
  // feeding it nodes/edges in a canonical order every time keeps the layout
  // stable across renders -- otherwise the same graph can flip a loosely
  // connected node (e.g. one background input with a single edge) to the
  // opposite side of its rank depending only on incidental array order
  // upstream, which looks like the layout "randomly" changing. Ordering by
  // ascending degree (fewest connections first) additionally tends to let
  // lightly connected nodes settle toward the outer edge of their rank
  // instead of crowding the busier, more-connected nodes' side.
  const dimensions = measuredDimensions(nodes)
  const degree = new Map<string, number>()
  edges.forEach((edge) => {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  })
  const orderedNodes = [...nodes].sort((a, b) => (
    (degree.get(a.id) ?? 0) - (degree.get(b.id) ?? 0) || a.id.localeCompare(b.id)
  ))
  const orderedEdges = [...edges].sort((a, b) => (
    a.source === b.source ? a.target.localeCompare(b.target) : a.source.localeCompare(b.source)
  ))
  orderedNodes.forEach((node) => graph.setNode(node.id, dimensions.get(node.id)))
  orderedEdges.forEach((edge) => graph.setEdge(edge.source, edge.target, { weight: 2 }))

  dagre.layout(graph)

  const positioned = nodes.map((node) => {
    const { x, y } = graph.node(node.id)
    const size = dimensions.get(node.id)!
    return {
      ...node,
      sourcePosition: options.orientation === "vertical" ? Position.Top : Position.Right,
      targetPosition: options.orientation === "vertical" ? Position.Bottom : Position.Left,
      position: { x: x - size.width / 2, y: y - size.height / 2 },
    }
  })

  return resolveNodeOverlaps(positioned, dimensions)
}
