/**
 * domain-classes.ts — the composition-graph DOMAIN MODEL as a Mermaid class
 * diagram, for the /design "Class model" tab (UmlClassDiagram.svelte).
 *
 * Source of truth: src/lib/cad/composition-graph-types.ts. This is a curated,
 * readability-trimmed transcription (key fields only) — NOT every field — so the
 * diagram stays legible. Refresh when the node union or Graph shape changes.
 *
 * The 15 GraphNode variants are grouped into Mermaid NAMESPACES by modular role
 * (core model · solid producers · 2D/profile producers · transforms · containers
 * · appearance) so the diagram reads as modular boxes, not one flat inheritance
 * fan. `Graph` is the aggregate root; `ArgValue` is the value every slot holds.
 */
export const DOMAIN_CLASS_DIAGRAM = `classDiagram
  direction TB

  namespace CoreModel {
    class Graph {
      <<aggregate root>>
      +Map~GraphNode~ nodes
      +NodeId root
      +Map~ParamSchema~ params
      +Edge[] edges
      +string[] imports
      +Map~LayoutXY~ layout
      +PartAppearance appearance
    }
    class GraphNode {
      <<union base>>
      +NodeId id
      +string type
    }
    class ArgValue {
      <<value union>>
      +literal|expr|param kind
    }
    class Literal { +number|string|bool value }
    class Expr { +string expr }
    class Param { +string param }
    class ParamSchema { +number default; +number step }
    class Edge { +NodeId from; +string key; +string param }
    class LayoutXY { +number x; +number y }
  }

  namespace SolidProducers {
    class CallNode { +string src; +string alias; +Map~ArgValue~ args }
    class MethodNode { +CsgOp op; +NodeId obj; +NodeId arg }
  }

  namespace ProfileProducers {
    class PolygonNode { +PolygonEntry[] points }
    class PolyRepeatNode { +ArgValue count; +ArgValue r; +ArgValue z; +string loopVar }
    class SketchNode { +SketchOpEntry[] ops; +ArgValue segments }
    class SketchRepeatNode { +ArgValue count; +string loopVar }
    class SplineNode { +number[3][] points; +ArgValue samples; +bool closed }
    class ExprNode { +NodeId defId; +Map~ArgValue~ bindings }
  }

  namespace Transforms {
    class MvNode { +NodeId child; +ArgValue[3] offset }
    class RotNode { +NodeId child; +ArgValue[3] rot }
    class TxfmnNode { +NodeId child; +ArgValue[3] rot; +ArgValue[3] offset }
    class WarpNode { +NodeId child; +ArgValue path; +ArgValue refine }
  }

  namespace Containers {
    class ContainerNode { +list|stack|group type; +NodeId[] children; +Map childCounts }
    class RepeatNode { +NodeId[] children; +ArgValue count; +RepeatOp op; +string loopVar }
  }

  namespace Appearance {
    class MaterialNode { +string material; +string colorOuter; +number opacity }
  }

  ArgValue <|-- Literal
  ArgValue <|-- Expr
  ArgValue <|-- Param

  GraphNode <|-- CallNode
  GraphNode <|-- MethodNode
  GraphNode <|-- PolygonNode
  GraphNode <|-- PolyRepeatNode
  GraphNode <|-- SketchNode
  GraphNode <|-- SketchRepeatNode
  GraphNode <|-- SplineNode
  GraphNode <|-- ExprNode
  GraphNode <|-- MvNode
  GraphNode <|-- RotNode
  GraphNode <|-- TxfmnNode
  GraphNode <|-- WarpNode
  GraphNode <|-- ContainerNode
  GraphNode <|-- RepeatNode
  GraphNode <|-- MaterialNode

  Graph "1" o-- "*" GraphNode : nodes
  Graph "1" o-- "*" ParamSchema : params
  Graph "1" o-- "*" Edge : edges
  CallNode ..> ArgValue : args
  MethodNode ..> GraphNode : obj/arg
  ContainerNode ..> GraphNode : children
  WarpNode ..> GraphNode : child
`;
