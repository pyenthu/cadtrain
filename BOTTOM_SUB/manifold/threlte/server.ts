import index from "./index.html";

Bun.serve({
  port: 3333,
  routes: {
    "/": index,
  },
  static: {
    "/original.png": new Response(Bun.file("../original.png")),
    "/geometry.js": new Response(Bun.file("../geometry.js"), { headers: { "Content-Type": "application/javascript" } }),
    "/params.json": new Response(Bun.file("../params.json"), { headers: { "Content-Type": "application/json" } }),
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log("Threlte viewer running at http://localhost:3333");
