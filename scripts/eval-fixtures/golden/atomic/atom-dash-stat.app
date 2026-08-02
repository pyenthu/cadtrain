{
  "docType": "dashboard",
  "panels": [
    {
      "id": "kpis",
      "kind": "statgrid",
      "props": {
        "minTileWidth": 180,
        "gap": 12
      },
      "children": [
        {
          "id": "k_rev",
          "kind": "stat",
          "props": {
            "label": "Revenue",
            "value": "128400",
            "format": "currency",
            "delta": "12",
            "deltaDir": "up"
          }
        }
      ]
    }
  ]
}
