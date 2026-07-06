  const _x_n_sp_path = resampleSpline([[0, 0, 0], [0, 0, 12], [3, 0, 22], [9, 0, 30]], 32, false);
  const _sketch_1 = sketch([{ op: 'line', r: 0, z: 0 }, { op: 'line', r: 2, z: 0 }, { op: 'line', r: 2, z: 30 }, { op: 'line', r: 0, z: 30 }], 64);
  const REV = r_revolve({ profile: _sketch_1, segments: 64, zSegments: 40 });
  const _warp_obj_1 = warpSpline(REV, _x_n_sp_path);
  return _warp_obj_1;