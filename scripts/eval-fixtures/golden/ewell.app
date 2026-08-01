{
  "app": "ewell",
  "title": "GEOWELLS — Well Schematic",
  "docType": "well",
  "theme": {
    "mode": "light",
    "accent": "#0f3d56"
  },
  "vars": {
    "well": {
      "name": "Wildcat #1",
      "description": "A sample description for a well",
      "company": "Pvt Asian Independent",
      "field": "New Field",
      "country": "USA",
      "state": "Wyoming",
      "location": "25N 36E",
      "totalDepth": 3000,
      "depthUnit": "ft"
    },
    "casings": [
      {
        "od": 13.375,
        "grade": "L-80",
        "weight": 56,
        "top": 0,
        "bot": 200
      },
      {
        "od": 9.625,
        "grade": "L-80",
        "weight": 36,
        "top": 0,
        "bot": 1200
      },
      {
        "od": 7,
        "grade": "L-80",
        "weight": 26,
        "top": 0,
        "bot": 2200
      },
      {
        "od": 4.5,
        "grade": "L-80",
        "weight": 15,
        "top": 2100,
        "bot": 2990
      }
    ],
    "holes": [
      {
        "bitSize": 17.5,
        "top": 0,
        "bot": 200
      },
      {
        "bitSize": 12.25,
        "top": 200,
        "bot": 1200
      },
      {
        "bitSize": 8.5,
        "top": 1200,
        "bot": 2200
      },
      {
        "bitSize": 6,
        "top": 2200,
        "bot": 3000
      }
    ],
    "cement": [
      {
        "od": 13.375,
        "top": 100,
        "bot": 200
      },
      {
        "od": 9.625,
        "top": 500,
        "bot": 1499
      },
      {
        "od": 7,
        "top": 1800,
        "bot": 2200
      },
      {
        "od": 4.5,
        "top": 2100,
        "bot": 2990
      }
    ],
    "tubing": [
      {
        "od": 9.5,
        "top": 0,
        "bot": 6,
        "label": "Tubing Hanger"
      },
      {
        "od": 2.875,
        "top": 6,
        "bot": 2085,
        "label": "Tubing 2-7/8 EUE"
      },
      {
        "od": 6,
        "top": 2085,
        "bot": 2100,
        "label": "Production Packer"
      }
    ],
    "perforations": [
      {
        "top": 1850,
        "bot": 1870,
        "shotDensity": 6,
        "gunOD": 3.5,
        "company": "Baker Hughes",
        "perfSpec": "Deep penetration low debris",
        "color": "#f0a500"
      },
      {
        "top": 1950,
        "bot": 1970,
        "shotDensity": 6,
        "gunOD": 3.5,
        "company": "Baker Hughes",
        "perfSpec": "Deep penetration low debris",
        "color": "#f0a500"
      },
      {
        "top": 2800,
        "bot": 2810,
        "shotDensity": 6,
        "gunOD": 3.5,
        "company": "Baker Hughes",
        "perfSpec": "Deep penetration",
        "color": "#e11d48"
      }
    ],
    "completions": [
      {
        "od": 9.5,
        "length": 3,
        "weight": 90,
        "description": "Tubing Hanger"
      },
      {
        "od": 2.875,
        "length": 900,
        "weight": 900,
        "description": "Tubing 2-7/8 EUE"
      },
      {
        "od": 7,
        "length": 1,
        "weight": 30,
        "description": "Sand Control Packer"
      },
      {
        "od": 2.875,
        "length": 500,
        "weight": 900,
        "description": "Tubing 2-7/8 EUE"
      },
      {
        "od": 6.6,
        "length": 1,
        "weight": 30,
        "description": "Sand Control Packer"
      }
    ]
  },
  "panels": [
    {
      "id": "rail",
      "kind": "vtoolbar",
      "props": {
        "align": "start"
      },
      "layout": {
        "col": 1,
        "row": 1,
        "w": 1,
        "h": 1
      },
      "children": [
        {
          "id": "tb-addwell",
          "kind": "iconbutton",
          "props": {
            "icon": "add",
            "label": "",
            "variant": "ghost"
          },
          "children": [
            {
              "id": "pop-addwell",
              "kind": "popover",
              "props": {
                "title": "Add Well"
              },
              "children": [
                {
                  "id": "addwell-note",
                  "kind": "text",
                  "props": {
                    "text": "New well (demo) — the active well is $vars.well.name.",
                    "muted": true
                  }
                }
              ]
            }
          ]
        },
        {
          "id": "tb-header",
          "kind": "iconbutton",
          "props": {
            "icon": "info",
            "label": "",
            "variant": "ghost"
          },
          "children": [
            {
              "id": "pop-header",
              "kind": "popover",
              "props": {
                "title": "Well Header"
              },
              "children": [
                {
                  "id": "hdr-name",
                  "kind": "text",
                  "props": {
                    "text": "Well: $vars.well.name",
                    "weight": 600
                  }
                },
                {
                  "id": "hdr-field",
                  "kind": "text",
                  "props": {
                    "text": "Field: $vars.well.field",
                    "muted": true
                  }
                },
                {
                  "id": "hdr-company",
                  "kind": "text",
                  "props": {
                    "text": "Company: $vars.well.company",
                    "muted": true
                  }
                }
              ]
            }
          ]
        },
        {
          "id": "tb-schematic",
          "kind": "iconbutton",
          "props": {
            "icon": "chart",
            "label": "Schem",
            "variant": "ghost"
          }
        },
        {
          "id": "tb-completions",
          "kind": "iconbutton",
          "props": {
            "icon": "table",
            "label": "Compl",
            "variant": "ghost"
          },
          "children": [
            {
              "id": "pop-completions",
              "kind": "popover",
              "props": {
                "title": "Completion Strings"
              },
              "children": [
                {
                  "id": "grid-completions",
                  "kind": "grid",
                  "title": "Completions",
                  "source": {
                    "verb": "readVar",
                    "args": {
                      "name": "completions"
                    }
                  },
                  "props": {
                    "columns": "description,od,length,weight"
                  }
                }
              ]
            }
          ]
        },
        {
          "id": "tb-perforations",
          "kind": "iconbutton",
          "props": {
            "icon": "flag",
            "label": "Perf",
            "variant": "ghost"
          },
          "children": [
            {
              "id": "pop-perforations",
              "kind": "popover",
              "props": {
                "title": "Perforations"
              },
              "children": [
                {
                  "id": "grid-perf-pop",
                  "kind": "grid",
                  "title": "Perforations",
                  "source": {
                    "verb": "readVar",
                    "args": {
                      "name": "perforations"
                    }
                  },
                  "props": {
                    "columns": "top,bot,shotDensity,gunOD,company"
                  }
                }
              ]
            }
          ]
        },
        {
          "id": "tb-display",
          "kind": "iconbutton",
          "props": {
            "icon": "settings",
            "label": "Disp",
            "variant": "ghost"
          },
          "children": [
            {
              "id": "pop-display",
              "kind": "popover",
              "props": {
                "title": "Display Options"
              },
              "children": [
                {
                  "id": "disp-note",
                  "kind": "text",
                  "props": {
                    "text": "Depth unit: $vars.well.depthUnit · TD $vars.well.totalDepth",
                    "muted": true
                  }
                }
              ]
            }
          ]
        },
        {
          "id": "tb-json",
          "kind": "iconbutton",
          "props": {
            "icon": "file",
            "label": "JSON",
            "variant": "ghost"
          },
          "children": [
            {
              "id": "pop-json",
              "kind": "popover",
              "props": {
                "title": "Well JSON"
              },
              "children": [
                {
                  "id": "json-note",
                  "kind": "text",
                  "props": {
                    "text": "Casings, tubing, perforations and completions are seeded app variables.",
                    "muted": true
                  }
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "main",
      "kind": "col",
      "layout": {
        "col": 2,
        "row": 1,
        "w": 8,
        "h": 1
      },
      "children": [
        {
          "id": "main-title",
          "kind": "heading",
          "props": {
            "level": 2,
            "text": "$vars.well.name"
          }
        },
        {
          "id": "main-sub",
          "kind": "text",
          "props": {
            "text": "$vars.well.field · $vars.well.state, $vars.well.country",
            "muted": true,
            "size": "sm"
          }
        },
        {
          "id": "schematic",
          "kind": "wellschematic",
          "props": {
            "wellVar": "well",
            "casingsVar": "casings",
            "holesVar": "holes",
            "tubingVar": "tubing",
            "perfsVar": "perforations",
            "cementVar": "cement",
            "depthUnit": "ft",
            "width": 420,
            "height": 560
          }
        }
      ]
    }
  ]
}
