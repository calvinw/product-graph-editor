import dagre from "@dagrejs/dagre"
import { Position, type Edge, type Node } from "@xyflow/react"

const NODE_WIDTH = 190
const NODE_HEIGHT = 36
const NODE_GAP = 140
const RANK_GAP = 230
const BACKGROUND_BRANCH_NODE_GAP = 600
const BACKGROUND_BRANCH_RANK_GAP = 650

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
      sourcePosition: options.orientation === "vertical" ? Position.Top : Position.Right,
      targetPosition: options.orientation === "vertical" ? Position.Bottom : Position.Left,
      position: { x: x - size.width / 2, y: y - size.height / 2 },
    }
  })
}
