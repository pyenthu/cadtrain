{
  "app": "wells",
  "title": "Well Designer",
  "docType": "well",
  "panels": [
    {
      "id": "list",
      "kind": "list",
      "title": "Wells",
      "source": { "verb": "listDocs", "args": { "docType": "well" } },
      "onSelect": { "verb": "loadDoc", "args": { "id": "$item.id" } }
    },
    {
      "id": "params",
      "kind": "form",
      "title": "Parameters",
      "source": { "verb": "getParams", "args": { "id": "$active" } },
      "controls": [
        {
          "id": "casings",
          "kind": "table",
          "bind": "casings",
          "cols": ["od", "id", "top", "bot"],
          "onEdit": { "verb": "setParam" },
          "add": { "verb": "addRow", "args": { "list": "casings" } }
        }
      ]
    },
    {
      "id": "view",
      "kind": "bake3d",
      "title": "3D",
      "source": { "verb": "bake", "args": { "id": "$active", "params": "$params" } }
    }
  ],
  "popovers": []
}
