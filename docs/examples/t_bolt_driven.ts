export const meta = {
  id: 't_bolt_driven', name: 't_bolt_driven',
  description: 'Param-driven bolt (Option A demo): round shaft (r_cylinder) + hex head (r_extrude). The composite params drive the leaves; the head sits on the shaft top via a cross-param offset. Open the Parts tab and drag a slider — the resolved args re-link live.',
  tags: ['test','csg','composite','driven'],
  uses: ['r_cylinder','r_extrude'],
  params: {
    shaft_od:   { label:'shaft OD',   min:0.5, max:4, step:0.1, default:1.6 },
    shaft_len:  { label:'shaft len',  min:1,   max:8, step:0.1, default:4.5 },
    head_thick: { label:'head thick', min:0.4, max:3, step:0.1, default:1.3 },
  },
  material: { outer:{color:'#6f8a7d',metallic:0.6,roughness:0.4}, inner:{color:'#3a3a3a',metallic:0.1,roughness:0.9} },
};
export function t_bolt_driven(shaft_od: number, shaft_len: number, head_thick: number) {
  const shaft = r_cylinder(shaft_od, shaft_len, 64);
  const head  = mv(r_extrude([[1.6,0],[0.8,1.3856],[-0.8,1.3856],[-1.6,0],[-0.8,-1.3856],[0.8,-1.3856]], head_thick), [0, 0, -(shaft_len / 2) - head_thick]);
  return shaft.add(head);
}
