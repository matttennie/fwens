import { defineConfig } from "vitest/config";

// Exclude dist/ so vitest doesn't rediscover compiled test files after `tsc`
// runs. Vitest v3 excluded dist by default; v4 does not, and the compiled
// index-shape.test.js references source paths that only exist under src/.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
