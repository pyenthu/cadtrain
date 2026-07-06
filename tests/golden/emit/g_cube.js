  const _sketch_1 = sketch([{ op: 'line', r: p.size/2, z: p.size/2 }, { op: 'line', r: -p.size/2, z: p.size/2 }, { op: 'line', r: -p.size/2, z: -p.size/2 }, { op: 'line', r: p.size/2, z: -p.size/2 }], 64);
  const B = r_weld_extrude({ profile: _sketch_1, length: p.size, divs: 12, twist: 0, taper: 0, segments: 32 });
  return B;