// Bundle the plugin entry into a single self-contained ESM file.
//
// `openclaw` (and its subpaths) stay external — provided by the host gateway at
// runtime via the peer-dependency symlink. Everything else (@modelcontextprotocol
// /sdk, typebox, the SDK's transitive zod/eventsource/pkce-challenge, …) is
// inlined so the published package declares zero npm `dependencies` and OpenClaw
// never runs `npm install` at plugin-install time.
//
// ajv carve-out: the MCP SDK's client statically imports `AjvJsonSchemaValidator`,
// which pulls in `ajv` (and `ajv-formats`). ajv compiles JSON schemas with
// `new Function(...)`, and OpenClaw's plugin security scanner blocks any dynamic
// code execution — so a bundle containing ajv is refused at install time.
// DeckClient passes its own pass-through `jsonSchemaValidator` (see
// `src/lib/deck-client.ts`), so `AjvJsonSchemaValidator` is never constructed and
// none of this code runs. The resolve plugin below redirects `ajv`, any `ajv/*`
// subpath, and `ajv-formats` to an inert stub so the `new Function` compiler
// never enters the bundle.
import { build } from "esbuild";

const stubAjvPlugin = {
  name: "stub-ajv",
  setup(b) {
    b.onResolve({ filter: /^ajv(-formats)?($|\/)/ }, () => ({
      path: "ajv-stub",
      namespace: "ajv-stub",
    }));
    // A Proxy stub: any property access or call returns the stub itself, so
    // ajv-formats' top-level references resolve without error. Nothing here is
    // ever invoked at runtime (the pass-through validator short-circuits it).
    b.onLoad({ filter: /.*/, namespace: "ajv-stub" }, () => ({
      contents:
        "const s = new Proxy(function(){ return s; }, { get: () => s });\n" +
        "export default s;\n",
      loader: "js",
    }));
  },
};

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["openclaw", "openclaw/*"],
  outfile: "dist/index.js",
  plugins: [stubAjvPlugin],
});
