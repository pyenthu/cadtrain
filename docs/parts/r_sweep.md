# r_sweep (engine)

> Option 3 general sweep — extrude a fixed 2D cross-section along an arbitrary
> 3D path → ONE welded solid (manifold by construction, no CSG). Stdlib engine
> `src/lib/graph/stdlib/r_sweep.ts`. Signature `r_sweep(path, section, closedPath, caps)`;
> wraps `sweepAlongPath` (manifold-mesh.ts), routing `sweepAlongPath → loftStations → weldAndBuild`
> (the welded-mesh toolkit). Empty `meta.params` (path/section are DATA arrays, not GUI dials).
> Caveat: the per-station fixed-up frame is torsion-free for gentle/planar-ish paths; tight inner
> turns or paths that double back along `up` can twist/self-intersect (Option 3 ceiling,
> `docs/plans/sweep-thread-engine.md`). Demo part: [`sweep_demo`](sweep_demo.md).
