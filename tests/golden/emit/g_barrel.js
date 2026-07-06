  const _x_n_0wnqsp_p1 = p.segments;
  const _x_n_0wnqsp_out1 = _x_n_0wnqsp_p1/22;
  const _poly_1 = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const A = r_loft({ profile: _poly_1, length: p.length, divs: 48, twist: p.twist, bulge: p.bulge, shape: 'barrel', segments: p.segments });
  return A;