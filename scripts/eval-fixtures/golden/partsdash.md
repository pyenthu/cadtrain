Build a CAD parts dashboard app.

A level-1 heading and a small muted subtitle, then a **stat grid** of three KPI tiles
(parts count, total triangles in compact format, average vertices), a **bar chart** of
triangles per part (x = id, y = tris), a **data table** of the parts (columns id, category,
verts, tris — with search, sorting and totals), and a **3D CAD viewer** of the g_shaft part.
Seed a `parts` variable as a list of part records (fields: id, category, verts, tris) and
define a `part` structure. Light theme, teal accent.

Components: heading · text · statgrid (stat KPI tiles) · chart (bar, reads parts) · datatable (readVar parts) · cad3d (g_shaft).
