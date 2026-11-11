/** Inline SVG icons and channel tiles for the marketing site. Original, neutral glyphs only. */

const s = (d: string, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;

export const I = {
  chevron: s('<path d="m7 10 5 5 5-5"/>'),
  arrows: s('<path d="m6 7 5 5-5 5M13 7l5 5-5 5"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  burger: s('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  chat: s('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>'),
  globe: s('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  link: s('<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>'),
  calendar: s('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>'),
  palette: s('<path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.6-.2-1-.5-1.4-.3-.4-.5-.8-.5-1.3 0-1.1.9-1.8 2-1.8h2.3A4.7 4.7 0 0 0 21 9.8C21 6 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>'),
  lock: s('<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
  search: s('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  edit: s('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/>'),
  image: s('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
  check: s('<path d="m5 12 5 5 9-10"/>'),
  layers: s('<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>'),
  bolt: s('<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>'),
  chart: s('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  repeat: s('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>'),
  shield: s('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/>'),
  terminal: s('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3M13 15h4"/>'),
  book: s('<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4V4ZM20 4h-6a3 3 0 0 0-3 3"/><path d="M20 4v14h-7"/>'),
  github: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 2.9.8.1-.6.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7c-.1-.3-.5-1.3.1-2.7 0 0 .9-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .6 1.4.2 2.4.1 2.7a3.9 3.9 0 0 1 1 2.7c0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2Z"/></svg>',
  heart: '<svg viewBox="0 0 57 51" fill="none" stroke="#e879f9" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M28 47C10 33 3 24 5 14 7 5 18 2 25 9l3 4 3-4c7-7 18-4 20 5 2 10-5 19-23 33Z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7L8 5Z"/></svg>',
  rss: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="18" r="2.2"/><path d="M4 10.5a9.5 9.5 0 0 1 9.5 9.5h-2.6A6.9 6.9 0 0 0 4 13.1v-2.6Zm0-5.3A14.8 14.8 0 0 1 18.8 20h-2.6A12.2 12.2 0 0 0 4 7.8V5.2Z"/></svg>',
};

/** Hand-drawn doodles (purely decorative). */
export const DOODLE = {
  squiggle: '<svg viewBox="0 0 242 180" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M0 2c40 0 80 20 96 50 12 24-8 50-40 46-34-4-44-38-16-50 30-14 74 4 92 30 16 22 8 66-16 72-22 6-28-24-8-44 22-22 70-30 100-20 14 4 26 12 34 22"/></svg>',
  sparkle: '<svg viewBox="0 0 136 187" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round" aria-hidden="true"><path d="M48 103c2 18 7 28 32 33-25 5-30 15-32 33-2-18-7-28-32-33 25-5 30-15 32-33Z"/><path d="M136 1c-30 8-44 22-48 38 18-6 30 0 34 14 6 22-2 48 14 76"/></svg>',
  underline: '<svg viewBox="0 0 320 22" fill="none" stroke="#5b8cff" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M2 8c90-6 210-8 314-4M62 19c80-6 170-8 240-6"/></svg>',
  loop: '<svg viewBox="0 0 92 98" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M26 96C6 70 2 36 18 14 34-6 58 12 44 40 34 60 18 62 18 56c0-8 30-4 70 4"/><path d="M80 52l9 8-11 6"/></svg>',
  laurel: '<svg viewBox="0 0 20 51" fill="none" stroke="#fff" stroke-width="1.4" aria-hidden="true"><path d="M16 49C6 41 3 27 7 3"/><path d="M8 10c-4-1-6-4-6-7 4 1 6 4 6 7ZM7 19c-4 0-6-3-7-6 4 0 6 3 7 6ZM7 28c-4 1-6-2-7-5 4-1 6 2 7 5ZM9 37c-3 2-6 0-8-3 4-1 7 1 8 3ZM13 44c-2 3-6 2-8 0 3-2 6-2 8 0Z"/></svg>',
};

/** The ContentForge mark: an anvil-spark "F". Original artwork. */
export const LOGO =
  '<span class="logo-mark"><svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M6 3h12v4H10v3h6v4h-6v7H6V3Z"/></svg></span>';

export type Agent = { key: string; name: string; bg: string; fg: string; svg: string };

/** Neutral stand-ins for assistant products (no third-party logos). */
export const AGENT_GLYPH: Record<string, string> = {
  chatgpt: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><circle cx="24" cy="24" r="8"/><circle cx="24" cy="12" r="8"/><circle cx="34.4" cy="30" r="8"/><circle cx="13.6" cy="30" r="8"/></svg>',
  claude: '<svg viewBox="0 0 48 48" fill="currentColor" aria-hidden="true">' +
    Array.from({ length: 10 }, (_, i) => `<rect x="22.5" y="4" width="3" height="18" rx="1.5" transform="rotate(${i * 36} 24 24)"/>`).join("") +
    "</svg>",
  dots: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="7" aria-hidden="true"><circle cx="24" cy="24" r="13"/></svg>',
  cowork: '<svg viewBox="0 0 48 48" fill="currentColor" aria-hidden="true"><rect x="6" y="10" width="36" height="24" rx="4" fill="none" stroke="currentColor" stroke-width="3"/><path d="M16 40h16"/>' +
    Array.from({ length: 8 }, (_, i) => `<rect x="23" y="13" width="2" height="9" rx="1" transform="rotate(${i * 45} 24 22)"/>`).join("") +
    "</svg>",
  gemini: '<svg viewBox="0 0 48 48" fill="currentColor" aria-hidden="true"><path d="M24 4c1.5 11 9 18.5 20 20-11 1.5-18.5 9-20 20-1.5-11-9-18.5-20-20 11-1.5 18.5-9 20-20Z"/></svg>',
  code: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 16-8 8 8 8M34 16l8 8-8 8M27 10l-6 28"/></svg>',
  local: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><rect x="8" y="8" width="32" height="32" rx="6"/><path d="M8 20h32M20 20v20"/></svg>',
  workspace: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><circle cx="16" cy="18" r="6"/><circle cx="32" cy="18" r="6"/><path d="M6 38c2-7 6-10 10-10s8 3 10 10M22 38c2-7 6-10 10-10s8 3 10 10"/></svg>',
};

export const ROTOR: { name: string; bg: string; svg: string }[] = [
  { name: "ChatGPT", bg: "#3f9f87", svg: AGENT_GLYPH.chatgpt.replace("currentColor", "#fff") },
  { name: "Claude", bg: "#d4774d", svg: AGENT_GLYPH.claude.replace("currentColor", "#fff") },
  { name: "Gemini", bg: "#3c6be0", svg: AGENT_GLYPH.gemini.replace("currentColor", "#fff") },
  { name: "AI agents", bg: "#7c3aed", svg: AGENT_GLYPH.workspace.replace(/currentColor/g, "#fff") },
];

/** Channels ContentForge publishes to (registered adapters) and sources it researches. */
export type Tile = { key: string; label: string; glyph: string; bg: string; fg?: string; kind: "channel" | "source" | "service" };
const yt = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 7v10l8-5-8-5Z"/></svg>';
export const TILES: Tile[] = [
  { key: "x", label: "X", glyph: "X", bg: "#000", kind: "channel" },
  { key: "linkedin", label: "LinkedIn", glyph: "in", bg: "#0a66c2", kind: "channel" },
  { key: "threads", label: "Threads", glyph: "@", bg: "#000", kind: "channel" },
  { key: "instagram", label: "Instagram", glyph: "IG", bg: "linear-gradient(135deg,#f58529,#dd2a7b 50%,#8134af)", kind: "channel" },
  { key: "youtube", label: "YouTube", glyph: yt, bg: "#ff0033", kind: "channel" },
  { key: "rss", label: "RSS feeds", glyph: I.rss, bg: "#f59e0b", kind: "source" },
  { key: "reddit", label: "Reddit", glyph: "r/", bg: "#ff4500", kind: "source" },
  { key: "hn", label: "Hacker News", glyph: "Y", bg: "#ff6600", kind: "source" },
  { key: "web", label: "Web pages", glyph: I.globe, bg: "#2563eb", kind: "source" },
  { key: "video", label: "Video transcripts", glyph: I.play, bg: "#dc2626", kind: "source" },
  { key: "last30", label: "Last 30 days", glyph: "30", bg: "#111", fg: "#a3e635", kind: "source" },
  { key: "factory", label: "Video Factory", glyph: "VF", bg: "#7c3aed", kind: "service" },
];

export function tile(t: Tile, style = ""): string {
  const bg = t.bg.startsWith("linear") ? `background-image:${t.bg}` : `background:${t.bg}`;
  return `<span class="ch" style="${bg};color:${t.fg ?? "#fff"};${style}" role="img" aria-label="${t.label}" title="${t.label}">${t.glyph}</span>`;
}
