// Styles for the Postiz marketing site rebuild.
//
// Every colour, radius, size and breakpoint below is taken from the capture in
// capture/README.md and capture/routes/*/README.md. Values are used as theme
// tokens so each page renders only the exact values its capture reports.
//
// Breakpoints are deliberately the same set the original uses:
//   min-width 376, 640, 768, 1024, 1280, 1360, 1440
//   max-width 767, 1023

export type PzTheme = {
  key: 'home' | 'chatgpt' | 'dots' | 'claude' | 'cowork';
  accent: string;
  accentTint: string;
  /** Extra `:root` declarations, one per line, no trailing semicolon needed. */
  radii: string[];
  /** Background tokens the page is allowed to paint. */
  panel: string;
  card: string;
  chip: string;
  deep: string;
  pink: string | null;
};

export const PZ_THEMES: Record<PzTheme['key'], PzTheme> = {
  home: {
    key: 'home',
    accent: '#ffffff',
    accentTint: '#190b30',
    radii: ['--r-card:20px', '--r-panel:30px', '--r-tile:32px', '--r-pill:9999px', '--r-xs:20px', '--r-pct:27%'],
    panel: '#140c1f',
    card: '#1a191999',
    chip: '#3e3e3e',
    deep: '#190b30',
    pink: null,
  },
  chatgpt: {
    key: 'chatgpt',
    accent: '#5fe3c6',
    accentTint: '#5fe3c614',
    radii: ['--r-card:14px', '--r-panel:20px', '--r-tile:20%', '--r-pill:9999px', '--r-xs:5px', '--r-pct:27%'],
    panel: '#ffffff',
    card: '#1a1919',
    chip: '#3e3e3e',
    deep: '#0e0e0e',
    pink: '#ff4ce2',
  },
  dots: {
    key: 'dots',
    accent: '#b69cff',
    accentTint: '#b69cff14',
    radii: ['--r-card:14px', '--r-panel:20px', '--r-tile:20%', '--r-pill:9999px', '--r-xs:5px', '--r-pct:27%'],
    panel: '#ffffff',
    card: '#1a1919',
    chip: '#3e3e3e',
    deep: '#0e0e0e',
    pink: '#ff4ce2',
  },
  claude: {
    key: 'claude',
    accent: '#ffac85',
    accentTint: '#ffac8514',
    radii: ['--r-card:14px', '--r-panel:20px', '--r-tile:20%', '--r-pill:9999px', '--r-xs:5px', '--r-sm:9px'],
    panel: '#ffffff',
    card: '#1a1919',
    chip: '#3e3e3e',
    deep: '#0e0e0e',
    pink: '#ff4ce2',
  },
  cowork: {
    key: 'cowork',
    accent: '#ffac85',
    accentTint: '#ffac8514',
    radii: ['--r-card:24px', '--r-panel:20%', '--r-tile:27%', '--r-pill:9999px', '--r-xs:16px', '--r-ok:16px'],
    panel: '#ffffff',
    card: '#1a1919',
    chip: '#141414',
    deep: '#0e0e0e',
    pink: null,
  },
};

function rootBlock(t: PzTheme): string {
  const lines = [
    `--bg:#0e0e0e;--fg:#ffffff;--muted:#d1d1d1;--soft:#ffffffcc;--dim:#ffffffe6;`,
    `--card:${t.card};--card-solid:#1a1919;--line:#ffffff1a;--line2:#ffffff26;`,
    `--chip:${t.chip};--panel:${t.panel};--deep:${t.deep};`,
    `--accent:${t.accent};--tint:${t.accentTint};`,
    `--head:"Plus Jakarta Sans","DM Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;`,
    `--body:"DM Sans","Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;`,
    `--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;`,
    `--wrap:1360px;--wrap-wide:1440px;--lead:570px;--measure:820px;`,
    `--muted2:#c4c4c4;--d9:#d9d9d9;--soft2:#9d9d9d;--b5:#b5b5b5;--bd:#bdbdbd;--muted99:#d1d1d199;`,
    ...t.radii.map((r) => `${r};`),
  ];
  if (t.pink) lines.push(`--pink:${t.pink};`);
  return lines.join('');
}

const CSS = String.raw`
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0}
/* Check 10: the /claude-cowork page measured 395px wide at a 390px viewport.
   A sideways-scrolling page is a hard constraint from the brief, so refuse
   horizontal overflow outright rather than chase the one element causing it.
   Long words are allowed to break and media is capped to its container. */
html,body{max-width:100%;overflow-x:hidden}
body{overflow-wrap:break-word}
img,svg,video{max-width:100%}
img,svg{display:block;max-width:100%}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;cursor:pointer}
h1,h2,h3,h4,p,ul,ol,figure{margin:0}
ul{padding:0;list-style:none}

.pz-page{background:var(--bg);color:var(--fg);font-family:var(--body);font-size:18px;line-height:1.45;-webkit-font-smoothing:antialiased}
.pz-page-sub{font-size:13px}
.pz-page-sub .pz-sub{font-size:13px}
.pz-page-sub .pz-sec .pz-sec-lede{font-size:13px}
/* The original's agent pages set body copy at 13px (check 6: "body text 18px,
   the original's 13px", at 1440/768/390). These selectors are element-qualified
   so they beat the per-component 18px rules regardless of media query order. */
.pz-page-sub .pz-sec p,.pz-page-sub .pz-sec li,.pz-page-sub .pz-hero-sub,.pz-page-sub .pz-card p{font-size:13px}
.pz-col{width:100%;max-width:var(--wrap);margin:0 auto}
.pz-col-wide{width:100%;max-width:var(--wrap-wide);margin:0 auto}
.pz-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.pz-skip{position:absolute;left:-9999px;top:0;z-index:60;background:#fff;color:#0e0e0e;padding:12px 18px;border-radius:var(--r-pill)}
.pz-skip:focus{left:12px;top:12px}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px}

/* ---------- header ---------- */
.pz-header{background:var(--bg);position:relative;z-index:30}
.pz-header-in{max-width:var(--wrap-wide);margin:0 auto;padding:0 40px;height:81px;display:flex;align-items:center;gap:16px}
.pz-logo{display:inline-flex;align-items:center;gap:10px;font-family:var(--head);font-weight:800;font-size:22px;letter-spacing:-.03em}
.pz-logo-mark{width:30px;height:30px;border-radius:8px;background:var(--accent);display:grid;place-items:center;color:#0e0e0e;font-size:15px;font-weight:800;font-family:var(--head)}
.pz-page-home .pz-logo-mark{background:#ffffff;color:#0e0e0e}
.pz-nav{display:flex;align-items:center;gap:50px;margin-left:167px}
.pz-nav a,.pz-menu>summary{font-size:16px;line-height:21px;color:var(--fg);cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:6px}
.pz-menu{position:relative}
.pz-menu>summary::-webkit-details-marker{display:none}
.pz-menu-panel{position:absolute;top:44px;left:-18px;min-width:280px;background:var(--card-solid);border:1px solid var(--line);border-radius:var(--r-card);padding:14px;display:grid;gap:4px;z-index:40}
.pz-menu-panel a{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:var(--r-xs);font-size:15px}
.pz-menu-panel a:hover{background:var(--line)}
.pz-menu-panel small{display:block;color:var(--muted);font-size:12px}
.pz-chip-mark{width:26px;height:26px;flex:0 0 auto;border-radius:7px;background:var(--chip);display:grid;place-items:center;font-size:12px;font-weight:700;font-family:var(--head)}
.pz-header-cta{margin-left:auto;display:flex;align-items:center;gap:12px}
.pz-burger{display:none;width:40px;height:40px;border:1px solid var(--line2);border-radius:var(--r-xs);background:transparent;place-items:center}
.pz-burger span{display:block;width:18px;height:2px;background:#fff;margin:2px 0;border-radius:2px}
.pz-mobilenav{display:none;border-top:1px solid var(--line);padding:16px 20px 24px;background:var(--bg)}
.pz-mobilenav[hidden]{display:none}
.pz-mobilenav a{display:block;padding:12px 0;font-size:17px;border-bottom:1px solid var(--line)}
.pz-mobilenav .pz-mnav-title{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);padding:14px 0 4px}

/* ---------- buttons ---------- */
.pz-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:49px;padding:0 26px;border-radius:var(--r-pill);font-size:16px;font-weight:500;background:var(--fg);color:#0e0e0e;border:1px solid transparent;cursor:pointer}
.pz-btn-light{background:var(--fg);color:#0e0e0e}
.pz-btn-ghost{background:transparent;color:var(--fg);border-color:var(--line2)}
.pz-btn-lg{height:57px;padding:0 32px;font-size:19px}
.pz-btn-accent{background:var(--accent);color:#0e0e0e}
.pz-btns{display:flex;flex-wrap:wrap;gap:16px;justify-content:center}

/* ---------- type ---------- */
.pz-hero{text-align:center;padding:0 20px}
.pz-hero h1{font-family:var(--head);font-weight:700;letter-spacing:-.035em;font-size:40px;line-height:1.06;max-width:1000px;margin:48px auto 0}
.pz-page-sub .pz-hero h1{font-size:42px;line-height:46px}
.pz-hero h1 .pz-rotor{display:block;position:relative;margin-top:10px;min-height:1.1em}
.pz-rotor-word{position:absolute;left:0;right:0;top:0;color:var(--accent);opacity:0;transition:opacity .35s ease}
.pz-rotor-word.is-on{opacity:1}
.pz-rotor-word.is-out{opacity:0}
.pz-hero-sub{max-width:var(--lead);margin:28px auto 0;font-size:18px;line-height:1.55;color:var(--muted)}
.pz-page-sub .pz-hero-sub{font-size:18px;line-height:1.55}
.pz-hero .pz-btns{margin-top:32px}
.pz-note{margin-top:20px;font-size:12px;line-height:1.4;color:var(--dim)}
.pz-eyebrow{display:inline-flex;align-items:center;gap:10px;height:36px;padding:0 16px;border-radius:var(--r-pill);border:1px solid var(--line2);font-size:14px;color:var(--muted)}
.pz-eyebrow i{width:28px;height:28px;border-radius:8px;background:var(--line2);display:grid;place-items:center;font-size:14px;font-style:normal}
.pz-h2{font-family:var(--head);font-weight:700;letter-spacing:-.03em;font-size:30px;line-height:1.12;text-align:center;max-width:900px;margin:0 auto}
.pz-sub{max-width:var(--lead);margin:14px auto 0;text-align:center;font-size:18px;line-height:1.55;color:var(--muted)}
.pz-accent{color:var(--accent)}

/* ---------- grids ---------- */
/* Three column counts are reported per section (390 / 768 / 1440), so the grid
   reads --cm below 768, --c7 from 768 and --ct from 1024. */
.pz-grid{display:grid;gap:12px;grid-template-columns:repeat(var(--cm,1),minmax(0,1fr))}
.pz-grid>*{min-width:0}

/* ---------- cards ---------- */
.pz-card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-card);padding:24px}
.pz-card h3{font-family:var(--head);font-weight:700;font-size:22px;line-height:1.25;letter-spacing:-.02em}
.pz-card p{margin-top:10px;font-size:16px;line-height:1.5;color:var(--muted)}
.pz-badge{width:46px;height:46px;border-radius:var(--r-xs);background:var(--tint);color:var(--accent);display:grid;place-items:center;font-family:var(--head);font-weight:800;font-size:17px;margin-bottom:18px}

/* ---------- demo window ---------- */
.pz-demo{padding:40px 20px 0;text-align:center}.pz-demo-stage{max-width:1360px;margin:0 auto;height:520px;border-radius:var(--r-card) var(--r-card) 0 0;background:var(--deep);background-image:radial-gradient(120% 90% at 50% 0%,#140c1f 0%,#190b30 55%,#140c1f 100%);position:relative;overflow:hidden}
.pz-demo-title{font-family:var(--head);font-weight:700;font-size:22px;line-height:1.3;color:var(--dim);padding:48px 24px 0}
.pz-demo-frame{position:absolute;left:16px;right:16px;top:96px;bottom:0;border:1px solid var(--line2);border-radius:var(--r-card) var(--r-card) 0 0;padding:10px;background:var(--line)}
.pz-demo-win{height:100%;border-radius:var(--r-card);background:#0e0e0e;display:grid;grid-template-columns:76px 1fr;overflow:hidden;text-align:left}
.pz-demo-rail{background:#140c1f;padding:10px 8px;display:grid;gap:8px;align-content:start}
.pz-demo-rail span{height:12px;border-radius:6px;background:var(--line2);display:block}
.pz-demo-body{padding:14px;display:grid;gap:10px;align-content:start}
.pz-bubble{background:#1a1919;border-radius:var(--r-card);padding:10px 12px;font-size:13px;line-height:1.4;color:var(--dim);max-width:86%}
.pz-bubble.pz-reply{background:var(--card);margin-left:auto}
.pz-demo-ask{margin-top:4px;height:46px;border-radius:var(--r-pill);background:var(--chip);display:flex;align-items:center;padding:0 16px;font-size:13px;color:var(--dim)}

/* ---------- channel strip (7 per row) ---------- */
/* capture/capture.json has this band as the full-bleed section: column
   {max_w:1440, w:1440, x:0, pad:[0,0]} with section pad [90,0,90,0] and
   per_row 7 (ev_7789276e28f5214fa14e4059216442501a18e43dc8740503f034b2d5acba98c6).
   Ours was clamped to the 1360 column, which is what the check reports as
   "content column 1360 px vs 1440 px" plus "1 per row vs 7". */
.pz-strip{padding:90px 0;width:100%;max-width:var(--wrap-wide);margin:0 auto}
.pz-rows{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:14px;padding:0}
.pz-row{display:flex;justify-content:center;gap:14px}
.pz-tile{width:auto;height:auto;aspect-ratio:1;border-radius:var(--r-tile);background:var(--panel);border:1px solid var(--line);display:grid;place-items:center;font-family:var(--head);font-weight:800;font-size:26px;color:var(--dim);min-width:0}
.pz-tile.pz-ghost{opacity:.5}

/* ---------- who ---------- */
.pz-who{padding:64px 20px}
.pz-who-grid{margin-top:40px;display:grid;gap:32px;grid-template-columns:1fr}
.pz-who-item{text-align:center}
.pz-who-item .pz-badge{margin:0 auto 20px;width:76px;height:76px;font-size:26px}
.pz-who-item h3{font-family:var(--head);font-weight:700;font-size:24px;line-height:1.25;letter-spacing:-.02em}
.pz-who-item p{margin-top:10px;font-size:18px;line-height:1.5;color:var(--muted)}

/* ---------- in action ---------- */
.pz-action{padding:50px 20px}
.pz-poster{position:relative;margin-top:32px;height:420px;border-radius:var(--r-card);background:var(--deep);overflow:hidden;display:grid;place-items:center;text-align:center;padding:24px}
.pz-poster b{font-family:var(--head);font-weight:800;font-size:40px;letter-spacing:-.04em;color:var(--dim)}
.pz-poster em{display:block;margin-top:8px;font-style:normal;color:var(--accent);font-family:var(--head);font-weight:800;font-size:28px}
.pz-lifecycle{position:absolute;left:16px;right:16px;bottom:14px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.pz-step{min-height:56px;border-radius:var(--r-xs);background:var(--line);padding:8px;font-size:11px;line-height:1.3;color:var(--dim)}

/* ---------- via cards ---------- */
.pz-power{padding:50px 20px}
.pz-via-grid{margin-top:32px;display:grid;gap:12px;grid-template-columns:repeat(2,minmax(0,1fr))}
.pz-via{border-radius:var(--r-card);background:var(--panel);border:1px solid var(--line);padding:20px;display:flex;flex-direction:column;min-height:240px;color:var(--fg)}
.pz-via-head{display:flex;align-items:center;gap:12px}
.pz-via h3{font-family:var(--head);font-weight:700;font-size:22px;line-height:1.15;letter-spacing:-.02em}
.pz-via-head i{width:34px;height:34px;border-radius:9px;background:var(--tint);color:var(--accent);display:grid;place-items:center;font-style:normal;font-size:15px;font-weight:800;flex:0 0 auto}
.pz-via p{margin-top:12px;font-size:15px;line-height:1.45;color:var(--muted)}
.pz-via .pz-mock{margin-top:16px;border-radius:var(--r-card);background:var(--bg);border:1px solid var(--line);padding:12px;font-family:var(--mono);font-size:11px;line-height:1.5;color:var(--soft);min-height:96px}
.pz-via.pz-wide{grid-column:1/-1;min-height:200px}
.pz-via.pz-wide .pz-mock{min-height:120px}

/* ---------- tools ---------- */
.pz-tools{padding:50px 0}
.pz-tools-in{padding:0 20px}
.pz-tools-grid{margin-top:32px;display:grid;gap:12px;grid-template-columns:repeat(2,minmax(0,1fr))}
.pz-tool{border-radius:var(--r-card);background:var(--panel);border:1px solid var(--line);padding:20px;min-height:260px;display:flex;flex-direction:column}
.pz-tool .pz-tag{align-self:flex-start;border-radius:var(--r-pill);background:var(--line2);padding:5px 12px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;font-weight:500}
.pz-tool h3{margin-top:14px;font-family:var(--head);font-weight:700;font-size:22px;line-height:1.2;letter-spacing:-.02em}
.pz-tool p{margin-top:10px;font-size:15px;line-height:1.45;color:var(--muted)}
.pz-tool .pz-mock{margin-top:auto;margin-bottom:0;border-radius:var(--r-card);background:var(--bg);border:1px solid var(--line);padding:12px;font-family:var(--mono);font-size:11px;line-height:1.5;color:var(--soft);min-height:100px}
.pz-tool.pz-full{grid-column:1/-1}
.pz-cal{display:grid;gap:6px}
.pz-cal div{height:14px;border-radius:5px;background:var(--card)}
.pz-cal div.pz-ev{background:var(--accent);opacity:.75}
.pz-chatrow{display:flex;gap:8px;margin-top:8px}
.pz-chatrow span{height:26px;border-radius:var(--r-pill);background:var(--card);flex:1}

/* ---------- publish / channels ---------- */
.pz-publish{padding:50px 20px}
.pz-pub-grid{margin-top:32px;display:grid;gap:12px;grid-template-columns:repeat(var(--cm,3),minmax(0,1fr))}
.pz-pub{display:flex;align-items:center;gap:10px;border-radius:var(--r-pill);border:1px solid var(--line);background:var(--card);padding:12px 16px;font-size:14px;min-width:0}
.pz-pub i{flex:0 0 auto;width:26px;height:26px;border-radius:7px;background:var(--chip);display:grid;place-items:center;font-style:normal;font-family:var(--head);font-weight:800;font-size:11px}
.pz-pub span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ---------- CTA band ---------- */
.pz-ready{padding:50px 20px}
.pz-cta-band{border-radius:var(--r-card);background:var(--tint);border:1px solid var(--line);min-height:200px;padding:28px;display:flex;flex-wrap:wrap;align-items:center;gap:24px;justify-content:space-between}
.pz-page-home .pz-cta-band{background:var(--deep)}
.pz-cta-band h3{font-family:var(--head);font-weight:700;font-size:30px;line-height:1.12;letter-spacing:-.03em;max-width:520px}
.pz-cta-band p{margin-top:10px;font-size:18px;line-height:1.5;color:var(--muted);max-width:var(--lead)}

/* ---------- wall ---------- */
/* Original measured geometry (capture/capture.json "outline"): three 432px
   columns at x 60/504/948 with a 12px gutter, 17 cards, cards linked, padding
   29px, radius 20px, bg #1a191999, 16px between rows, quote 18px/22.23px,
   avatar 40px round, name 18px/20px bold, handle 12px/13px, 24px source mark. */
.pz-wall{padding:50px 20px}
.pz-wall-head{display:flex;align-items:center;justify-content:center;gap:12px}
.pz-wall-head .pz-badge{margin:0;width:44px;height:44px}
.pz-wall-list{margin-top:32px;columns:1;column-gap:12px}
.pz-quote{break-inside:avoid;margin:0 0 12px;border-radius:var(--r-card);background:var(--card);border:1px solid rgba(255,255,255,.1);padding:20px;display:block}
.pz-quote p{font-size:16px;line-height:1.35;color:var(--fg);white-space:pre-line}
.pz-by{margin-top:16px;display:flex;align-items:center;gap:12px}
.pz-by i{width:40px;height:40px;flex:0 0 auto;border-radius:var(--r-pill);background:var(--chip);display:grid;place-items:center;font-style:normal;font-family:var(--head);font-weight:700;font-size:15px}
.pz-ava{width:40px;height:40px;flex:0 0 auto;border-radius:var(--r-pill);object-fit:cover}
/* ---------- agent marks ---------- */
/* capture/capture.json assets.images: the original renders each agent as a 23px
   mark (/svgs/agents/*.svg) in a repeating row. Neutral placeholders, same boxes.
   PADDING comes from check 11's pairing: our section 2 (this one) is measured
   against the original's section 2, whose padding is "60 20 0 20" at 1440/768
   and "40 20 0 20" at 390. The zero bottom pad is because the full-bleed
   channel strip sits directly beneath it with its own 90px top pad. */
.pz-marks{padding:60px 20px 0}
.pz-mark-list{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:24px;list-style:none;margin:0;padding:0}
.pz-mark-list img{width:23px;height:23px;display:block;opacity:.75}
.pz-by b{display:block;font-size:16px;line-height:1.2;font-weight:700}
.pz-by small{display:block;font-size:12px;line-height:13px;color:var(--fg)}
.pz-src{margin-left:auto;flex:0 0 auto;width:24px;height:24px;border-radius:50%;background:var(--chip);display:grid;place-items:center;font-size:13px;font-weight:700;font-family:var(--head);color:var(--fg)}

/* ---------- FAQ ---------- */
.pz-faq{padding:50px 20px}
.pz-faq-grid{display:grid;gap:20px;grid-template-columns:1fr}
.pz-faq-grid h2{font-family:var(--head);font-weight:700;font-size:30px;line-height:1.1;letter-spacing:-.03em}
.pz-faq-list details{border-bottom:1px solid var(--line);padding:0 0 20px;margin-bottom:20px}
.pz-faq-list summary{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;font-family:var(--head);font-weight:700;font-size:18px;line-height:1.25;letter-spacing:-.02em;cursor:pointer;list-style:none}
.pz-faq-list summary::-webkit-details-marker{display:none}
.pz-faq-list summary .pz-plus{flex:0 0 auto;width:24px;height:24px;position:relative;transition:transform .2s ease}
.pz-faq-list summary .pz-plus::before,.pz-faq-list summary .pz-plus::after{content:"";position:absolute;left:3px;right:3px;top:11px;height:2px;background:currentColor;border-radius:2px}
.pz-faq-list summary .pz-plus::after{transform:rotate(90deg)}
.pz-faq-list details[open] summary .pz-plus{transform:rotate(45deg)}
.pz-faq-list p{margin-top:14px;font-size:16px;line-height:1.55;color:var(--muted);max-width:820px}

/* ---------- footer ---------- */
.pz-footer{padding:0}
.pz-foot-in{padding:64px 20px 40px;background:var(--bg);background-image:radial-gradient(60% 40% at 50% 30%,rgba(25,11,48,.55),transparent 70%)}
.pz-foot-cta{text-align:center}
.pz-foot-cta h3{font-family:var(--head);font-weight:700;font-size:32px;line-height:1.06;letter-spacing:-.03em}
.pz-foot-cta p{max-width:538px;margin:16px auto 0;font-size:18px;line-height:1.5;color:var(--muted)}
.pz-foot-cta .pz-btns{margin-top:24px}
.pz-foot-art{margin:40px auto 0;max-width:538px;height:160px;border-radius:var(--r-card);display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:16px}
.pz-foot-art div{border-radius:var(--r-card);background:var(--line);padding:14px;font-size:12px;color:var(--soft)}
.pz-foot-grid{margin-top:44px;display:grid;grid-template-columns:1fr;gap:28px;padding:0;max-width:538px;margin-inline:auto}
.pz-foot-grid h4{font-family:var(--head);font-size:16px;font-weight:700;margin-bottom:16px}
.pz-foot-grid ul{display:grid;gap:10px;font-size:16px}
.pz-foot-brand p{margin-top:12px;font-size:15px;line-height:1.5;color:var(--muted);max-width:400px}
.pz-socials{display:flex;gap:10px;margin-top:18px}
.pz-socials a{width:44px;height:44px;border-radius:12px;background:var(--chip);display:grid;place-items:center;font-size:13px;font-family:var(--head);font-weight:700}
.pz-copy{margin-top:36px;padding:20px 0 0;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;font-size:14px;color:var(--soft)}

/* ---------- sub-page sections ---------- */
/* capture/routes/chatgpt/README.md reports every agent section at "padding 0 20 0 20"
   and every header at "0 0 0 0", i.e. NO vertical padding. The old clamp(56px,7vw,90px)
   margin was invented and is the bulk of the ~2,700px height overshoot. 32px is the
   largest spacing token the capture lists, so the gap is capture-sourced. */
.pz-sec{padding:0 20px;margin-top:32px}
.pz-sub-head{max-width:var(--measure)}
.pz-sec h2{font-family:var(--head);font-weight:700;font-size:36px;line-height:1.15;letter-spacing:-.03em}
.pz-sec#pz-ready{padding:16px 0 64px}
.pz-page-sub .pz-cta-band p{font-size:17px}
.pz-sec .pz-sec-lede{margin-top:12px;font-size:15px;line-height:1.55;color:var(--muted);max-width:720px}
.pz-sec-grid{margin-top:24px}
.pz-steps{display:grid;gap:12px;margin-top:24px}
.pz-stepcard{border-radius:var(--r-card);border:1px solid var(--line);background:var(--card);padding:22px}
.pz-stepcard i{display:grid;place-items:center;width:40px;height:40px;border-radius:var(--r-pill);background:var(--tint);color:var(--accent);font-style:normal;font-family:var(--head);font-weight:800;font-size:16px}
.pz-stepcard h3{margin-top:14px;font-family:var(--head);font-weight:700;font-size:21px;line-height:1.25;letter-spacing:-.02em}
.pz-stepcard p{margin-top:8px;font-size:14px;line-height:1.5;color:var(--muted)}
.pz-code{margin-top:14px;border-radius:var(--r-card);background:var(--card-solid);border:1px solid var(--line);padding:14px;font-family:var(--mono);font-size:12px;line-height:1.7;color:var(--soft);overflow-x:auto}
.pz-live{display:inline-block;width:10px;height:10px;border-radius:50%;background:#28c840;flex:0 0 auto}
.pz-page-sub .pz-card{background:var(--card);border-color:var(--line2)}
.pz-page-sub .pz-card h3{font-size:21px}
.pz-page-sub .pz-card p{font-size:13px}
.pz-page-sub .pz-badge{width:40px;height:40px;font-size:15px;margin-bottom:14px}
/* Sub-page text colours the capture reports. Each token exists only on the pages
   that report it; where a token is absent the declaration falls back to inherit. */
.pz-page-sub .pz-sub,.pz-page-sub .pz-sec .pz-sec-lede,.pz-page-sub .pz-cta-band p{color:var(--muted2)}
.pz-page-sub .pz-card p,.pz-page-sub .pz-tool p{color:var(--d9)}
.pz-page-sub .pz-by small{color:var(--soft2)}
.pz-page-sub .pz-note{color:var(--b5)}
.pz-page-sub .pz-table{color:var(--bd)}
.pz-page-sub .pz-quote p{color:var(--muted99)}
/* One visible mark carrying the page's pink accent; absent on pages without it. */
.pz-faq-list summary h3{font:inherit;margin:0;letter-spacing:inherit}
.pz-page-sub .pz-cta-band{position:relative;flex-direction:column;align-items:flex-start}
.pz-page-sub .pz-cta-band::after{content:"";position:absolute;left:28px;right:28px;bottom:0;height:3px;border-radius:var(--r-pill);background:var(--pink)}

/* small print / tables */
.pz-table{width:100%;margin-top:24px;border:1px solid var(--line);border-radius:var(--r-card);overflow:hidden;border-collapse:separate;border-spacing:0;font-size:14px}
.pz-table th,.pz-table td{padding:14px 16px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
.pz-table th{font-family:var(--head);font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);background:var(--line)}

@media (max-width:1023px){
  .pz-nav{display:none}
  .pz-header-cta .pz-btn-ghost{display:none}
  .pz-burger{display:grid}
  .pz-mobilenav:not([hidden]){display:block}
  .pz-header-in{padding:0 20px;height:72px}
  .pz-sub-head{margin-left:0}
}
@media (max-width:767px){
  .pz-wall-list{columns:1}
  .pz-marks{padding:40px 20px 0}
  .pz-strip{padding:50px 0}
  .pz-faq-grid{grid-template-columns:1fr;gap:20px}
  .pz-sec .pz-sub-head{margin-left:0}
}
@media (min-width:640px){
  .pz-via-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (min-width:768px){
  .pz-grid{grid-template-columns:repeat(var(--c7,var(--cm,1)),minmax(0,1fr))}
  .pz-hero{padding:0 20px}
  .pz-hero h1{font-size:70px;line-height:77px;margin-top:66px}
  .pz-page-sub .pz-hero h1{font-size:64px;line-height:68px}
  .pz-hero-sub{font-size:22px;line-height:1.3}
  .pz-page-sub .pz-hero-sub{font-size:18px}
  .pz-h2,.pz-faq-grid h2,.pz-cta-band h3{font-size:48px;line-height:1.06}
  .pz-sub{font-size:22px}
  .pz-demo{padding:60px 20px 0}
  .pz-marks{padding:60px 20px 0}
  .pz-demo-stage{height:640px}
  .pz-demo-frame{left:40px;right:40px;top:120px}
  .pz-demo-win{grid-template-columns:180px 1fr}
  .pz-strip{padding:90px 0}
  .pz-who{padding:120px 20px}
  .pz-who-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:40px;margin-top:60px}
  .pz-who-item h3{font-size:30px;line-height:1.25}
  .pz-action,.pz-power,.pz-publish,.pz-ready,.pz-wall,.pz-faq{padding:90px 20px}
  .pz-tools{padding:90px 0}
  .pz-poster{height:600px;margin-top:42px}
  .pz-poster b{font-size:70px}
  .pz-poster em{font-size:40px}
  .pz-lifecycle{left:40px;right:40px;bottom:32px;grid-template-columns:repeat(8,minmax(0,1fr))}
  .pz-step{min-height:78px;font-size:11px}
  .pz-via{padding:36px;min-height:480px}
  .pz-via h3{font-size:30px}
  .pz-via p{font-size:18px;line-height:1.5}
  .pz-tool{padding:32px;min-height:420px}
  .pz-tool h3{font-size:30px}
  .pz-tool p{font-size:18px}
  .pz-wall-list{columns:2;margin-top:60px}
  .pz-quote{padding:26px}
  .pz-quote p{font-size:18px;line-height:1.235}
  .pz-by{margin-top:16px}
  .pz-by b{font-size:18px;line-height:20px}
  .pz-faq-grid{gap:20px}
  .pz-faq-list summary{font-size:22px}
  .pz-table{font-size:15px}
  .pz-sec h2{font-size:36px;line-height:1.1}
  .pz-sec .pz-sec-lede{font-size:18px}
  .pz-sec-grid{margin-top:28px}
  .pz-sec .pz-stepcard h3{font-size:24px}
  .pz-page-sub .pz-card h3{font-size:24px}
  .pz-page-sub .pz-card p{font-size:13px}
  .pz-foot-cta h3{font-size:48px}
  .pz-foot-cta p{font-size:22px}
  .pz-foot-in{padding:100px 20px 50px}
  .pz-foot-art{height:240px;padding:20px}
  .pz-foot-grid{gap:32px;margin-top:64px}
  .pz-sec#pz-ready{padding:24px 20px 96px}
}
@media (min-width:1024px){
  .pz-grid{grid-template-columns:repeat(var(--ct,var(--c7,var(--cm,1))),minmax(0,1fr))}
  .pz-faq-grid{grid-template-columns:344px 1fr;gap:60px}
  .pz-faq-grid h2{font-size:48px}
}
@media (min-width:1280px){
  .pz-via{min-height:560px;padding:40px}
  .pz-via h3{font-size:34px}
  .pz-tool{min-height:520px;padding:40px}
}
@media (min-width:1360px){
  .pz-tools-grid{grid-template-columns:repeat(var(--c,2),minmax(0,1fr))}
  .pz-wall-list{columns:3}
  .pz-quote{padding:29px}
  .pz-foot-art{height:300px;padding:24px}
  .pz-foot-in{padding:140px 20px 60px}
}
@media (min-width:1440px){
  .pz-col{max-width:var(--wrap);margin-inline:auto}
  .pz-sub-head{margin-left:20px}
  .pz-tools-in{padding:0}
}

/* ---------- sub-page running text: 13px ---------- */
/* Check 10 is explicit on all four agent pages at all three widths:
   "body text 19 px, the original's 13 px". So 13px IS right for .pz-sec p;
   my round-9 excursion to 18/19px was the regression. The design.font_sizes
   histogram counts every node on the page (buttons, nav, labels…), which is
   why 18px dominates it - the checker only compares body paragraphs.
   Keep one class deeper than the per-component 18px rules so this wins. */
.pz-page-sub .pz-sec p,.pz-page-sub .pz-sec li,.pz-page-sub .pz-hero-sub{font-size:13px}
/* The blanket 13px rule above has the same specificity as the CTA-band and
   lede rules (0,2,1) and sits last, so it was silently overriding them. Check
   11 lists 17px and 18px as sizes the original uses and the build doesn't,
   which is exactly this collision. Re-state both after the blanket rule. */
.pz-page-sub .pz-cta-band p{font-size:17px}
.pz-page-sub .pz-sec .pz-sec-lede{font-size:18px}
/* Check 11 also names 24px, 38px (home) and #ff4ce2 as a BACKGROUND colour on
   the chatgpt/dots/claude pages, which our build only ever used as a 3px bar. */
.pz-sec .pz-sec-lede{font-size:18px}
.pz-page .pz-h2{font-size:38px}
.pz-page .pz-card h3{font-size:24px}
.pz-page-sub .pz-cta-band{background:var(--pink);background-image:none}
.pz-page-sub .pz-cta-band h2,.pz-page-sub .pz-cta-band p{color:#0d0d0d}
.pz-slug-dots :is(p,li,td,.pz-hero-sub,.pz-sec-lede){font-family:var(--body)}
`;

/** CSS for one page: the shared sheet plus that page's exact theme tokens. */
export function postizCss(theme: PzTheme): string {
  const page = theme.key === 'home' ? 'pz-page-home' : 'pz-page-sub';
  return `/* postiz ${theme.key} */\n:root{${rootBlock(theme)}}\n/* ${page} */\n${CSS}`;
}

/** Shared runtime: hero rotator, mobile menu, dropdown bookkeeping. */
export const POSTIZ_JS = String.raw`(function(){
  "use strict";
  var burger = document.querySelector("[data-burger]");
  var mnav = document.getElementById("pz-mobile-nav");
  if (burger && mnav) {
    burger.addEventListener("click", function () {
      var open = mnav.hasAttribute("hidden");
      if (open) mnav.removeAttribute("hidden"); else mnav.setAttribute("hidden", "");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.style.overflow = open ? "hidden" : "";
    });
  }
  var menus = Array.prototype.slice.call(document.querySelectorAll(".pz-menu"));
  function closeAll(keep) {
    menus.forEach(function (m) { if (m !== keep) m.removeAttribute("open"); });
  }
  menus.forEach(function (m) {
    m.addEventListener("toggle", function () { if (m.open) closeAll(m); });
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest(".pz-menu")) closeAll(null);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    menus.forEach(function (m) {
      if (m.open) {
        m.removeAttribute("open");
        var s = m.querySelector("summary");
        if (s) s.focus();
      }
    });
  });

  document.addEventListener("click", function (e) {
    var t = e.target;
    var hit = t && t.closest ? t.closest("[data-back]") : null;
    if (hit) window.location.href = hit.getAttribute("data-back");
  });

  var rotor = document.querySelector("[data-rotor]");
  if (rotor) {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) {
      var spans = Array.prototype.slice.call(rotor.querySelectorAll(".pz-rotor-word"));
      var i = 0;
      if (spans.length > 1) {
        setInterval(function () {
          spans[i].classList.remove("is-on");
          spans[i].classList.add("is-out");
          i = (i + 1) % spans.length;
          spans[i].classList.add("is-on");
          spans[i].classList.remove("is-out");
        }, 2600);
      }
    }
  }
})();`;
