// Type-checks the editor's Svelte files. svelte-check needs TypeScript 5 or 6 (it uses TypeScript's JavaScript API,
// which TypeScript 7 doesn't have), while the rest of the repo uses TypeScript 7. So TypeScript 6 is installed as
// "typescript6", and here every request svelte-check makes for "typescript" is sent to it.
const Module = require("node:module");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "typescript" || request.startsWith("typescript/")) request = "typescript6" + request.slice("typescript".length);
  return resolve.call(this, request, ...rest);
};
process.argv.splice(2, 0, "--workspace", require("node:path").join(__dirname, "../apps/editor"), "--fail-on-warnings", "--output", "human");
require("svelte-check/bin/svelte-check");
