  const _poly_1 = [[p.id / 2, 0], [p.od / 2, 0], [p.od / 2, p.length - p.chamfer], [p.od / 2 - p.chamfer, p.length], [p.id / 2, p.length]];
  const A = r_revolve({ profile: _poly_1, segments: 32 });
  return A;