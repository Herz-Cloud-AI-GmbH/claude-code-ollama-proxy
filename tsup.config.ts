import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    server: "src/server.ts",
  },
  format: ["esm"],
  target: "node18",
  clean: true,
  dts: false,
  outDir: "dist",
  splitting: false,
  sourcemap: false,
});
