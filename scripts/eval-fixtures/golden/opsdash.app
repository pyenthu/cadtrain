{
  "app": "opsdash",
  "title": "Sales — Dashboard",
  "docType": "dashboard",
  "theme": { "mode": "light", "accent": "#2563eb" },
  "vars": {
    "months": [
      { "month": "Jan", "revenue": 18200, "orders": 264 },
      { "month": "Feb", "revenue": 19750, "orders": 288 },
      { "month": "Mar", "revenue": 22100, "orders": 312 },
      { "month": "Apr", "revenue": 20900, "orders": 301 },
      { "month": "May", "revenue": 23650, "orders": 334 },
      { "month": "Jun", "revenue": 23800, "orders": 341 }
    ]
  },
  "panels": [
    { "id": "title", "kind": "heading", "props": { "text": "Sales — Dashboard", "level": 1 } },
    { "id": "sub", "kind": "text", "props": { "text": "Revenue and orders by month.", "muted": true, "size": "sm" } },
    {
      "id": "kpis",
      "kind": "statgrid",
      "props": { "minTileWidth": 180, "gap": 12 },
      "children": [
        { "id": "k_rev", "kind": "stat", "props": { "label": "Revenue", "value": "128400", "format": "currency", "delta": "12", "deltaDir": "up" } },
        { "id": "k_orders", "kind": "stat", "props": { "label": "Orders", "value": "1840" } },
        { "id": "k_aov", "kind": "stat", "props": { "label": "Avg order", "value": "69.8", "format": "currency" } }
      ]
    },
    { "id": "revchart", "kind": "chart", "props": { "type": "line", "rowsVar": "months", "xField": "month", "yField": "revenue", "title": "Revenue by month" } },
    { "id": "monthstable", "kind": "datatable", "source": { "verb": "readVar", "args": { "name": "months" } }, "props": { "columns": "month,revenue,orders", "sortable": true, "showTotals": true } }
  ]
}
