/** Re-exports the registered node-kind descriptors (registry.ts imports this).
 *  Phase 0: the 3 leaf kinds. Phase 1+ adds the remaining ~12. */
export { CallKind } from './call';
export { MethodKind } from './method';
export { TxfmnKind } from './txfmn';
export { MaterialKind } from './material';
export { MvKind } from './mv';
export { RotKind } from './rot';
export { SplineKind } from './spline';
export { WarpKind } from './warp';
export { ContainerKind, containerSize } from './container';
export { StackKind } from './stack';
