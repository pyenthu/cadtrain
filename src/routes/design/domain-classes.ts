/**
 * domain-classes.ts — the composition-graph DOMAIN MODEL as a Mermaid class
 * diagram, for the /design "Class model" tab (UmlClassDiagram.svelte).
 *
 * Source of truth: src/lib/cad/composition-graph-types.ts. This is a curated,
 * readability-trimmed transcription (key fields only) — NOT every field — so the
 * diagram stays legible. Refresh when the node union or Graph shape changes.
 *
 * `Graph` is the aggregate root (a bag of nodes + params + edges). `GraphNode`
 * is the 15-way discriminated union every node card is one of. `ArgValue` is the
 * literal|expr|param value every parametric slot holds.
 */
export const DOMAIN_CLASS_DIAGRAM = `classDiagram
  direction LR

  class Graph {
    <<aggregate root>>
    +Map~GraphNode~ nodes
    +NodeId root
    +Map~ParamSchema~ params
    +Edge[] edges
    +string[] imports
    +Map~LayoutXY~ layout
    +Viewport viewport
    +PartAppearance appearance
  }

  class GraphNode {
    <<union>>
    +NodeId id
    +string type
  }

  class ArgValue {
    <<union>>
    +literal | expr | param kind
  }
  class Literal { +number|string|bool value }
  class Expr { +string expr }
  class Param { +string param }
  ArgValue <|-- Literal
  ArgValue <|-- Expr
  ArgValue <|-- Param

  class ParamSchema { +number default; +number step }
  class Edge { +NodeId from; +string key; +string param }
  class LayoutXY { +number x; +number y }

  class CallNode { +string src; +string alias; +Map~ArgValue~ args }
  class ContainerNode { +list|stack|group type; +NodeId[] children; +Map childCounts }
  class MethodNode { +CsgOp op; +NodeId obj; +NodeId arg }
  class MvNode { +NodeId child; +ArgValue[3] offset }
  class RotNode { +NodeId child; +ArgValue[3] rot }
  class TxfmnNode { +NodeId child; +ArgValue[3] rot; +ArgValue[3] offset }
  class RepeatNode { +NodeId[] children; +ArgValue count; +RepeatOp op; +string loopVar }
  class PolygonNode { +PolygonEntry[] points }
  class PolyRepeatNode { +ArgValue count; +ArgValue r; +ArgValue z; +string loopVar }
  class SketchNode { +SketchOpEntry[] ops; +ArgValue segments }
  class SketchRepeatNode { +ArgValue count; +string loopVar }
  class ExprNode { +NodeId defId; +Map~ArgValue~ bindings }
  class SplineNode { +number[3][] points; +ArgValue samples; +bool closed }
  class WarpNode { +NodeId child; +ArgValue path; +ArgValue refine }
  class MaterialNode { +string material; +string colorOuter; +number opacity }

  GraphNode <|-- CallNode
  GraphNode <|-- ContainerNode
  GraphNode <|-- MethodNode
  GraphNode <|-- MvNode
  GraphNode <|-- RotNode
  GraphNode <|-- TxfmnNode
  GraphNode <|-- RepeatNode
  GraphNode <|-- PolygonNode
  GraphNode <|-- PolyRepeatNode
  GraphNode <|-- SketchNode
  GraphNode <|-- SketchRepeatNode
  GraphNode <|-- ExprNode
  GraphNode <|-- SplineNode
  GraphNode <|-- WarpNode
  GraphNode <|-- MaterialNode

  Graph "1" o-- "*" GraphNode : nodes
  Graph "1" o-- "*" ParamSchema : params
  Graph "1" o-- "*" Edge : edges
  CallNode ..> ArgValue : args
  MethodNode ..> GraphNode : obj/arg
  ContainerNode ..> GraphNode : children
  WarpNode ..> GraphNode : child
`;
