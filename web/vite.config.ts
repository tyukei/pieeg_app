import { defineConfig } from "vite";

// base: "./" → relative asset URLs so the build works under any GitHub Pages
// subpath (https://user.github.io/<repo>/) without knowing the repo name.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
