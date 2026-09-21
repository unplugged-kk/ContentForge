import express, { type Express } from "express";
import fs from "fs";
import path from "path";

/**
 * Where the built client lives. Only ever reached in production, where the
 * esbuild CJS bundle runs and `__dirname` is `dist/`; the `process.cwd()`
 * fallback keeps this module loadable under tsx (dev, ESM) where `__dirname`
 * does not exist — see server/index.ts.
 */
const appDir = typeof __dirname !== "undefined" ? __dirname : process.cwd();

export function serveStatic(app: Express) {
  const distPath = path.resolve(appDir, "public");
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
