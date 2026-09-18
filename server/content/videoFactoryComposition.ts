/**
 * Provider-native Video Factory job package (Phase 27.1).
 *
 * The factory runner (`npx hyperframes@0.7.60 render`) requires a composition
 * entrypoint (`index.html`) in the job folder. That HTML is generated here, at
 * the adapter boundary, from the bounded textual contract. ContentForge domain
 * models never see HyperFrames, GSAP, Chrome, or FFmpeg.
 *
 * Title, brief, and script are interpolated as escaped text nodes only.
 * User/AI content is DATA: it cannot introduce tags, event handlers, or
 * extra scripts.
 */

import { dimensionsForFormat, type VideoFactoryJobRequest } from "./videoFactoryContract";

const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 15_000;
const DEFAULT_DURATION_MS = 3_000;

export function compositionDurationMs(request: VideoFactoryJobRequest): number {
  const raw = request.durationMs;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= MIN_DURATION_MS) {
    return Math.min(raw, MAX_DURATION_MS);
  }
  return DEFAULT_DURATION_MS;
}

export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstLine(value: string, max: number): string {
  const line = value.split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? value.trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Deterministic HyperFrames-compatible composition. The runner looks for
 * `index.html` at the job root (or `public/index.html`).
 */
export function renderVideoFactoryCompositionHtml(request: VideoFactoryJobRequest): string {
  const dims = dimensionsForFormat(request.format);
  const durationMs = compositionDurationMs(request);
  const durationSec = Math.round((durationMs / 1000) * 10) / 10;
  const title = escapeHtmlText(firstLine(request.title, 80));
  const brief = escapeHtmlText(firstLine(request.brief, 180));
  const scriptLine = request.script ? escapeHtmlText(firstLine(request.script, 160)) : brief;
  const jobId = escapeHtmlText(request.jobId);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta name="viewport" content="width=${dims.width}, height=${dims.height}, initial-scale=1.0">
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    body {
      background: #090a0f;
      color: #ffffff;
      font-family: ui-sans-serif, system-ui, sans-serif;
      overflow: hidden;
      width: ${dims.width}px;
      height: ${dims.height}px;
    }
    #root {
      position: relative;
      width: ${dims.width}px;
      height: ${dims.height}px;
      background: radial-gradient(circle at 50% 18%, #1a1e36 0%, #08090e 100%);
      overflow: hidden;
    }
    .scene {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 12%;
      text-align: center;
      opacity: 0;
    }
    .kicker {
      font-size: ${Math.round(dims.width * 0.028)}px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #93c5fd;
      font-weight: 700;
      margin-bottom: 28px;
    }
    .title {
      font-size: ${Math.round(dims.width * 0.072)}px;
      font-weight: 800;
      line-height: 1.1;
      max-width: 90%;
    }
    .body {
      margin-top: 36px;
      font-size: ${Math.round(dims.width * 0.032)}px;
      line-height: 1.4;
      color: rgba(255,255,255,0.82);
      max-width: 86%;
    }
  </style>
</head>
<body>
  <div id="root" data-composition-id="root" data-width="${dims.width}" data-height="${dims.height}" data-duration="${durationSec}">
    <div class="scene clip" id="scene0" data-start="0" data-duration="${durationSec}">
      <div class="kicker" id="kicker">${jobId}</div>
      <h1 class="title" id="headline">${title}</h1>
      <p class="body" id="bodycopy">${scriptLine}</p>
    </div>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.fromTo("#scene0", { opacity: 0 }, { opacity: 1, duration: 0.35, ease: "power2.out" }, 0);
    tl.fromTo("#kicker", { y: -24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, 0.08);
    tl.fromTo("#headline", { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45 }, 0.16);
    tl.fromTo("#bodycopy", { opacity: 0 }, { opacity: 1, duration: 0.35 }, 0.28);
    window.__timelines = window.__timelines || {};
    window.__timelines["root"] = tl;
  </script>
</body>
</html>
`;
}

export function renderVideoFactoryCompositionMeta(request: VideoFactoryJobRequest): string {
  const dims = dimensionsForFormat(request.format);
  const durationSec = compositionDurationMs(request) / 1000;
  return `${JSON.stringify({ width: dims.width, height: dims.height, fps: 30, duration: durationSec }, null, 2)}\n`;
}
