import { I, DOODLE, ROTOR, TILES, AGENT_GLYPH, tile } from "./icons";
import { APP_PATH, esc, page } from "./layout";

const T = Object.fromEntries(TILES.map((t) => [t.key, t]));

const STATS_A = [
  { v: "x5", l: "X posts from one story", t: "x", g: "linear-gradient(110deg,#4b0a8a,#8a0fd0)" },
  { v: "x1", l: "Thread with a hook", t: "x", g: "linear-gradient(110deg,#1036c8,#1550e0)" },
  { v: "x2", l: "LinkedIn posts", t: "linkedin", g: "linear-gradient(110deg,#0d2ad0,#1a1ad8)" },
  { v: "x2", l: "Threads posts", t: "threads", g: "linear-gradient(110deg,#3b16d8,#5a14e0)" },
  { v: "x1", l: "Carousel, 2-10 slides", t: "instagram", g: "linear-gradient(110deg,#4b14d8,#2a0a8a)" },
  { v: "x1", l: "YouTube script", t: "youtube", g: "linear-gradient(110deg,#6a0aa8,#8a0fd0)" },
];
const STATS_B = [
  { v: "7", l: "Research providers", t: "rss", g: "linear-gradient(110deg,#7a0ad0,#9a14e0)" },
  { v: "50", l: "Sources per research job", t: "web", g: "linear-gradient(110deg,#7a0aa8,#9a12b0)" },
  { v: "1", l: "Approval per exact revision", t: "linkedin", g: "linear-gradient(110deg,#9012b4,#b015b4)" },
  { v: "0", l: "Blind retries after a send", t: "x", g: "linear-gradient(110deg,#b015b4,#c8189a)" },
  { v: "x5", l: "Shorts concepts", t: "video", g: "linear-gradient(110deg,#c8189a,#d81b80)" },
  { v: "x10", l: "Quote cards", t: "instagram", g: "linear-gradient(110deg,#8a0f6f,#5c0a50)" },
];

const stat = (s: (typeof STATS_A)[number]) =>
  `<div class="stat" style="background:${s.g}"><b>${s.v}</b><span>${s.l}</span><em>${tile(T[s.t])}${T[s.t].label}</em></div>`;

const WHO = [
  {
    icon: '<svg viewBox="0 0 76 76" fill="none" stroke="#e879f9" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="38" cy="38" r="33"/><path d="M26 30v3M48 29v4M24 44c8 10 22 10 30 0-10 2-20 2-30 0Z"/></svg>',
    h: "Creators and solo operators",
    p: "Write in your own voice without starting from a blank page. ContentForge researches the topic, drafts every format and waits for your approval.",
  },
  {
    icon: '<svg viewBox="0 0 76 76" fill="none" stroke="#a78bfa" stroke-width="2.4" stroke-linejoin="round" aria-hidden="true"><path d="M14 26h48l-4 42H18l-4-42Z"/><path d="M28 26c0-14 20-14 20 0"/></svg>',
    h: "Developers and agent builders",
    p: "Drive the whole lifecycle through typed domain tools: research, stories, artifacts, approvals and publications. Agents never write to the database.",
  },
  {
    icon: '<svg viewBox="0 0 76 76" fill="none" stroke="#6366f1" stroke-width="2.4" stroke-linejoin="round" aria-hidden="true"><path d="M8 36 38 8l30 28M18 28v40h40V28"/><path d="M32 68V50h12v18"/></svg>',
    h: "Content teams",
    p: "Run research on a schedule, review a daily opportunity feed, batch-approve a campaign and let durable publishing handle the rest.",
  },
];

const LIFECYCLE = ["ResearchJob", "Evidence & Story", "Opportunity", "Generation policy", "Artifact revision", "Approval", "Schedule", "Publication & result"];

function winMock(title: string, glyph: string, ask: string, bg: string): string {
  return `<div class="mock"><div class="win"><div class="side"><span style="display:flex;align-items:center;gap:8px;color:#fff;font-size:15px;margin-bottom:18px"><span class="ch" style="background:${bg};width:24px;height:24px">${glyph}</span>${title}</span><div class="bar"></div><div class="bar" style="width:70%"></div><div class="bar" style="width:80%"></div></div><div class="body"><b style="color:#fff;font-size:15px">${title}</b><div class="msg" style="top:56px">${ask}</div><div class="msg" style="top:130px;right:auto;left:20px;background:#2a2a2a">Researching 14 sources. 3 opportunities found. Drafting X thread and LinkedIn post for your approval.</div></div></div></div>`;
}

const VIA = [
  {
    cls: "g-gpt", glyph: "chatgpt", h: "Via ChatGPT", href: "/chatgpt",
    p: "Use OpenAI models as the writing backend, and drive ContentForge from ChatGPT once the MCP connector ships.",
    mock: winMock("ChatGPT", AGENT_GLYPH.chatgpt, "Research AI search trends and draft 3 LinkedIn posts in my voice.", "#3f9f87"),
  },
  {
    cls: "g-claude flip", glyph: "claude", h: "Via Claude", href: "/claude",
    p: "Plan research, review evidence and request drafts from Claude through the ContentForge domain tools.",
    mock: winMock("Claude", AGENT_GLYPH.claude, "Turn yesterday's story into a 7-post campaign for next week.", "#d4774d"),
  },
  {
    cls: "g-code", glyph: "code", h: "Via your terminal",
    p: "Script the lifecycle with the same API the app uses: research, generate, approve and schedule.",
    mock: `<div class="mock"><div class="term"><div class="dots"><i></i><i></i><i></i></div><div class="box">ContentForge agent <span>· 29 domain tools</span><br><br><span>&gt; research_topic "creator economy"</span><br><span>&gt; repurpose_story st_42 --formats x_thread,linkedin</span><br><span>&gt; approve_artifact art_901@rev3</span><br><br>Recent activity<br><span>1h ago  4 artifacts awaiting approval</span></div></div></div>`,
  },
  {
    cls: "g-gem flip", glyph: "gemini", h: "Via Gemini",
    p: "Video research and transcript extraction route to Gemini, with graceful fallback to your default provider.",
    mock: winMock("Gemini", AGENT_GLYPH.gemini, "Extract the claims from this video and find what is new.", "#3c6be0"),
  },
  {
    cls: "g-open", glyph: "local", h: "Via any OpenAI-compatible model",
    p: "Point ContentForge at OpenRouter, a local model or your own gateway. One router, per-task model choice.",
    mock: `<div class="mock"><div class="win" style="grid-template-columns:1fr"><div class="body"><b style="color:#fff">AI providers</b><div class="msg" style="top:56px;left:20px;right:20px;max-width:none;background:#2a2a2a">default → openai-compatible · text model</div><div class="msg" style="top:110px;left:20px;right:20px;max-width:none;background:#2a2a2a">video.* → gemini · fallback default</div><div class="msg" style="top:164px;left:20px;right:20px;max-width:none;background:#2a2a2a">Usage and cost logged per call</div></div></div></div>`,
  },
  {
    cls: "g-agent flip", glyph: "workspace", h: "Via the Agent workspace",
    p: "Chat with an agent that researches, writes, critiques and asks for your approval before anything is published.",
    mock: winMock("Agent", AGENT_GLYPH.workspace, "What should I publish this week?", "#7c3aed"),
  },
];

const via = (v: (typeof VIA)[number]) => {
  const head = `<h3 class="head">${AGENT_GLYPH[v.glyph]}<span>${v.href ? `<a href="${v.href}">${v.h}</a>` : v.h}</span></h3><p>${v.p}</p>`;
  return v.cls.includes("flip") ? `<article class="via ${v.cls}">${v.mock}${head}</article>` : `<article class="via ${v.cls}">${head}${v.mock}</article>`;
};

const curve = (d: string, c: string) => `<svg viewBox="0 0 240 80" fill="none" stroke="${c}" stroke-width="2" aria-hidden="true"><path d="${d}"/></svg>`;

const QUOTES = [
  { p: "Research is the durable asset.\n\nContent is a reusable derivation of that research. Research once, create many formats, publish across platforms and learn from the results.", n: "Principle #1", h: "Research first", c: "#a78bfa" },
  { p: "Facts and interpretations stay separate.\n\nEvery story keeps its sourced evidence and provenance apart from what the model concluded, so you can always check the claim behind a post.", n: "Principle #2", h: "Evidence over vibes", c: "#f472b6" },
  { p: "Artifact revisions are immutable. Edits create a new revision that supersedes the last one, and approval belongs to that exact revision.\n\nWhat you approved is exactly what gets published.", n: "Principle #3", h: "Approve the exact words", c: "#60a5fa" },
  { p: "Format and channel are separate dimensions.\n\nA carousel is a carousel whether it lands on Instagram or LinkedIn; each channel adapter owns its own limits and publishing mechanics.", n: "Principle #4", h: "Platform-native, not copy-paste", c: "#34d399" },
  { p: "Publishing is idempotent and recoverable. A send that may have happened is never blindly retried: unknown outcomes are reconciled first.", n: "Principle #5", h: "No double posts", c: "#fbbf24" },
  { p: "Agents use domain tools, never the database.\n\nResearch, writing, editing and publishing agents act through the same validated APIs a human uses, with a human approval gate.", n: "Principle #6", h: "Human-governed agents", c: "#fb7185" },
  { p: "Video Factory is a separate service. ContentForge writes the script and sends a versioned production request; rendering, voice and media stay behind that contract.", n: "Principle #7", h: "Clean boundaries", c: "#c084fc" },
  { p: "Learn from results without inventing causality. Performance signals become observations, observations become experiments, and only reviewed experiments change policy.", n: "Principle #8", h: "Measured learning", c: "#22d3ee" },
];

const quote = (q: (typeof QUOTES)[number]) =>
  `<article class="quote"><p>${q.p}</p><div class="by"><i style="background:${q.c}"></i><span><b>${q.h}</b><small>${q.n}</small></span></div></article>`;

export const HOME_FAQ: [string, string][] = [
  ["What is ContentForge?", "ContentForge is a self-hosted, AI-native content intelligence and growth operating system. It discovers opportunities, researches topics with cited sources, turns research into reusable stories, generates platform-native content in your voice, schedules and publishes it, and learns from the results."],
  ["How is it different from a social media scheduler?", "Schedulers start at the post. ContentForge starts at research: every artifact traces back to a story and its evidence, so one research job can feed a whole campaign across formats and channels, and the results flow back into what you research next."],
  ["Which channels can ContentForge publish to?", "Today the registered channel adapters are X, LinkedIn, Threads, Instagram and YouTube. Each adapter owns its own limits, payload validation and publishing mechanics, so new channels plug in without touching the lifecycle."],
  ["Where does the research come from?", "Seven research providers: RSS, Reddit, YouTube, Hacker News, web pages, video transcripts and an optional last-30-days current-events provider. Sources are deduplicated, ranked and stored with provenance."],
  ["Can AI agents like ChatGPT or Claude drive ContentForge?", "The in-app Agent workspace already drives the lifecycle through 29 typed domain tools. Exposing those same tools to ChatGPT, Claude and other assistants over MCP is the next step on the roadmap; see the AI Agents pages for details."],
  ["Does anything get published without me?", "No, not by default. Only approved revisions can be scheduled or published. Auto-publishing requires an explicit trusted policy that you turn on; otherwise automation stops and waits for your approval."],
  ["Will the content sound like me?", "Voice profiles are built from your own writing samples, brand pillars and audience, and are frozen into every generation policy. Approved edits and rejected drafts feed back as learning signals."],
  ["Can it repurpose one article into many posts?", "Yes. One story can fan out into X posts and threads, LinkedIn and Threads posts, carousels, newsletters and video scripts. Each output is adapted to its platform and approved on its own."],
  ["What analytics does ContentForge track?", "Impressions, likes, comments, shares, saves, clicks, replies, followers gained and engagement rate per publication, rolled up by channel and format, with experiments for hooks, formats and posting times."],
  ["Does ContentForge make videos?", "ContentForge writes scripts and submits versioned production requests to Video Factory, a separate service that owns voice, media, composition, rendering and validation."],
  ["Can I manage more than one brand?", "The domain model is owner-scoped and brand profiles are separate from stories, so multiple brands are supported by design. A multi-brand workspace switcher is on the roadmap."],
  ["Is ContentForge free and open source?", "ContentForge is self-hosted from its GitHub repository. You bring your own model provider keys and channel credentials; there is no subscription."],
];

export const faqList = (items: [string, string][]) =>
  `<div class="faq-list">${items
    .map(([q, a]) => `<details><summary><h3>${q}</h3>${I.plus}</summary><p>${a}</p></details>`)
    .join("")}</div>`;

export function renderHome(): string {
  const first = ROTOR[0];
  const strip = [...TILES, ...TILES, ...TILES.slice(0, 6)];
  const row = (keys: string[], ghostEnds = true) =>
    `<div class="tile-row">${ghostEnds ? '<span class="big-tile ghost"></span>' : ""}${keys
      .map((k) => `<span class="big-tile">${tile(T[k])}</span>`)
      .join("")}${ghostEnds ? '<span class="big-tile ghost"></span>' : ""}</div>`;

  const body = `
<section class="hero" aria-labelledby="hero-title">
  <span class="hero-doodle left">${DOODLE.squiggle}</span>
  <span class="hero-doodle right">${DOODLE.sparkle}</span>
  <div class="laurels" aria-label="Research once, create many, publish everywhere">
    ${["Research|once", "Create|many", "Publish|everywhere"].map((x) => {
      const [a, b] = x.split("|");
      return `<div class="laurel">${DOODLE.laurel}<span>${a}<b>${b}</b></span><span style="transform:scaleX(-1)">${DOODLE.laurel}</span></div>`;
    }).join("")}
  </div>
  <h1 id="hero-title" class="head">Run your content engine on autopilot with
    <span class="rotor" data-rotor="${esc(JSON.stringify(ROTOR))}"><span class="rotor-icon" style="background:${first.bg}">${first.svg}</span><span class="rotor-word">${first.name}</span></span></h1>
  <p class="hero-sub">ContentForge is the content operating system: AI agents discover topics, research them with sources and draft every format, and you approve everything before it ships.</p>
  <a class="btn btn-light btn-lg" href="${APP_PATH}">Start your first research for $0 ${I.arrows}</a>
  <div class="channel-strip" aria-label="Channels and research sources">${strip.map((t) => tile(t)).join("")}</div>
</section>

<section class="demo-sec" aria-label="Product demo">
  <div class="toggle-row"><span id="mode-a">I need agentic research</span>
    <button class="switch" type="button" role="switch" aria-checked="false" aria-labelledby="mode-a mode-b" data-mode-switch
      data-agent-title="Tell AI What You Want to Create" data-classic-title="Research once. Publish everywhere."
      data-agent-ask="Research what founders are asking about AI pricing this week and draft a LinkedIn post and an X thread in my voice."
      data-classic-ask="Here is the plan for next week: 2 LinkedIn posts, 1 X thread and 1 carousel, all waiting for your approval."></button>
    <span id="mode-b">I need a classic calendar</span></div>
  <div class="demo">
    <p class="demo-title" data-demo-title>Tell AI What You Want to Create</p>
    <div class="demo-frame"><div class="demo-win">
      <div class="demo-side"><div class="brand">${AGENT_GLYPH.workspace}Agent</div>
        <p>${I.plus}New research</p><p>${I.search}Search stories</p><p>${I.image}Visual studio</p>
        <div class="bar"></div><div class="bar" style="width:70%"></div><div class="bar" style="width:80%"></div></div>
      <div class="demo-main">
        <div class="reply" data-demo-reply>
          <div class="post"><b>Mon 09:00 · LinkedIn</b>Pricing pages are now product tours...</div>
          <div class="post"><b>Tue 12:30 · X thread</b>7 things founders get wrong about AI pricing</div>
          <div class="post"><b>Thu 10:00 · Carousel</b>The usage-based pricing checklist</div>
        </div>
        <div class="bubble" data-demo-bubble>Research what founders are asking about AI pricing this week and draft a LinkedIn post and an X thread in my voice.</div>
        <div class="ask">${I.plus}<span>Ask anything</span><span class="mic">${I.chart}</span></div>
      </div>
    </div></div>
  </div>
  <a class="support" href="https://github.com/unplugged-kk/ContentForge/issues">${I.github}GitHub Support</a>
</section>

<section class="sec" id="repurposing" aria-labelledby="stats-title">
  <p id="stats-title" class="stats-title head">One story becomes a whole campaign</p>
  <div class="marquee"><div class="track">${[...STATS_A, ...STATS_A, ...STATS_A, ...STATS_A].map(stat).join("")}</div></div>
  <div class="marquee rev"><div class="track">${[...STATS_B, ...STATS_B, ...STATS_B, ...STATS_B].map(stat).join("")}</div></div>
</section>

<section class="who" aria-labelledby="who-title"><div class="wrap">
  <h2 id="who-title" class="sec-title head">Who is ContentForge for?</h2>
  <div class="who-grid">${WHO.map((w) => `<div class="who-item">${w.icon}<h3 class="head">${w.h}</h3><p>${w.p}</p></div>`).join("")}</div>
</div></section>

<section class="sec" id="lifecycle" aria-labelledby="action-title"><div class="wrap">
  <h2 id="action-title" class="sec-title head">See ContentForge in action</h2>
  <p class="sec-sub">One canonical lifecycle, from the open internet to a measured result.</p>
  <div class="poster">
    <div class="poster-kicker">RESEARCH ONCE</div>
    <div class="poster-big" aria-hidden="true">PUBLISH</div>
    <ol class="lifecycle" aria-label="Lifecycle">${LIFECYCLE.map((s, i) => `<li class="step"><i>${i + 1}</i>${s}</li>`).join("")}</ol>
  </div>
</div></section>

<section class="sec" id="creation" aria-labelledby="power-title"><div class="wrap">
  <h2 id="power-title" class="sec-title head">Power Your Content<br>with AI and Automation</h2>
  <div class="via-grid">
    ${VIA.map(via).join("")}
    <article class="via wide g-api">
      <div><span class="ch" style="background:#fff;color:#0a2c8c;width:36px;height:36px">${I.terminal}</span>
      <h3 class="head">Automate everything</h3>
      <p>Schedule research, score opportunities, generate drafts and publish after approval, all through a typed API with idempotent jobs.</p></div>
      <div class="mock"><div class="api"><span>/api/automation/policies</span>
        <div class="req"><b>POST</b><span>/api/automation/policies</span></div>
        <pre>{ "research": { "providers": ["rss","reddit","hn"] },
  "fanout": ["x_thread","linkedin_post","carousel"],
  "publish": "on_approval" }</pre></div></div>
    </article>
  </div>
</div></section>

<section class="tools" id="distribution" aria-labelledby="tools-title"><div class="wrap">
  <h2 id="tools-title" class="sec-title head">All the tools you need for content<br>growth in one place</h2>
  <span class="underline">${DOODLE.underline}</span>
  <div class="tools-grid">
    <article class="tool t-plan"><span class="tag">Planning</span><h3 class="head">Schedule everywhere at once</h3>
      <p>Approve a revision once and schedule it to every channel it fits. Recurring series, single occurrences and a visual calendar.</p>
      <div class="mock"><div class="cal">
        <div class="rail"><i></i><i></i><i></i><i></i><i></i></div>
        <div class="chs"><b style="font-size:14px;color:#fff">Channels</b><div class="b">Add channel</div><div class="b p">+ Create post</div>
          <div class="who"><i></i>X · @you</div><div class="who"><i></i>LinkedIn</div><div class="who"><i></i>Threads</div></div>
        <div class="grid"><div class="h">Wed</div><div class="h">Thu</div><div class="h">Fri</div><div class="h">Sat</div>
          <div class="ev">Launch thread</div><div></div><div class="ev v">Carousel</div><div></div>
          <div></div><div class="ev v">LinkedIn post</div><div></div><div class="ev">Newsletter</div>
          <div class="ev">Shorts script</div><div></div><div></div><div></div></div>
      </div></div></article>
    <article class="tool t-agent flip"><div class="mock"><div class="orbit-mock">
        <span class="ch" style="left:6%;top:6%;background:#3f9f87">${AGENT_GLYPH.chatgpt}</span>
        <span class="ch" style="left:40%;top:-4%;background:#fff;color:#d4774d">${AGENT_GLYPH.claude}</span>
        <span class="ch" style="right:6%;top:14%;background:#3c6be0">${AGENT_GLYPH.gemini}</span>
        <span class="ch" style="left:18%;top:42%;background:#222">${AGENT_GLYPH.code}</span>
        <span class="ch" style="right:20%;top:46%;background:#7c3aed">${AGENT_GLYPH.workspace}</span>
        <div class="chatbox">${I.plus}Ask anything<i></i></div></div></div>
      <span class="tag">AI agents</span><h3 class="head">Work with AI agents</h3>
      <p>Research, writing, critique and publishing agents work through the same domain tools you do, with approval gates.</p></article>
    <article class="tool full t-img" id="intelligence"><div><span class="tag">AI image</span><h3 class="head">Design it with AI</h3>
      <p>Generate brand-aware images, carousels and quote cards at each platform's dimensions, with visual quality checks.</p></div>
      <div class="mock"><div class="studio"><div class="top">Visual studio <b>Use this media</b></div>
        <div class="canvas"><div class="tools-col"><span>Text</span><span class="on">Images</span><span>Elements</span><span>Background</span><span>AI image</span></div>
        <div class="thumbs"><b style="grid-column:1/-1;font-size:12px">Brand library</b><i style="background:linear-gradient(135deg,#fde68a,#f97316)"></i><i style="background:#111"></i><i style="background:linear-gradient(135deg,#fbcfe8,#a78bfa)"></i><i style="background:#f472b6"></i><i style="background:#22d3ee"></i><i style="background:linear-gradient(135deg,#818cf8,#4c1d95)"></i></div>
        <div class="art">1080 × 1350 · Carousel slide 1</div></div></div></div></article>
    <div class="r2">
      <article class="tool t-team"><span class="tag">Second brain</span><h3 class="head">Built on your knowledge</h3>
        <p>Voice profiles, brand pillars, saved URLs, snippets and research vaults assemble the context for every draft.</p>
        <div class="mock"><div class="team">
          <div class="member"><i></i>Voice<b>Analytical</b></div>
          <div class="member lead"><i></i>Your brand<small style="color:#ffffff99">pillars · audience</small><b>Active</b></div>
          <div class="member"><i></i>Vault<b>128 notes</b></div></div></div></article>
      <article class="tool t-auto flip"><div class="mock"><div class="feed">
          <div class="nav"><span>Today</span><span>Create</span><span>Sources</span><span>Agent</span><span>Schedule</span><span>Insights</span><span>Settings</span></div>
          <div class="post"><b>Approval inbox</b><p style="font-size:12px;color:#ffffffb3;margin-top:6px">LinkedIn post · revision 3 · from story "AI pricing pages"</p><div class="card"></div></div>
          <div class="actions"><span>Approve</span><span>Edit</span><span>Reject</span><span>Schedule</span></div></div></div>
        <span class="tag">Approvals</span><h3 class="head">Nothing ships unapproved</h3>
        <p>Review the exact revision, edit to create a new one, then approve. Durable scheduling publishes it and reconciles anything uncertain.</p></article>
    </div>
    <article class="tool full t-an"><div><span class="tag">Analytics</span><h3 class="head">Comprehensive analytics</h3>
      <p>See which topics, formats, hooks and posting times perform, then run experiments before changing policy.</p></div>
      <div class="mock"><div class="charts">
        <div class="c">Impressions${curve("M0 60C30 40 50 70 80 50S130 10 160 30 210 60 240 20", "#a855f7")}<b>6,224</b></div>
        <div class="c">Engagement${curve("M0 40C20 10 40 70 70 30S110 0 140 50 200 40 240 60", "#ec4899")}<b>7,435</b></div>
        <div class="c">Clicks${curve("M0 70C40 60 60 30 100 40S170 20 240 10", "#3b82f6")}<b>2,365</b></div>
        <div class="c">Followers gained${curve("M0 70C30 70 60 60 90 30S150 20 180 50 220 40 240 30", "#22d3ee")}<b>4,144</b></div>
      </div></div></article>
  </div>
</div></section>

<section class="sec" aria-labelledby="ch-title"><div class="wrap">
  <h2 id="ch-title" class="sec-title head">Research everywhere,<br>publish where it matters</h2>
  <span class="underline">${DOODLE.underline}</span>
  <p class="sec-sub">Seven research providers in, five channel adapters out, and a versioned contract to Video Factory for everything video.</p>
  <div class="tile-rows">
    ${row(["x", "linkedin", "threads", "instagram", "youtube", "rss", "reddit"])}
    ${row(["hn", "web", "video", "last30", "factory", "x", "linkedin"])}
    ${row(["threads", "instagram", "youtube", "rss", "reddit", "hn", "web"])}
  </div>
</div></section>

<section class="sec" aria-labelledby="cta-title"><div class="wrap">
  <div class="cta-band"><div><h3 id="cta-title" class="head">Ready to get started?</h3>
    <p>Connect your sources and channels and run your first research job in minutes. Self-hosted, no subscription.</p></div>
    <div class="go">${DOODLE.loop}<a class="btn btn-light" href="${APP_PATH}">Start for $0 ${I.arrows}</a></div></div>
</div></section>

<section class="sec" aria-labelledby="wall-title"><div class="wrap">
  <h2 id="wall-title" class="sec-title head wall-title">Principles we keep ${I.heart}</h2>
  <div class="wall">${QUOTES.map(quote).join("")}</div>
</div></section>

<section class="sec" id="faq" aria-labelledby="faq-title"><div class="wrap faq">
  <h2 id="faq-title" class="head">Frequently asked questions</h2>
  ${faqList(HOME_FAQ)}
</div></section>`;

  return page({
    path: "/",
    title: "ContentForge: The AI-native Content Intelligence & Growth Operating System",
    description:
      "ContentForge discovers opportunities, researches topics with sources, creates content in your voice, repurposes it across platforms, publishes after your approval and learns what works.",
    body,
  });
}
