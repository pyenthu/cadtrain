# Typed expression outputs — structural inference + dynamic wiring

**Status:** planning (2026-06-29). Crystallized in a live design thread. Supersedes
the "add a `list<point3>` picker option" framing — the picker was fighting the
node-graph philosophy. Pairs with typed-ports (`docs/plans/typed-ports.md`, #13)
and expression-as-builder (`docs/plans/expression-list-builder.md`, #11).

## Philosophy

An expression is a **node that outputs a typed value**. You **wire** that typed
output into any consumer whose input type is compatible. Types are first-class and
wire **dynamically** — the graph knows what can connect to what.

Two audiences, one engine:

- **Users (non-programmers):** never declare a type. They build a value (loop
  builder, point editor, or a pasted literal) and the editor **infers the type
  from the structure**. Zero ceremony. The only feedback they ever see is at the
  **wire**, in plain language ("this needs 3D points like [x, y, z], but row 2 has
  only 2 numbers") — never type jargon.
- **Authors (programmer-style):** may **optionally** annotate an output with an
  explicit type (gradual typing). The annotation becomes a **contract**; the
  inferred structure is checked against it.

Same structural-inference engine powers both. Named types (the Type Definer) are an
**optional reusable/labeled layer** on top — define one only when you want a named,
field-bearing, shareable record (e.g. `Casing{od,id,length}`).

## Core: structural type inference (the keystone)

The expression engine (mathjs) already parses the formula into an AST. Today an
array literal (`ArrayNode`) is **rejected** ("unsupported syntax: ArrayNode"). The
change: **walk the AST and infer a structural descriptor** instead of rejecting.

```
[[0,2,2],[2,0,1]]   → list of (list of number, len 3, consistent) ⇒ list<point3>
[0.5, 1.2]          → list of number, len 2                        ⇒ point2 / list<scalar>
5                   → number                                       ⇒ scalar
map(range(0,N), f(i)=[cos(i),sin(i),0])                            ⇒ list<point3>
```

- **Structural descriptor** (recursive): `{ kind: 'scalar' | 'list' | 'record',
  of?, fields?, arity? }`. Compared **structurally**, not by name.
- **Dynamically defined:** a novel structure yields a fresh inferred type on the
  fly — no pre-definition. Optionally auto-named/registered so it shows up as a
  usable type without the Type Definer.
- Works the same regardless of HOW the list is produced — typed literal, the visual
  loop builder, or a future point-editor card. Inference watches the *output*.

## Real-time checking

- On edit (debounced): parse → infer → show the inferred type as a **badge**
  (`list<point3> ✓`) + inline structural errors in **plain language** ("rows have
  mixed lengths: 3, 2"). Reuses the existing per-output error slot.
- **Kills "unsupported syntax: ArrayNode"** — literals are first-class.

## Typed sockets + dynamic wiring

- The inferred type **colors the output socket** (reuse port-types.ts colors).
- Wiring = **structural compatibility check**. `port-types.ts` `canFeed`/`canWire`
  is already structural for primitive elems ("by elem + card, one→list broadcast");
  extend it to inferred-from-literal descriptors.
- Reject reasons are **human sentences**, not "list<number[2]> ≠ list<point3>".

## Gradual explicit typing (optional)

- An output may carry an **explicit annotation** chosen from the live registry
  (built-in + named types). When present, it's a **contract** — inference is
  validated against it (declare `list<point3>`, produce a 2-coord row → error).
- When absent, inference simply reports what was built.

## Named types — the Type Definer (optional layer)

Today's Type Definer only builds records-with-fields and can't save a list type
(the `pt3DList` workaround fails with "add at least one field"). Make it useful:

- **First-class LIST types** (define `list<pt3D>` directly, not only via a record
  field).
- **Fix the "add at least one field" save bug** (diagnose in `TypeDefinerPanel`).
- **Field type = a dropdown** of known types (built-in + user) instead of free text.
- Names are **labels on structural types** — nominal when you want it, structural by
  default.

## Consumers + emit

- Consumers (`r_sweep.path`, polygon points, `r_surface_grid.grid`) declare their
  **input type**; accept any inferred output that's structurally compatible.
- **Record→array adapter:** `r_sweep.path` wants `[x,y,z]` arrays, so a
  `list<pt3D>` (records `{x,y,z}`) wires through an adapter that projects fields to
  array order. Structural `list<point3>` needs no adapter.
- **Object/record emit:** compile `list<record>` to a JS array of objects.

## Phasing

| Phase | What | Notes |
|---|---|---|
| **A** | Structural inference engine + array-literal support + real-time badge/errors | the keystone; kills ArrayNode error |
| **B** | Typed output sockets + structural wire-checking (plain-language reasons) | builds on port-types canFeed |
| **C** | Gradual explicit annotation (optional contract, checked vs inference) | registry-backed |
| **D** | Type Definer fixes — list types, save bug, field-type dropdown | makes "build types" usable |
| **E** | Consumers declare input types + record emit + record→array adapter | closes the loop end-to-end |

## Stopgap

A built-in `list<point3>` output (prototyped by a subagent) is a **temporary
proof**, not the design — it lets the r_sweep path output work today. Once Phase A
lands, `list<point3>` is just *what inference reports* for `[[x,y,z],…]`, not a
hardcoded picker entry.
