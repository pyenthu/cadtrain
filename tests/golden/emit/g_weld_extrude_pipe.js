  const _poly_1 = [...Array.from({ length: p.arcs }, (_, i) => { const NPts = p.arcs; return [cos(i*2*PI/NPts), sin(i*2*PI/NPts)]; })];
  const A = r_weld_extrude({ profile: _poly_1, length: 2, divs: 12, twist: 0, taper: 0, segments: p.segments });
  const _rot_obj_1 = rot(A, [0, 0, 0]);
  return _rot_obj_1;