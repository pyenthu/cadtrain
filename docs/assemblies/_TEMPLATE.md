# <assembly_id> — <Real-World Name>

## What this represents

One paragraph: what the real-world assembly is, where it sits
in the wellbore / completion / surface stack, what it does
functionally. Include vendor terminology if there are recognised
trade names.

## Stack (Z-down)

ASCII diagram showing the parts top-to-bottom (top = lower z).
Mark approximate z extents per part. Example:

```
z = 0.00     ┌─ Top flange (smaller OD, tree side)
             │  tubing_hanger_spool · flange section
z = 1.50     ├─ Neck (body)
             │  tubing_hanger_spool · body section
z = 9.25     ├─ Bottom flange (larger OD, casing-head side)
             │  tubing_hanger_spool · bottom flange + prep counterbore
z = 12.00    └─ (bottom of spool)

            (BPV / tubing hanger lands inside the bottom-prep
             counterbore — modelled separately via tubing_hanger_coupling)
```

## Primitives used

| Primitive | Purpose in this assembly |
|---|---|
| `<runes-id>` | one-line what-it-models in this context |

## Starter `AuthoredComponent` spec

```jsonc
{
  "id": "<assembly_id>",
  "name": "<display name>",
  "description": "<one-line>",
  "tags": ["…"],
  "version": 1,
  "source": "manual",
  "parts": [
    {
      "id": "<part-handle>",
      "kind": "primitive",
      "prim": "<runes-id>",
      "params": { /* sliders to override per this row */ },
      "transform": { "tz": 0 }
    }
    // … more parts
  ],
  "ops": []
}
```

## Variations

Table of common-size / pressure-class variants and which catalog
row each one binds to.

| Variant | KB row | Key params overridden |
|---|---|---|
| Default | `<row id>` | (matches the spec above) |
| … | … | … |

## References

- `static/kb/<path>.json` — catalog row(s) feeding param defaults
- `docs/PRIMITIVE_TEMPLATE.md` — per-primitive `.md` template
- Vendor / spec URL — (accessed YYYY-MM-DD)

## Open questions / TODOs

Things the assembly doesn't model yet that would make it more accurate.
Don't hide these in conversation; surface so the next session sees them.
