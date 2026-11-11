import { I, TILES, AGENT_GLYPH, tile } from "./icons";
import { APP_PATH, AGENT_PAGES, DOCS_URL, REPO_URL, page } from "./layout";
import { faqList } from "./home";

/**
 * Agent integration pages. One template, four assistants.
 *
 * Honesty rule: ContentForge's 29 domain tools are real and drive the in-app
 * Agent workspace today; serving them over MCP to outside assistants is on the
 * roadmap (Phase B). Copy says "planned" wherever that difference matters.
 */
export const MCP_URL_EXAMPLE = "https://<your-contentforge-host>/api/agent/mcp";

type AgentCfg = {
  path: string;
  name: string;
  glyph: string;
  theme: string;
  acc: string;
  orb: string;
  title: string;
  bullets: string[];
  primary: string;
  where: string;
  asks: { h: string; q: string }[];
  chips: [string, string][];
  compare: { h: string; rows: [string, string, string][] };
  same: { q: string; cards: [string, string][] };
  faq: [string, string][];
};

const COMMON_FAQ = (n: string): [string, string][] => [
  [`Can ${n} publish without my approval?`, `No. ${n} can request drafts, critique them and ask for approval, but only an approved revision can be scheduled or published. Auto-publishing needs an explicit trusted policy you turn on yourself.`],
  [`Does ${n} need my social media passwords?`, "No. Channel credentials stay in your ContentForge server. Assistants only call domain tools, and every call is owner-scoped and audited."],
  [`Which platforms can ${n} post to through ContentForge?`, "X, LinkedIn, Threads, Instagram and YouTube, through the channel adapters registered in your ContentForge server."],
  [`Is the ContentForge MCP server available now?`, `Not yet. The same 29 domain tools already run the in-app Agent workspace; exposing them to ${n} over MCP is the next roadmap phase. Until then, use the Agent workspace with your chosen model provider.`],
  ["Is it free to start?", "Yes. ContentForge is self-hosted with no subscription. You bring your own model and channel credentials."],
  [`Can ${n} generate images and carousels?`, "Yes, through generate_image and the carousel formats. Each visual is checked against the platform's dimensions before it can be attached to a revision."],
  [`Can ${n} turn a long video into posts?`, "Yes. Video transcripts are a research source, so a long video can become a story, then threads, posts and Shorts scripts. Rendering stays with Video Factory."],
  [`What if a publication fails while ${n} is offline?`, "Publishing runs on durable server jobs, not in the chat. Failures are classified, and an uncertain outcome is reconciled with the platform before anything is retried."],
  [`${n} does not show the ContentForge tools. What should I check?`, "Until the MCP server ships, the tools appear only in the in-app Agent workspace. Check that a model provider is configured in Settings → AI providers."],
];

const CAPS = (n: string): [string, string, string][] => [
  ["chat", "Just Ask in Plain English", `Tell ${n} what to research and what to make. It calls research_topic, create_story and repurpose_story for you.`],
  ["globe", "Research with sources", "Seven providers, deduplicated and ranked, with evidence and provenance kept apart from interpretation."],
  ["layers", "One story, every format", "Threads, LinkedIn posts, carousels, newsletters and scripts adapted to each platform."],
  ["calendar", "Plan & Schedule Ahead", "Approved revisions go into durable schedules that survive restarts and never double-post."],
  ["image", "Generate Images & Videos", "Generate brand-aware images, and send video scripts to Video Factory through a versioned contract."],
  ["lock", "Stays in Your Account", "Owner-scoped tools, audit logs and a human approval gate on everything that publishes."],
];

const AGENTS: AgentCfg[] = [
  {
    path: "/chatgpt", name: "ChatGPT", glyph: "chatgpt", theme: "t-gpt", acc: "#5fe3c6", orb: "#3f9f87",
    title: "Schedule Social Media Posts with ChatGPT",
    bullets: ["OpenAI models as your ContentForge writing backend today", "Research, draft and schedule by asking", "Publish to X, LinkedIn, Threads, Instagram and YouTube"],
    primary: "Set up OpenAI", where: "Settings → AI providers",
    asks: [
      { h: "Ship a launch post", q: "Research how people talk about our launch topic and draft an X thread and a LinkedIn post." },
      { h: "Plan a whole week", q: "Find this week's three best opportunities and plan one post per weekday." },
      { h: "Post with a generated image", q: "Write a LinkedIn post about our new feature and generate a 1200×627 image for it." },
      { h: "Repurpose an article", q: "Turn this URL into 5 X posts, 2 Threads posts and a carousel." },
    ],
    chips: [["List my opportunities", "You have 3 proposed opportunities: AI pricing pages (score 0.82), onboarding emails, creator tools."], ["Plan a week of posts about our launch", "Drafted 5 artifacts for Mon-Fri. All are waiting for your approval in the inbox."], ["Save this as a draft instead", "Saved as revision 1 in draft. Nothing is scheduled until you approve it."]],
    compare: { h: "Agent workspace or MCP connector?", rows: [["Setup", "Add an OpenAI key in Settings → AI providers", "Add the ContentForge MCP link as a custom connector (planned)"], ["Where you chat", "Inside ContentForge", "Inside ChatGPT"], ["Sign-in", "Your ContentForge session", "OAuth to your ContentForge server"], ["Write actions", "Approval gate before anything publishes", "Same approval gate, enforced server-side"], ["Status", "Available now", "Planned, roadmap Phase B"]] },
    same: { q: "Is ChatGPT the same as Codex?", cards: [["ChatGPT", "Conversational: ask for research, drafts and plans in plain English."], ["Codex", "Code-first: script the ContentForge API from your repository or terminal."], ["Both", "Use the same domain tools and the same approval gate."]] },
    faq: [["How does ContentForge work with ChatGPT?", "ContentForge routes text generation to the provider you configure. With an OpenAI key, ChatGPT's models write your drafts from frozen generation policies that carry your voice, format and channel rules."], ...COMMON_FAQ("ChatGPT")],
  },
  {
    path: "/dots", name: "OpenAI dots", glyph: "dots", theme: "t-dots", acc: "#b69cff", orb: "#6d3ef0",
    title: "Schedule Social Media Posts with OpenAI dots",
    bullets: ["Hand an always-on agent your recurring content jobs", "It researches and drafts on a schedule, 24/7", "Your approval rules decide what ships"],
    primary: "Set up automation", where: "Automation → Policies",
    asks: [
      { h: "A weekly content plan", q: "Every Monday, research my pillars and propose a week of posts for approval." },
      { h: "Posts from a transcript", q: "Turn this podcast transcript into a thread, two LinkedIn posts and quote cards." },
      { h: "Post with a generated image", q: "Make a carousel from yesterday's story with on-brand visuals." },
      { h: "Ship a launch everywhere", q: "Repurpose the launch story for every connected channel and queue it for review." },
    ],
    chips: [["What ran overnight?", "2 research jobs completed, 1 story created, 4 artifacts awaiting approval."], ["Pause automation for the weekend", "Automation policy paused until Monday 08:00. Nothing will be generated."], ["Show me what failed", "1 publication is in unknown state on X. It will be reconciled before any retry."]],
    compare: { h: "Scheduled automation or an always-on agent?", rows: [["Setup", "Create an automation policy in ContentForge", "Give your dot the ContentForge tools (planned MCP)"], ["Runs", "Durable jobs on your server", "On the agent's own schedule"], ["Approval", "Stops at awaiting approval unless trusted", "Same server-side gate"], ["Observability", "Run history, journal and recovery", "Same run history"], ["Status", "Available now", "Planned, roadmap Phase B"]] },
    same: { q: "How do dots compare to the Agent workspace?", cards: [["Agent workspace", "Built into ContentForge, available today."], ["OpenAI dots", "An outside always-on agent that would call the same tools over MCP."], ["Automation policies", "Deterministic, durable and observable runs with no agent in the loop."]] },
    faq: [["What can an always-on agent do with ContentForge?", "Run recurring research, score opportunities, request drafts and assemble a weekly plan, then stop and wait for your approval."], ...COMMON_FAQ("your dot")],
  },
  {
    path: "/claude", name: "Claude", glyph: "claude", theme: "t-claude", acc: "#ffac85", orb: "#d4774d",
    title: "Post to Social Media from Claude",
    bullets: ["Use Claude models through any OpenAI-compatible gateway", "Draft, critique and repurpose by asking", "Every draft waits for your approval"],
    primary: "Set up a provider", where: "Settings → AI providers",
    asks: [
      { h: "Ship a launch post", q: "Read the evidence for this story and draft a LinkedIn post that cites it." },
      { h: "Plan a whole week", q: "Propose a week of content from my top opportunities, one format per day." },
      { h: "Critique a draft", q: "Critique revision 2 for hook strength and claims without a source." },
      { h: "Turn a long video into shorts", q: "Find 5 Shorts concepts in this video and write a script for each." },
    ],
    chips: [["Which story is strongest?", "\"AI pricing pages\" has 9 sourced facts and 3 converging sources. It is the best candidate."], ["Rewrite the hook only", "Created revision 4 with a new hook. Revision 3 is unchanged and still approved."], ["Save this as a draft instead", "Saved as a draft. Nothing is scheduled until you approve it."]],
    compare: { h: "Agent workspace or MCP connector: what is the difference?", rows: [["Setup", "Point AI providers at a gateway that serves Claude", "Add ContentForge as a custom connector in Claude (planned)"], ["Where you chat", "Inside ContentForge", "Claude on the web, desktop or mobile"], ["Sign-in", "Your ContentForge session", "OAuth to your ContentForge server"], ["Write actions", "Approval gate before publishing", "Same approval gate, enforced server-side"], ["Status", "Available now", "Planned, roadmap Phase B"]] },
    same: { q: "Claude vs Claude Code vs Claude Cowork: which guide do I need?", cards: [["Claude (this page)", "Chat-first research and writing."], ["Claude Code", "Script the ContentForge API from your terminal."], ["Claude Cowork", "Desktop agent for recurring content tasks. See the Claude Cowork page."]] },
    faq: [["How do I use Claude with ContentForge?", "Configure an OpenAI-compatible gateway that serves Claude models under Settings → AI providers. ContentForge will route text generation to it."], ...COMMON_FAQ("Claude")],
  },
  {
    path: "/claude-cowork", name: "Claude Cowork", glyph: "cowork", theme: "t-claude", acc: "#ffac85", orb: "#b85a2e",
    title: "Schedule Social Media Posts with Claude Cowork",
    bullets: ["A desktop agent for your recurring content work", "Research, draft and cross-post across channels", "No terminal and no direct database access"],
    primary: "Read the docs", where: "Docs → Agent runtime",
    asks: [
      { h: "Check your channels", q: "Which channels are connected and which ones failed their last publication?" },
      { h: "Schedule across channels", q: "Schedule the approved carousel to Instagram and LinkedIn for Thursday 10:00." },
      { h: "Check options first", q: "What formats does Threads support for this story?" },
      { h: "Read the numbers", q: "Which format performed best last month, and how sure are we?" },
    ],
    chips: [["Check my channels", "X, LinkedIn and Threads are connected. Instagram needs a new token."], ["Read last month's numbers", "Threads posts had the highest engagement rate (n=12). That is a correlation, not a cause."], ["Schedule the approved carousel", "Scheduled for Thursday 10:00 on Instagram and LinkedIn."]],
    compare: { h: "Which way should you connect ContentForge to Claude Cowork?", rows: [["Setup", "Use the in-app Agent workspace", "Add ContentForge as a Cowork connector (planned)"], ["Best for", "Day-to-day review and approval", "Recurring desktop workflows"], ["Approval", "Human gate on every publish", "Same server-side gate"], ["Data", "Stays on your server", "Stays on your server"], ["Status", "Available now", "Planned, roadmap Phase B"]] },
    same: { q: "How do social media workflows run in Claude Cowork?", cards: [["Discover", "List opportunities, stories and connected channels."], ["Create", "Request drafts and repurposing through domain tools."], ["Manage and analyze", "Schedule approved revisions and read performance."]] },
    faq: [["What is Claude Cowork?", "Claude Cowork is a desktop agent that can use connectors to run multi-step tasks. With the planned ContentForge MCP server it would call the same domain tools as the in-app agent."], ...COMMON_FAQ("Claude Cowork")],
  },
];

const MORE_AGENTS: [string, string, string, string][] = [
  ["Claude Code", "Terminal scripts today, MCP planned", "code", "#c2603a"],
  ["Codex", "Terminal scripts today, MCP planned", "code", "#3b5bdb"],
  ["Cursor", "MCP planned", "local", "#2b2b2b"],
  ["Gemini", "Gemini models via the AI router", "gemini", "#3c6be0"],
  ["Hermes Agent", "Planned via MCP", "workspace", "#7c3aed"],
  ["OpenClaw", "Planned via MCP", "local", "#b0343a"],
  ["Grok Bot", "OpenAI-compatible models today", "dots", "#222222"],
  ["Muse", "Planned via MCP", "gemini", "#3c6be0"],
  ["MCP Server", "Planned, roadmap phase B", "workspace", "#6d3ef0"],
  ["AI Agents CLI", "Domain tools over the API", "code", "#444444"],
]
const T = Object.fromEntries(TILES.map((t) => [t.key, t]));
const CH = ["x", "linkedin", "threads", "instagram", "youtube"];

function heroArt(a: AgentCfg): string {
  const spots = [[12, 10], [38, 2], [66, 6], [90, 14], [8, 36], [92, 40], [6, 60], [90, 70], [18, 86], [74, 88]];
  const keys = ["web", "reddit", "linkedin", "x", "x", "youtube", "youtube", "threads", "rss", "instagram"];
  return `<div class="a-art" aria-hidden="true">${spots
    .map(([x, y], i) => tile(T[keys[i]], `left:${x}%;top:${y}%`))
    .join("")}<div class="a-orb" style="background:${a.orb};color:#fff">${AGENT_GLYPH[a.glyph]}</div></div>`;
}

function orbit(a: AgentCfg): string {
  const ring = (r: number, keys: string[], off = 0) =>
    keys.map((k, i) => {
      const ang = (i / keys.length) * Math.PI * 2 + off;
      const x = 50 + r * Math.cos(ang), y = 50 + r * Math.sin(ang);
      return tile(T[k], `left:${x.toFixed(2)}%;top:${y.toFixed(2)}%`);
    }).join("");
  const outer = ["x", "linkedin", "threads", "instagram", "youtube", "rss", "reddit", "hn", "web", "video", "last30", "factory"];
  return `<div class="orbit" role="img" aria-label="${a.name} reaches every connected channel and research source through ContentForge">${ring(50, outer)}${ring(32.8, CH, 0.4)}<div class="core" style="background:${a.orb};color:#fff">${AGENT_GLYPH[a.glyph]}</div></div>`;
}

function renderAgent(a: AgentCfg): string {
  const caps = CAPS(a.name);
  const firstChip = a.chips[0];
  const body = `
<div class="a-hero ${a.theme}" style="--acc:${a.acc}"><div class="wrap">
  <div>
    <div class="a-badge"><i>${AGENT_GLYPH[a.glyph]}</i>${a.name} + ContentForge</div>
    <h1 id="a-title" class="head">${a.title}</h1>
    <ul>${a.bullets.map((b) => `<li>${b}</li>`).join("")}</ul>
    <div class="a-btns"><a class="btn btn-light" href="${APP_PATH}">${a.primary}</a><a class="btn btn-ghost" href="${APP_PATH}">Start for $0 ${I.arrows}</a></div>
    <p class="a-note">ContentForge is the AI-native content operating system that ${a.name} can drive through domain tools. Every publish passes a human approval gate. Part of the <a href="${DOCS_URL}">ContentForge agent docs</a>.</p>
  </div>
  ${heroArt(a)}
</div></div>

<div style="--acc:${a.acc}">
<section class="a-sec" aria-labelledby="s-connect"><div class=\"wrap\">
  <header class="sec-head"><h2 id="s-connect" class="head">How do I connect ContentForge to ${a.name}?</h2>
  <p class="lead">Today you use ${a.name} inside ContentForge by configuring it in ${a.where}. Next, the ContentForge MCP server will let ${a.name} call the same 29 domain tools from its own app, signed in to your server over OAuth.</p></header>
  <div class="steps2">
    <div class="panel"><div class="panel-top"><span class="n">1</span>Connect<small>about a minute</small></div>
      <h3 class="head">Add ContentForge to ${a.name}</h3>
      <p>Configure the provider in ${a.where} today. When the MCP server ships, paste this link as a custom connector.</p>
      <div class="code"><div class="code-top"><span class="dots"><i></i><i></i><i></i></span>Settings → Connectors → custom connector<button type="button" data-copy="${MCP_URL_EXAMPLE}">Copy</button></div><code>${MCP_URL_EXAMPLE.replace("<", "&lt;").replace(">", "&gt;")}</code></div>
      <p class="fine">Preview: the MCP endpoint is planned (roadmap Phase B) and does not answer yet. The in-app <a href="${APP_PATH}" style="text-decoration:underline">Agent workspace</a> uses the same tools now.</p></div>
    <div class="panel"><div class="panel-top"><span class="n">2</span>Ask<small class="live">live in ContentForge</small></div>
      <h3 class="head">Then just ask ${a.name}</h3>
      <p>Once connected, ${a.name} calls the ContentForge tools. Scheduled posts publish on time even after you close the chat.</p>
      <div class="chat"><div class="me" data-chat-me>${firstChip[0]}</div><div class="bot"><span data-chat-bot>${firstChip[1]}</span><small>via ContentForge · ${CH.slice(0, 3).map((k) => T[k].label).join(", ")}</small></div></div>
      <p class="fine" style="margin-top:16px">Also try</p>
      <div class="chips">${a.chips.map(([q, r]) => `<button type="button" data-chip="${q}" data-answer="${r.replace(/"/g, "&quot;")}">${q}</button>`).join("")}</div></div>
  </div>
  <ol class="steps4" style="list-style:none;padding:0">
    <li><i>1</i>Open ContentForge and go to ${a.where}.</li>
    <li><i>2</i>Add your provider key or gateway URL and pick a model per task.</li>
    <li><i>3</i>Open the Agent workspace and ask for research, drafts or a plan.</li>
    <li><i>4</i>Review the exact revision in the approval inbox, then schedule it.</li>
  </ol>
</div></section>

<div class="band ${a.theme}" role="region" aria-labelledby="s-band"><div class="wrap">
  <h2 id="s-band" class="head">One ${a.name} connection reaches every channel you run</h2>
  <p class="lead">Connect your channels in ContentForge once. From then on ${a.name} can research, draft and schedule for any of them, and ContentForge publishes at the time you set.</p>
  ${orbit(a)}
</div></div>

<section class="a-sec" aria-labelledby="s-compare"><div class=\"wrap\">
  <header class="sec-head"><h2 id="s-compare" class="head">${a.compare.h}</h2>
  <p class="lead">Start in the Agent workspace today. Move to the connector when it ships if you prefer to stay in ${a.name}.</p></header>
  <div class="table" role="table"><div class="tr" role="row"><span role="columnheader"></span><span role="columnheader">Agent workspace</span><span role="columnheader">MCP connector</span></div>
    ${a.compare.rows.map((r) => `<div class="tr" role="row">${r.map((c) => `<span role="cell">${c}</span>`).join("")}</div>`).join("")}</div>
</div></section>

<section class="a-sec" aria-labelledby="s-caps"><div class=\"wrap\">
  <header class="sec-head"><h2 id="s-caps" class="head">What can ${a.name} do with ContentForge?</h2>
  <p class="lead">Research, create, repurpose, schedule and measure, all through the domain tools it discovers once connected.</p></header>
  <div class="cards3">${caps.map(([ic, h, p]) => `<div class="fcard"><span class="ic">${(I as Record<string, string>)[ic]}</span><h3 class="head">${h}</h3><p>${p}</p></div>`).join("")}</div>
</div></section>

<section class="a-sec" aria-labelledby="s-mcp"><div class=\"wrap\">
  <header class="sec-head"><h2 id="s-mcp" class="head">What are the ContentForge domain tools?</h2>
  <p class="lead">The same typed tools power the Agent workspace and the planned MCP server. They validate input, check ownership and return a structured envelope; agents never touch the database.</p></header>
  <div class="cards2">
    <div class="fcard"><span class="ic">${I.layers}</span><h3 class="head">How ${a.name} uses ContentForge</h3><p>research_topic, research_url, create_story, find_opportunities, repurpose_story, generate_artifact, generate_image, approve_artifact, schedule_publication, get_analytics and more.</p></div>
    <div class="fcard"><span class="ic">${I.shield}</span><h3 class="head">Guardrails it cannot skip</h3><p>Only approved revisions publish, research text is data and never instructions, rate limits apply, and uncertain publications are reconciled before any retry.</p></div>
  </div>
</div></section>

<section class="a-sec" aria-labelledby="s-ask"><div class=\"wrap\">
  <header class="sec-head"><h2 id="s-ask" class="head">What can you ask ${a.name} to make?</h2></header>
  <div class="cards4">${a.asks.map((x) => `<div class="fcard"><span class="ic">${I.edit}</span><h3 class="head">${x.h}</h3><q>${x.q}</q></div>`).join("")}</div>
</div></section>

<section class="a-sec" aria-labelledby="s-plat"><div class=\"wrap\">
  <header class="sec-head"><h2 id="s-plat" class="head">Which platforms can ${a.name} reach?</h2></header>
  <div class="plats">${TILES.map((t) => `<div class="plat">${tile(t)}<span>${t.label}<small>${t.kind === "channel" ? "Publish" : t.kind === "source" ? "Research" : "Video service"}</small></span></div>`).join("")}</div>
</div></section>

<section class="a-sec" aria-labelledby="s-same"><div class=\"wrap\">
  <header class="sec-head"><h2 id="s-same" class="head">${a.same.q}</h2></header>
  <div class="cards3">${a.same.cards.map(([h, p]) => `<div class="fcard"><h3 class="head" style="margin-top:0">${h}</h3><p>${p}</p></div>`).join("")}</div>
</div></section>

${a.path === "/claude" ? `<section class="a-sec" aria-labelledby="s-trouble"><div class=\"wrap\">
  <header class="sec-head"><h2 id="s-trouble" class="head">Pricing, security and troubleshooting</h2></header>
  <div class="cards3">
    <div class="fcard"><span class="ic">${I.check}</span><h3 class="head">How much does it cost?</h3><p>ContentForge is self-hosted with no subscription. You pay only your own model provider and any channel API costs, and AI usage is logged per call.</p></div>
    <div class="fcard"><span class="ic">${I.shield}</span><h3 class="head">How is access secured?</h3><p>Session or Auth0 sign-in, CSRF protection, an authentication gate on every API route, owner-scoped data and audit logs.</p></div>
    <div class="fcard"><span class="ic">${I.search}</span><h3 class="head">Something not working?</h3><p>Check the provider in Settings → AI providers, the channel connection in Settings, and the run history in the Agent workspace.</p></div>
  </div>
</div></section>

` : ""}

<section class="a-sec" aria-labelledby="s-others"><div class=\"wrap\">
  <header class="sec-head"><h2 id="s-others" class="head">Other AI agents that work with ContentForge</h2></header>
  <div class="agents">${AGENT_PAGES.map((p) => `<a href="${p.path}"${p.path === a.path ? ' aria-current="page"' : ""}><i style="background:${p.bg}">${AGENT_GLYPH[p.glyph]}</i><span>${p.name}<small>${p.note}</small></span></a>`).join("")}${MORE_AGENTS.map(([n, d, g, bg]) => `<div class="soon"><i style="background:${bg}">${AGENT_GLYPH[g]}</i><span>${n}<small>${d}</small></span></div>`).join("")}<a href="${REPO_URL}"><i style="background:#333">${I.github}</i><span>Your own agent<small>Use the API directly</small></span></a></div>
</div></section>

<section class="a-sec" aria-labelledby="s-faq"><div class=\"wrap\">
  <header class="sec-head"><h2 id="s-faq" class="head">Frequently asked questions about ${a.name} and ContentForge</h2></header>
  ${faqList(a.faq)}
</div></section>

<section class="a-cta ${a.theme}" aria-labelledby="s-cta"><div class="wrap">
  <h2 id="s-cta" class="head">Let ${a.name} run your social media</h2>
  <p>Research once, create every format and publish after your approval.</p>
  <div class="a-btns"><a class="btn btn-light" href="${APP_PATH}">${a.primary}</a><a class="btn btn-ghost" href="${APP_PATH}">Start for $0 ${I.arrows}</a></div>
</div></section>
</div>`;

  return page({
    path: a.path,
    title: `${a.title} | ContentForge`,
    description: `Use ${a.name} with ContentForge to research topics, create platform-native content and schedule it after your approval.`,
    body,
    footerCta: false,
  });
}

export const renderAgentPages = (): Record<string, string> =>
  Object.fromEntries(AGENTS.map((a) => [a.path, renderAgent(a)]));
