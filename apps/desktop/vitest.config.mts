import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths({ projects: [path.resolve(__dirname, "tsconfig.paths.json")] })],
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    globals: false,
    reporters: "default",
  },
});
