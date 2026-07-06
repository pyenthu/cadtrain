  const _x_n_circle_rad = p.rad;
  const _x_n_circle_num_pts = p.num_arcs;
  const _x_n_circle_pts = (() => { let poly = [];   for (let i = 0; i < (_x_n_circle_num_pts); i++) { poly.push([(_x_n_circle_rad * cos(((tau * i) / _x_n_circle_num_pts))), (_x_n_circle_rad * sin(((tau * i) / _x_n_circle_num_pts))), 0]); } return poly; })();
  const _x_n_sec_spl_path = resampleSpline(_x_n_circle_pts, 32, true);
  const _x_n_path_spl_path = resampleSpline([[-0.021, -0.186, 0.646], [0, 0, 1.522071596816624], [0, 0, 2.498], [0.063, -0.011, 4.456], [0, 0, 7.531]], 32, false);
  const body = r_sweep({ path: _x_n_path_spl_path, section: _x_n_sec_spl_path, closedPath: false, caps: true });
  return body;