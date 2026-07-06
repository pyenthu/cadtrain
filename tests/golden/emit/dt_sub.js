  const A = g_dp_box({ wall: 0.5, collar_od: 6, fillet_bot: 0.5, od_body: 4.5, length_body: 1.5, length_collar: 4, collar_upset: 0.4, length_thd: 3 });
  const B = g_dp_pin({ collar_od: 6, od_body: p.od, wall: 0.5, length_collar: 4, length_body: 1.5, length_thd: 3, fillet_bot: 0.5, fileld_top: 0.45, upset_collar: 0.4, segments: 32 });
  const _stack_1 = stack([A, B]);
  return _stack_1;