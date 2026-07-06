  const _x_n_nrx5le_p1 = 0;
  const _x_n_nrx5le_pts = (() => { let poly = [];  poly.push([(-1), 0, 0]); poly.push([1, 0, 4.5]); poly.push([4, 3, 1]);  return poly; })();
  const _x_n_cucjqo_path = resampleSpline([[0, 0, 0], [0.539, 0.679, 4.295], [0.974, 0.582, 8.688], [0.494, 2.272, 13.617]], 16, false);
  const _x_n_69nj2h_path = resampleSpline([[-1.692, -0.25, 0], [-0.338, -3.167, 0], [4.272, -1.179, 0], [0.228, 1.054, 0]], 16, true);
  const A = r_sweep({ path: _x_n_cucjqo_path, section: _x_n_69nj2h_path, closedPath: false, caps: true });
  return A;