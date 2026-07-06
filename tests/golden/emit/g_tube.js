  const A = g_shaft({ r: p.od / 2, length: p.length, segments: p.segments });
  const B = g_shaft({ r: p.od/2 - p.wall, length: p.length, segments: p.segments });
  const _subtract_obj_1 = A.subtract(B);
  return _subtract_obj_1;