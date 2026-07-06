  const C = g_shaft({ r: p.od/2- p.wall, length: 5, segments: 32 });
  const A = g_shaft({ r: p.od/2, length: 5, segments: 32 });
  const _subtract_obj_1 = A.subtract(C);
  return _subtract_obj_1;