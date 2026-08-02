{
  "docType": "dashboard",
  "panels": [
    {
      "id": "partstable",
      "kind": "datatable",
      "source": {
        "verb": "readVar",
        "args": {
          "name": "parts"
        }
      },
      "props": {
        "columns": "id,category,verts,tris",
        "search": true,
        "sortable": true,
        "showTotals": true
      }
    }
  ]
}
