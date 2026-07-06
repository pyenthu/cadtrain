  const _sketch_1 = sketch([{ op: 'line', r: 0, z: 0 }, { op: 'line', r: 2, z: 0 }, { op: 'line', r: 2, z: 30 }, { op: 'line', r: 0, z: 30 }], 64);
  const DEV = r_revolve({ profile: _sketch_1, segments: 64, zSegments: 0, axisPath: [[0,0,0],[0,0,12],[3,0,22],[9,0,30]] });
  return DEV;