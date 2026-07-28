export const meta = {
  id: 'w_well_native',
  name: 'w_well_native',
  kind: 'asm',
  uses: [
    'bw_casing',
    'bw_cement',
    'bw_hanger',
    'bw_mule_shoe',
    'bw_oh',
    'bw_open_hole',
    'bw_packer',
    'bw_tubing',
  ],
  colorOuter: '#e845d2',
  viewZScale: 1,
  viewXScale: 3.25,
  partAppearance: {
    n_cuj802: {
      colorOuter: '#f7f8fd',
      opacity: 0.1,
    },
    n_76ilhn: {
      colorOuter: '#ebecf0',
      material: 'steel',
    },
    n_hyz1he: {
      colorOuter: '#e8c9e4',
      texture: 'steel',
    },
    n_ahauw0: {
      colorOuter: '#ebdbe9',
      opacity: 0.1,
    },
    n_bjan0i: {
      colorOuter: '#f9d2d6',
    },
    n_9s9m3l: {
      colorOuter: '#ddc5c9',
    },
  },
  warpNodes: [
    0,
    1.4,
    1.4,
    241.4,
    241.4,
    251.4,
    251.4,
    256.4,
  ],
  warpMaxDepth: 256.4,
  instanceColors: {
    _ps_n_pstk_0: {
      outer: '#959393',
      material: 'steel',
    },
    _ps_n_pstk_1: {
      outer: '#9dca21',
    },
    _ps_n_pstk_3: {
      outer: '#ddd6c4',
      material: 'limestone',
    },
  },
  params: {
    cements: {
      kind: 'list',
      of: {
        record: 'Cement',
      },
      default: [
        {
          od: 12.25,
          wall: 1.2,
          length: 30,
          segments: 24,
          top: 200,
        },
        {
          od: 17.5,
          wall: 0.9,
          length: 100,
          segments: 24,
          top: 50,
        },
      ],
    },
    openholes: {
      kind: 'list',
      of: {
        record: 'Openhole',
      },
      default: [
        {
          od: 17.5,
          length: 200,
          segments: 24,
          top: 0,
        },
        {
          od: 12.25,
          length: 100,
          segments: 24,
          top: 200,
        },
      ],
    },
    casings: {
      kind: 'list',
      of: {
        record: 'Casing',
      },
      default: [
        {
          od: 13.375,
          wall: 0.5,
          length: 200,
          segments: 24,
          top: 0,
        },
        {
          od: 9.625,
          wall: 0.5,
          length: 300,
          segments: 24,
          top: 0,
        },
      ],
    },
  },
  graph: {
    nodes: {
      n_230uub: {
        id: 'n_230uub',
        type: 'list',
        children: [
          'n_bthunp',
          'n_wkc7xp',
          'n_a0hwfo',
          'n_pstk',
        ],
      },
      n_bthunp: {
        id: 'n_bthunp',
        type: 'parts_map',
        src: 'bw_cement',
        list: {
          kind: 'param',
          param: 'cements',
        },
        loopVar: 's',
        argMap: {
          od: {
            kind: 'expr',
            expr: 's.od',
          },
          wall: {
            kind: 'expr',
            expr: 's.wall',
          },
          length: {
            kind: 'expr',
            expr: 's.length',
          },
          segments: {
            kind: 'expr',
            expr: 's.segments',
          },
          top: {
            kind: 'expr',
            expr: 's.top',
          },
        },
        op: 'list',
      },
      n_wkc7xp: {
        id: 'n_wkc7xp',
        type: 'parts_map',
        src: 'bw_open_hole',
        list: {
          kind: 'param',
          param: 'openholes',
        },
        loopVar: 's',
        argMap: {
          od: {
            kind: 'expr',
            expr: 's.od',
          },
          length: {
            kind: 'expr',
            expr: 's.length',
          },
          segments: {
            kind: 'expr',
            expr: 's.segments',
          },
          top: {
            kind: 'expr',
            expr: 's.top',
          },
        },
        op: 'list',
      },
      n_a0hwfo: {
        id: 'n_a0hwfo',
        type: 'parts_map',
        src: 'bw_casing',
        list: {
          kind: 'param',
          param: 'casings',
        },
        loopVar: 's',
        argMap: {
          od: {
            kind: 'expr',
            expr: 's.od',
          },
          wall: {
            kind: 'expr',
            expr: 's.wall',
          },
          length: {
            kind: 'expr',
            expr: 's.length',
          },
          segments: {
            kind: 'expr',
            expr: 's.segments',
          },
          top: {
            kind: 'expr',
            expr: 's.top',
          },
        },
        op: 'list',
      },
      n_pstk: {
        id: 'n_pstk',
        type: 'parts_stack',
        rows: [
          {
            src: 'bw_hanger',
            args: {
              od: {
                kind: 'literal',
                value: 8.681,
              },
              id: {
                kind: 'literal',
                value: 2.875,
              },
              length: {
                kind: 'literal',
                value: 1.4,
              },
              chamfer: {
                kind: 'literal',
                value: 0.5,
              },
            },
            material: {
              color: '#959393',
              preset: 'steel',
            },
          },
          {
            src: 'bw_tubing',
            args: {
              od: {
                kind: 'literal',
                value: 2.875,
              },
              wall: {
                kind: 'literal',
                value: 0.217,
              },
              length: {
                kind: 'literal',
                value: 240,
              },
              collar_od: {
                kind: 'literal',
                value: 3.668,
              },
              collar_len: {
                kind: 'literal',
                value: 6,
              },
              spacing: {
                kind: 'literal',
                value: 30,
              },
            },
            material: {
              color: '#9dca21',
            },
          },
          {
            src: 'bw_packer',
            args: {
              od: {
                kind: 'literal',
                value: 7,
              },
              id: {
                kind: 'literal',
                value: 4,
              },
              length: {
                kind: 'literal',
                value: 10,
              },
              seal_od: {
                kind: 'literal',
                value: 9.5,
              },
              seal_len: {
                kind: 'literal',
                value: 2,
              },
            },
          },
          {
            src: 'bw_mule_shoe',
            args: {
              length: {
                kind: 'literal',
                value: 5,
              },
            },
            material: {
              color: '#ddd6c4',
              preset: 'limestone',
            },
          },
        ],
      },
    },
    root: 'n_230uub',
    params: {
      cements: {
        kind: 'list',
        of: {
          record: 'Cement',
        },
        default: [
          {
            od: 12.25,
            wall: 1.2,
            length: 30,
            segments: 24,
            top: 200,
          },
          {
            od: 17.5,
            wall: 0.9,
            length: 100,
            segments: 24,
            top: 50,
          },
        ],
      },
      openholes: {
        kind: 'list',
        of: {
          record: 'Openhole',
        },
        default: [
          {
            od: 17.5,
            length: 200,
            segments: 24,
            top: 0,
          },
          {
            od: 12.25,
            length: 100,
            segments: 24,
            top: 200,
          },
        ],
      },
      casings: {
        kind: 'list',
        of: {
          record: 'Casing',
        },
        default: [
          {
            od: 13.375,
            wall: 0.5,
            length: 200,
            segments: 24,
            top: 0,
          },
          {
            od: 9.625,
            wall: 0.5,
            length: 300,
            segments: 24,
            top: 0,
          },
        ],
      },
    },
    imports: [
      'bw_casing',
      'bw_cement',
      'bw_hanger',
      'bw_oh',
      'bw_open_hole',
      'bw_packer',
      'bw_tubing',
    ],
    layout: {
      n_230uub: {
        x: 596.6636792004681,
        y: 72.18640568314036,
      },
      n_cuj802: {
        x: -38.72420946785042,
        y: -124.16641215255899,
        w: 212,
      },
      n_qokv0e: {
        x: 316.6636792004681,
        y: -63.0775678141231,
      },
      n_qd9rz2: {
        x: 432.6636792004681,
        y: -13.235874889018834,
      },
      n_e8kwp6: {
        x: 93.390625,
        y: 350.6796875,
      },
      n_76ilhn: {
        x: -43.18817072500469,
        y: 17.75139943098903,
      },
      n_te5x1q: {
        x: 512.6181589565207,
        y: -57.98215870221583,
      },
      n_nca0ik: {
        x: 180.98647184857538,
        y: 31.443773537847775,
      },
      n_hyz1he: {
        x: -42.033168824564726,
        y: 182.42267231487818,
        w: 224,
        h: 156,
      },
      n_ahauw0: {
        x: -35.91333198664721,
        y: 353.19776776843514,
        w: 224,
        h: 145,
      },
      n_bjan0i: {
        x: 207.4050967903615,
        y: 76.72775663267453,
        w: 214,
      },
      n_9s9m3l: {
        x: 229.69247839598364,
        y: 398.9059451495545,
        w: 219,
        h: 147,
      },
      n_6ndtao: {
        x: 427.02888911198744,
        y: 45.59032531336879,
        w: 410,
      },
      n_wa0pvi: {
        x: 506.1927096257815,
        y: 112.5294547715794,
        w: 257,
      },
      n_lsbxdp: {
        x: 116.51185236667848,
        y: 241.3224794912686,
        w: 251,
      },
      n_bthunp: {
        x: -33.24642306074928,
        y: 36.425442119951185,
        w: 346,
      },
      n_m6cvcv: {
        x: 320,
        y: 80,
      },
      n_4vd1hp: {
        x: 560,
        y: 80,
      },
      n_wkc7xp: {
        x: -101.49372400675449,
        y: 176.75990904449836,
      },
      n_a0hwfo: {
        x: 202.076083231726,
        y: 163.01481844043067,
        w: 386,
      },
      n_y54ic1: {
        x: 45.312553599838125,
        y: 360.4463876260368,
        w: 274,
      },
      n_xj7hos: {
        x: 493.9038265175802,
        y: 335.9213703534274,
      },
      n_vamo4i: {
        x: 165.32213169957038,
        y: 642.4172970631324,
        w: 229,
        h: 156,
      },
      n_pstk: {
        x: -129.1918066383223,
        y: 323.57406304843335,
        w: 286,
      },
    },
    viewport: {
      pan: {
        x: 136.3359375,
        y: -221.6796875,
      },
      zoom: 1.6362485073071211,
    },
    colorOuter: '#e845d2',
    viewZScale: 1,
    viewXScale: 3.25,
    partAppearance: {
      n_cuj802: {
        colorOuter: '#f7f8fd',
        opacity: 0.1,
      },
      n_76ilhn: {
        colorOuter: '#ebecf0',
        material: 'steel',
      },
      n_hyz1he: {
        colorOuter: '#e8c9e4',
        texture: 'steel',
      },
      n_ahauw0: {
        colorOuter: '#ebdbe9',
        opacity: 0.1,
      },
      n_bjan0i: {
        colorOuter: '#f9d2d6',
      },
      n_9s9m3l: {
        colorOuter: '#ddc5c9',
      },
    },
    exprDefs: [
      {
        id: 'n_xfwnxo',
        name: 'expr_1',
        params: [],
        consts: [],
        vars: [],
        outputs: [],
      },
    ],
  },
};

// AUTO-GENERATED from meta.graph by composition-emit.ts.
// Edits to this body are DISCARDED — the editor regenerates from the graph on every save.
export function w_well_native(p) {
  const _ps_n_pstk_0 = bw_hanger({ od: 8.681, id: 2.875, length: 1.4, chamfer: 0.5 });
  const _ps_n_pstk_1 = bw_tubing({ od: 2.875, wall: 0.217, length: 240, collar_od: 3.668, collar_len: 6, spacing: 30 });
  const _ps_n_pstk_2 = bw_packer({ od: 7, id: 4, length: 10, seal_od: 9.5, seal_len: 2 });
  const _ps_n_pstk_3 = bw_mule_shoe({ length: 5 });
  const _parts_1 = Array.from(p.cements, (s, i) => bw_cement({ od: s.od, wall: s.wall, length: s.length, segments: s.segments, top: s.top }));
  const _parts_2 = Array.from(p.openholes, (s, i) => bw_open_hole({ od: s.od, length: s.length, segments: s.segments, top: s.top }));
  const _parts_3 = Array.from(p.casings, (s, i) => bw_casing({ od: s.od, wall: s.wall, length: s.length, segments: s.segments, top: s.top }));
  const _pstack_1 = stack([_ps_n_pstk_0, _ps_n_pstk_1, _ps_n_pstk_2, _ps_n_pstk_3]);
  return [..._parts_1, ..._parts_2, ..._parts_3, _pstack_1];
}

export function w_probe() {
  return w_well_native({"cements":[{"od":12.25,"wall":1.2,"length":30,"segments":24,"top":200},{"od":17.5,"wall":0.9,"length":100,"segments":24,"top":50}],"openholes":[{"od":17.5,"length":200,"segments":24,"top":0},{"od":12.25,"length":100,"segments":24,"top":200}],"casings":[{"od":13.375,"wall":0.5,"length":200,"segments":24,"top":0},{"od":9.625,"wall":0.5,"length":300,"segments":24,"top":0}]});
}
