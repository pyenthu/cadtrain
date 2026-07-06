  const A = sweep_tube_demo({ rad: 0.6, num_arcs: 24 });
  const B = sweep_tube_demo({ rad: 0.4, num_arcs: 24 });
  const _subtract_obj_1 = A.subtract(B);
  return _subtract_obj_1;