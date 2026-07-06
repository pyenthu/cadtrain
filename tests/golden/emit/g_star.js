  const _poly_1 = [...Array.from({ length: p.points * 2 }, (_, i) => { const NPts = p.points * 2; const R_outer = p.r_outer; const R_inner = p.r_inner; const R = i % 2 === 0 ? R_outer : R_inner; const theta = i * tau / NPts; return [R * cos(theta), R * sin(theta)]; })];
  const A = r_weld_extrude({ profile: _poly_1, length: p.length, divs: 24, twist: 45, taper: 0.2, segments: 32 });
  return A;