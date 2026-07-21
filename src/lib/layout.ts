import dagre from "@dagrejs/dagre"
import { Position, type Edge, type Node } from "@xyflow/react"

const NODE_WIDTH = 190
const NODE_HEIGHT = 36
const NODE_GAP = 96
const RANK_GAP = 180
const BACKGROUND_BRANCH_NODE_GAP = 150
const BACKGROUND_BRANCH_RANK_GAP = 220

export function layoutNodes<T extends Record<string, unknown>>(
  nodes: Node<T>[],
  edges: Edge[],
): Node<T>[] {
  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  const hasBackgroundBranches = nodes.filter((node) => node.data.scope === "background").length > 1
  graph.setGraph({
    rankdir: "LR",
    nodesep: hasBackgroundBranches ? BACKGROUND_BRANCH_NODE_GAP : NODE_GAP,
    ranksep: hasBackgroundBranches ? BACKGROUND_BRANCH_RANK_GAP : RANK_GAP,
    marginx: 32,
    marginy: 32,
    ranker: "network-simplex",
    acyclicer: "greedy",
  })

  const dimensions = new Map(nodes.map((node) => [node.id, {
    width: Math.max(node.measured?.width ?? NODE_WIDTH, NODE_WIDTH),
    height: Math.max(node.measured?.height ?? NODE_HEIGHT, NODE_HEIGHT),
  }]))
  nodes.forEach((node) => graph.setNode(node.id, dimensions.get(node.id)))
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target, { weight: 2 }))

  dagre.layout(graph)

  return nodes.map((node) => {
    const { x, y } = graph.node(node.id)
    const size = dimensions.get(node.id)!
    return {
      ...node,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      position: { x: x - size.width / 2, y: y - size.height / 2 },
    }
  })
}
