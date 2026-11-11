import type { Express } from "express";
import { renderSite } from "../site/render";
import { APP_PATH } from "../site/layout";

/**
 * Public marketing pages, rendered once at startup.
 *
 * Mounted before the SPA/Vite fallback so `/`, the agent pages and their
 * assets never reach the app shell. A signed-in visitor at `/` goes straight
 * to the app; everyone else sees the home page.
 */
export function mountSite(app: Express): void {
  for (const [path, page] of Object.entries(renderSite())) {
    app.get(path, (req, res) => {
      if (path === "/" && req.userId) return res.redirect(302, APP_PATH);
      res.type(page.type);
      if (path.startsWith("/_site/")) res.set("Cache-Control", "public, max-age=3600");
      else res.set("Cache-Control", "no-cache");
      res.send(page.body);
    });
  }
}
