  const _sketch_1 = sketch([{ op: 'line', r: 0, z: 0 }, { op: 'line', r: p.r, z: 0 }, { op: 'line', r: p.r, z: p.length }, { op: 'line', r: 0, z: p.length }], 64);
  const A = r_revolve({ profile: _sketch_1, segments: p.segments, zSegments: 0, axisPath: 0 });
  return A;