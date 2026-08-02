{
  "app": "partsdash",
  "title": "CAD Parts — Dashboard",
  "docType": "dashboard",
  "theme": { "mode": "light", "accent": "#0d9488" },
  "structures": {
    "part": [
      { "name": "id", "type": "string" },
      { "name": "category", "type": "string" },
      { "name": "verts", "type": "number" },
      { "name": "tris", "type": "number" }
    ]
  },
  "vars": {
    "parts": [
      { "id": "g_cube", "category": "basic", "verts": 24, "tris": 12 },
      { "id": "g_shaft", "category": "basic", "verts": 388, "tris": 760 },
      { "id": "g_barrel", "category": "basic", "verts": 420, "tris": 812 },
      { "id": "g_spiral", "category": "basic", "verts": 1520, "tris": 3040 },
      { "id": "g_star", "category": "basic", "verts": 240, "tris": 460 }
    ]
  },
  "panels": [
    { "id": "title", "kind": "heading", "props": { "text": "CAD Parts — Dashboard", "level": 1 } },
    { "id": "sub", "kind": "text", "props": { "text": "Metrics across the basic parts library.", "muted": true, "size": "sm" } },
    {
      "id": "kpis",
      "kind": "statgrid",
      "props": { "minTileWidth": 200, "gap": 12 },
      "children": [
        { "id": "k_parts", "kind": "stat", "props": { "label": "Parts", "value": "5", "icon": "📦" } },
        { "id": "k_tris", "kind": "stat", "props": { "label": "Total tris", "value": "5084", "format": "compact" } },
        { "id": "k_verts", "kind": "stat", "props": { "label": "Avg verts", "value": "518" } }
      ]
    },
    { "id": "trischart", "kind": "chart", "props": { "type": "bar", "rowsVar": "parts", "xField": "id", "yField": "tris", "title": "Triangles per part" } },
    { "id": "partstable", "kind": "datatable", "source": { "verb": "readVar", "args": { "name": "parts" } }, "props": { "columns": "id,category,verts,tris", "search": true, "sortable": true, "showTotals": true } },
    { "id": "viewer", "kind": "cad3d", "props": { "partId": "g_shaft", "height": 360 } }
  ]
}
