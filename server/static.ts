import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Module directory resolution that works under both the esbuild CJS bundle
// (prod, CJS `__dirname` global) and tsx (dev, ESM) — see server/index.ts.
const moduleDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

export function serveStatic(app: Express) {
  const distPath = path.resolve(moduleDir, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html for all unmatched routes (SPA routing)
  app.use((_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
