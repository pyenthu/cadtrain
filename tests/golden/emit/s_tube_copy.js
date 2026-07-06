  const A = sweep_tube_demo({ rad: 0.6, num_arcs: 12 });
  const C = g_shaft({ r: 0.5, length: 8, segments: 32 });
  const _subtract_obj_1 = A.subtract(C);
  return _subtract_obj_1;