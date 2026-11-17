import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Two kinds of test: everything in Node (the default), and the editor's Svelte components, compiled for the browser
// and run in a simulated DOM (jsdom). Canvas and WebGL drawing aren't simulated; those parts are tested in Chrome
// (the editor's end-to-end tests and the renderer tests).
export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: "node", include: ["**/*.test.ts"], exclude: ["**/node_modules/**", "**/*.component.test.ts"] } },
      {
        extends: true,
        plugins: [svelte()],
        resolve: { conditions: ["browser"] },
        test: { name: "components", include: ["apps/editor/test/**/*.component.test.ts"], environment: "jsdom" },
      },
    ],
  },
});
