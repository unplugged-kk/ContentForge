# Handover: public marketing site and product audit

Date: 2026-11-11. Branch: `feat/auth0-migration`. See also `docs/HANDOVER.md` (earlier, separate handover).

## Goal

Two requests, one session:

1. **Recreate postiz.com as the public face of ContentForge**: a home page plus four AI-agent pages (`/chatgpt`, `/dots`, `/claude`, `/claude-cowork`), matched to captured screenshots, fonts, colours and breakpoints, with CannerAI and Postiz as inspiration only.
2. **Audit ContentForge against the product vision** (the 10 capability areas and the locked lifecycle in `CURRENT_ARCHITECTURE.md`) and leave living documents: capability matrix, roadmap, status.

## What was done

- `site/` (new): server-rendered marketing pages. `home.ts`, `agent.ts` (one template, four assistants), `layout.ts` (header, footer, shell), `styles.ts` (CSS), `script.ts` (menus, hero rotor, mode switch, copy buttons, FAQ chips), `icons.ts`, `render.ts` (route table).
- `server/site.ts` (new) mounts those routes before the SPA fallback in `server/index.ts`. Signed-in users hitting `/` are redirected to `/today`.
- `script/build.ts` also writes the site as static files into `dist/` (`index.html`, `chatgpt/index.html`, ..., `_site/*`). `tsconfig.json` now includes `site/`.
- `server/site.test.ts`: every route renders, tags balance, one `h1`, agent pages say the connector is "planned".
- Layout fixes found while comparing: no sideways scroll at 390/768/1440, named links in collapsed menus, favicon, tile grid clipped to its row.
- Audit docs: a capability matrix and roadmap were drafted, then superseded by fuller versions in `docs/CAPABILITY_MATRIX.md` and `docs/ROADMAP.md` (written separately, not part of this commit). Read those, not this file, for capability status.

## Honest state

- Visual match to the reference, measured by `rebuild_check`: **47% on the current ContentForge-branded build** (home 36%, `/chatgpt` 52%, `/dots` 51%, `/claude` 48%, `/claude-cowork` 48%; structure similarity 59-68%). The target is 90%, so this is **not done**. Remaining gap is mostly imagery (the reference uses illustrated mascots and product screenshots; ours are CSS mockups), brand-specific wording, the "DM" font family name, and card counts per row at tablet widths.
- Type check and the new route test pass. The existing test suites (`npm test`, `npm run test:db`, e2e) were **not run**.
- The ContentForge MCP server does not exist. Only an MCP *client* does (`server/agent/external.ts`). The agent pages show a placeholder URL and say "planned".

## Pending

1. Re-run `rebuild_check` on the current build and close the gap to 90%. Biggest known gaps: the home tile strip (7 per row), card grid columns at each breakpoint, heading sizes (48px at 1440, 30px at 390), main font loaded as "DM Sans" where the original reports "DM", and the agent pages being much taller than the originals' structure (missing sections such as "Official app or custom MCP link", platform grids, "Other AI agents").
2. Build the MCP server over the existing 29 domain tools (roadmap phase B), then replace the placeholder URL on the agent pages.
3. Run the full test suites and promote capability-matrix rows to verified live.
4. Roadmap items in `docs/ROADMAP.md` (Opportunity Radar, second brain, one-click campaign, competitor intelligence, performance memory, editorial calendar).
5. Decide whether to delete the unmounted `site/postiz-*.ts` files (they are untracked).

## Traps

- Other people's uncommitted edits exist in `.gitignore`, `docs/*`, `package.json` and several `*.dbtest.ts` files. They are not part of this work and were left unstaged.
- `drizzle-kit generate` is broken; migrations are hand-written.
- Brand names and logos from the reference are not reused: channel tiles are neutral letter marks.
