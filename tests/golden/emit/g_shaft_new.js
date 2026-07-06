  const _sketch_1 = sketch([{ op: 'line', r: 0.5, z: 0 }, { op: 'line', r: 0.5, z: 2 }, { op: 'line', r: 1.5, z: 2 }, { op: 'line', r: 1.5, z: 0 }], 64);
  const A = r_revolve({ profile: _sketch_1, segments: 48 });
  return A;