import assert from "assert";
import { readFile } from "fs/promises";
import path from "path";
import * as esbuild from "esbuild";

type BuildFlags = {
  watch?: boolean;
};

async function buildMain(flags: BuildFlags = {}) {
  const options: esbuild.BuildOptions = {
    entryPoints: ["./src/extension.ts"],
    bundle: true,
    outfile: "./dist/extension.js",
    format: "cjs",
    external: ["vscode"],
    logLevel: "info",
  };

  if (flags.watch) {
    const ctx = await esbuild.context(options);

    // Start watching for changes...
    await ctx.watch();
  } else {
    await esbuild.build(options);
  }
}

async function run() {
  await buildMain({ watch: process.argv.includes("--watch") });
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
