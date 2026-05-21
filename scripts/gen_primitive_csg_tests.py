#!/usr/bin/env python3
"""
gen_primitive_csg_tests — regenerate the CSG test composites in the
`primitives/tests/` category on the volume.

These are ~21 named test primitives that COMPOSE the r_ volume primitives
(r_revolve, r_extrude, r_cylinder, r_cube, r_ball, …) via CSG add/subtract/
intersect + mv/rot. They exercise the `meta.uses` composition path end to
end and double as a visual regression set for r_revolve + r_extrude.

They live ONLY on the (gitignored) volume, so this script is the durable
record — re-run it to recreate the whole set deterministically.

Pipeline per candidate:
  1. assemble source.ts (meta with `uses` + a geom fn body that CSGs deps)
  2. POST it to LOCAL /api/primitives/preview (local WASM render). The
     preview resolves `uses` deps by reading their source.ts from the
     volume via /api/volume (proxied to prod in dev), so the deps must
     already exist on the volume.
  3. keep only candidates that produce non-empty, manifold geometry
  4. PUT each kept source to PROD primitives/tests/<id>/source.ts

Run (dev server must be up on :3333, with CADTRAIN_VOLUME_REMOTE_URL set
so /api/volume proxies to prod):
    python3 scripts/gen_primitive_csg_tests.py            # preview only
    python3 scripts/gen_primitive_csg_tests.py --upload   # + write to volume
"""
import json, urllib.request, math, os, sys

LOCAL = 'http://localhost:3333'
PROD  = 'https://cadtrain.up.railway.app'

# ---- profile helpers (return lists of [a, b]) ------------------------------
def hexp(r):
    return [[round(r*math.cos(math.radians(a)),4), round(r*math.sin(math.radians(a)),4)] for a in range(0,360,60)]
def ngon(n,r):
    return [[round(r*math.cos(2*math.pi*i/n),4), round(r*math.sin(2*math.pi*i/n),4)] for i in range(n)]
def star(n,ro,ri):
    out=[]
    for i in range(2*n):
        rr = ro if i%2==0 else ri
        a = math.pi*i/n - math.pi/2
        out.append([round(rr*math.cos(a),4), round(rr*math.sin(a),4)])
    return out
PLUS=[[1.6,-0.5],[1.6,0.5],[0.5,0.5],[0.5,1.6],[-0.5,1.6],[-0.5,0.5],[-1.6,0.5],
      [-1.6,-0.5],[-0.5,-0.5],[-0.5,-1.6],[0.5,-1.6],[0.5,-0.5]]
LBRK=[[-1.5,-1.5],[1.5,-1.5],[1.5,-0.4],[-0.4,-0.4],[-0.4,1.5],[-1.5,1.5]]
TEE =[[-1.6,1.4],[1.6,1.4],[1.6,0.6],[0.4,0.6],[0.4,-1.6],[-0.4,-1.6],[-0.4,0.6],[-1.6,0.6]]
SQ  =[[1.3,1.3],[1.3,-1.3],[-1.3,-1.3],[-1.3,1.3]]
# revolve (r,z) profiles — Z-down, z=0 = top
REV_CYL  = lambda R,H: [[0,0],[R,0],[R,H],[0,H]]
REV_CONE = lambda R,H: [[0,0],[R,H],[0,H]]            # apex top, base bottom
REV_CSINK= lambda R,D: [[0,0],[R,0],[0,D]]            # conical void: wide at z=0
REV_DIAM = lambda R,H: [[0,0],[R,H/2],[0,H]]          # bicone / diamond
REV_BARR = lambda R,H: [[0,0],[R*0.7,0],[R,H/2],[R*0.7,H],[0,H]]
REV_DISK = lambda R,T: [[0,0],[R,0],[R,T],[0,T]]
REV_VASE = [[0,0],[1.4,0],[1.4,0.4],[0.7,1.6],[1.05,3.4],[0.6,4],[0,4]]
def sphere_prof(R,seg=10):  # half-disk → revolve = sphere centered z=R
    return [[round(R*math.sin(math.pi*i/seg),4), round(R-R*math.cos(math.pi*i/seg),4)] for i in range(seg+1)]

def j(x): return json.dumps(x)

# ---- the candidates --------------------------------------------------------
T = []
def add(id, desc, uses, body): T.append((id, desc, uses, body))

# r_revolve + r_extrude headline combos
add('t_bolt_hexhead', 'Bolt: round shaft (r_revolve) + hex head (r_extrude) on top.',
    ['r_revolve','r_extrude'],
    f"const shaft=r_revolve({j(REV_CYL(0.8,4.5))},64);"
    f"const head=mv(r_extrude({j(hexp(1.6))},1.3),[0,0,-1.3]);"
    f"return shaft.add(head);")
add('t_hex_countersink', 'Hex block (r_extrude) with a conical countersink (r_revolve cone) carved in the top.',
    ['r_extrude','r_revolve'],
    f"const blk=r_extrude({j(hexp(1.9))},2.6);"
    f"const csink=r_revolve({j(REV_CSINK(1.3,1.4))},64);"
    f"return blk.subtract(csink);")
add('t_goblet_plus_cut', 'Goblet (r_revolve) with a +-shaped hole (r_extrude) punched down the axis.',
    ['r_revolve','r_extrude'],
    f"const g=r_revolve({j(REV_VASE)},96);"
    f"const cut=mv(r_extrude({j([[p[0]*0.55,p[1]*0.55] for p in PLUS])},6),[0,0,-1]);"
    f"return g.subtract(cut);")
add('t_rounded_hex', 'Hex prism (r_extrude) intersected with a sphere (r_revolve) — pebble-rounded hex.',
    ['r_extrude','r_revolve'],
    f"const hx=mv(r_extrude({j(hexp(2.0))},3.6),[0,0,-1.8]);"
    f"const ball=mv(r_revolve({j(sphere_prof(2.1))},64),[0,0,-2.1]);"
    f"return hx.intersect(ball);")
add('t_finial', 'Turned finial (r_revolve vase) on a star plinth (r_extrude star).',
    ['r_revolve','r_extrude'],
    f"const v=r_revolve({j(REV_VASE)},96);"
    f"const base=mv(r_extrude({j(star(6,2.2,1.3))},0.8),[0,0,3.6]);"
    f"return v.add(base);")
add('t_hex_revolve_pocket', 'Hex block (r_extrude) with a turned bowl pocket (r_revolve) sunk in the top.',
    ['r_extrude','r_revolve'],
    f"const blk=r_extrude({j(hexp(2.0))},3.0);"
    f"const pkt=r_revolve({j([[0,0],[1.4,0],[1.3,1.6],[0,1.8]])},64);"
    f"return blk.subtract(pkt);")
add('t_spinner', 'Turned disk (r_revolve) with + arms (r_extrude) — fidget spinner blank.',
    ['r_revolve','r_extrude'],
    f"const hub=r_revolve({j(REV_DISK(1.1,1.0))},64);"
    f"const arms=mv(r_extrude({j([[p[0]*1.6,p[1]*1.6] for p in PLUS])},0.7),[0,0,0.15]);"
    f"return hub.add(arms);")
add('t_valve_port', 'Turned valve body (r_revolve barrel) with a hex side-port (r_extrude) bored through.',
    ['r_revolve','r_extrude'],
    f"const body=r_revolve({j(REV_BARR(1.8,4))},96);"
    f"const port=mv(rot(r_extrude({j(hexp(0.8))},8),[90,0,0]),[0,-4,2]);"
    f"return body.subtract(port);")

# r_revolve centric
add('t_goblet_bored', 'Goblet (r_revolve) bored through with a round hole (r_cylinder).',
    ['r_revolve','r_cylinder'],
    f"const g=r_revolve({j(REV_VASE)},96);"
    f"const bore=mv(r_cylinder(1.0,10,48),[0,0,2]);"
    f"return g.subtract(bore);")
add('t_barrel_scoop', 'Turned barrel (r_revolve) with a spherical scoop (r_ball) removed from the top.',
    ['r_revolve','r_ball'],
    f"const b=r_revolve({j(REV_BARR(1.8,4))},96);"
    f"const scoop=r_ball(2.6,48);"
    f"return b.subtract(scoop);")
add('t_vase_clip', 'Turned vase (r_revolve) intersected with a cube (r_cube) — block-clipped vase.',
    ['r_revolve','r_cube'],
    f"const v=mv(r_revolve({j(REV_VASE)},96),[0,0,-2]);"
    f"return v.intersect(r_cube(2.4,2.4,5));")
add('t_diamond_bore', 'Turned bicone/diamond (r_revolve) bored axially (r_cylinder).',
    ['r_revolve','r_cylinder'],
    f"const d=r_revolve({j(REV_DIAM(1.8,4))},96);"
    f"const bore=mv(r_cylinder(1.2,10,48),[0,0,2]);"
    f"return d.subtract(bore);")
add('t_cup_knob', 'Turned cup (r_revolve) with a ball knob (r_ball) added at the base.',
    ['r_revolve','r_ball'],
    f"const c=r_revolve({j([[0,0],[1.6,0],[1.5,0.3],[1.2,2.6],[1.4,3.0],[0,3.0]])},96);"
    f"const knob=mv(r_ball(1.4,48),[0,0,3.0]);"
    f"return c.add(knob);")

# r_extrude centric
add('t_hex_nut', 'Hex prism (r_extrude) with a round bore (r_cylinder) — hex nut.',
    ['r_extrude','r_cylinder'],
    f"const hx=r_extrude({j(hexp(1.9))},2.2);"
    f"const bore=mv(r_cylinder(2.0,6,48),[0,0,1.1]);"
    f"return hx.subtract(bore);")
add('t_plus_boss', 'Plus prism (r_extrude) with a round boss (r_cylinder) added at center.',
    ['r_extrude','r_cylinder'],
    f"const pl=r_extrude({j(PLUS)},1.0);"
    f"const boss=mv(r_cylinder(1.2,2.2,48),[0,0,-0.6]);"
    f"return pl.add(boss);")
add('t_star_bore', 'Star prism (r_extrude) with a round through-bore (r_cylinder).',
    ['r_extrude','r_cylinder'],
    f"const st=r_extrude({j(star(5,2.0,0.95))},2.0);"
    f"const bore=mv(r_cylinder(1.4,6,48),[0,0,1]);"
    f"return st.subtract(bore);")
add('t_L_drilled', 'L-bracket prism (r_extrude) with two round holes (r_cylinder).',
    ['r_extrude','r_cylinder'],
    f"const L=r_extrude({j(LBRK)},1.0);"
    f"const h1=mv(r_cylinder(0.7,3,32),[-1.0,1.0,0]);"
    f"const h2=mv(r_cylinder(0.7,3,32),[1.0,-1.0,0]);"
    f"return L.subtract(h1).subtract(h2);")
add('t_hex_cube_xsect', 'Hex prism (r_extrude) intersected with a cube (r_cube) — hex clipped to a square footprint.',
    ['r_extrude','r_cube'],
    f"const hx=mv(r_extrude({j(hexp(2.3))},3),[0,0,-1.5]);"
    f"return hx.intersect(r_cube(3.4,3.4,2.6));")
add('t_tee_slot', 'T prism (r_extrude) with a cube slot (r_cube) milled across it.',
    ['r_extrude','r_cube'],
    f"const t=r_extrude({j(TEE)},1.2);"
    f"const slot=mv(r_cube(5,0.8,0.8),[0,0.6,0.6]);"
    f"return t.subtract(slot);")

# base-prim cross
add('t_cyl_cross_drill', 'Round cylinder (r_cylinder) cross-drilled with a + slot (r_extrude).',
    ['r_cylinder','r_extrude'],
    f"const cyl=r_cylinder(3.2,5,64);"
    f"const cut=rot(r_extrude({j([[p[0]*0.7,p[1]*0.7] for p in PLUS])},8),[90,0,0]);"
    f"return cyl.subtract(mv(cut,[0,-4,0]));")
add('t_tube_hexcap', 'Round tube (r_tube) capped with a hex flange (r_extrude).',
    ['r_tube','r_extrude'],
    f"const tb=r_tube(3.2,2.2,5,64);"
    f"const cap=mv(r_extrude({j(hexp(2.2))},0.8),[0,0,-2.5]);"
    f"return tb.add(cap);")

# ---- assemble + preview + (optional) upload --------------------------------
META = ("export const meta = {{ id:'{id}', name:'{id}', description:{desc}, "
        "tags:['test','csg'], uses:{uses}, params:{{}}, "
        "material:{{ outer:{{ color:'#6f8a7d', metallic:0.6, roughness:0.4 }}, "
        "inner:{{ color:'#3a3a3a', metallic:0.1, roughness:0.9 }} }} }};\n")

def build_src(id, desc, uses, body):
    m = META.format(id=id, desc=json.dumps(desc), uses=json.dumps(uses))
    return m + f"export function {id}() {{\n  {body}\n}}\n"

def preview(src, name):
    body = json.dumps({'source': src, 'name': name, 'params': []}).encode()
    req = urllib.request.Request(LOCAL+'/api/primitives/preview', data=body, method='POST',
        headers={'content-type':'application/json'})
    try:
        d = json.loads(urllib.request.urlopen(req, timeout=90).read().decode())
        f = d.get('full',{}); p = f.get('positions',[])
        return (len(p)//3, len(f.get('index',[]))//3, None)
    except urllib.error.HTTPError as e:
        return (0,0, f'HTTP{e.code}: '+e.read().decode()[:120].replace(chr(10),' '))
    except Exception as e:
        return (0,0, str(e)[:140])

def upload(id, src):
    url = f'{PROD}/api/volume?path=primitives/tests/{id}/source.ts'
    req = urllib.request.Request(url, data=src.encode(), method='PUT',
        headers={'content-type':'application/x-typescript','Origin':PROD})
    urllib.request.urlopen(req, timeout=30)

def main():
    do_upload = '--upload' in sys.argv
    passing = []
    for (id, desc, uses, body) in T:
        src = build_src(id, desc, uses, body)
        nv, nt, err = preview(src, id)
        ok = (err is None) and nv >= 12 and nt >= 8
        print(f"{'OK ' if ok else 'XX '} {id:24} v={nv:5} t={nt:5} {err or ''}")
        if ok: passing.append((id, src))
    print(f"\nPASS {len(passing)}/{len(T)}")
    if do_upload:
        for (id, src) in passing:
            upload(id, src)
        print(f"uploaded {len(passing)} → {PROD}/primitives/tests/")

if __name__ == '__main__':
    main()
