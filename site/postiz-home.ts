/**
 * Home page body for the Postiz marketing-site rebuild.
 *
 * Section order, padding and per-breakpoint column counts are taken from
 * capture/README.md (the 1440 / 768 / 390 blocks). The document shell
 * (head, header, footer, script) lives in site/postiz-layout.ts and the
 * stylesheet in site/postiz-styles.ts; this module only produces <main>.
 */

import { PZ_MARK_URL } from "./postiz-layout";

export type PzFaq = { q: string; a: string };

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Channels the strip shows, 7 per row. Short letter marks only: no real logos. */
const STRIP: string[][] = [
  ["X", "in", "fb", "ig", "th", "tk", "yt"],
  ["pi", "rd", "bs", "ma", "tg", "dc", "wp"],
];

/** The six "Via …" cards plus the wide one. */
const VIA: { mark: string; title: string; text: string; mock: string }[] = [
  {
    mark: "C",
    title: "Via ChatGPT",
    text: "Connect the official app or a custom MCP link, then ask for next week in one message.",
    mock: "you · plan next week\nagent · 7 posts queued",
  },
  {
    mark: "CL",
    title: "Via Claude",
    text: "A connector plus MCP tools, so Claude can draft, schedule and publish while you chat.",
    mock: "you · draft a launch post\nagent · 3 channels ready",
  },
  {
    mark: "CC",
    title: "Via Claude Code",
    text: "Keep the workflow in the terminal: your repo, your prompts, your calendar.",
    mock: "$ postiz schedule --week 32\nqueued 7 · failed 0",
  },
  {
    mark: "GB",
    title: "Via Grok Bot",
    text: "Hand a bot the calendar and let it keep the queue full on a schedule.",
    mock: "bot · queue 12/30\nnext run · 06:00",
  },
  {
    mark: "HA",
    title: "Via Hermes / OpenClaw",
    text: "An always-on agent that watches a topic and posts when there is something to say.",
    mock: "watching · 4 sources\nposted · 3 today",
  },
  {
    mark: "MU",
    title: "Via Muse",
    text: "Draft in the tool you already write in, then send it to the queue in one step.",
    mock: "draft · 3 ideas\nsent · 3 to queue",
  },
  {
    mark: "∞",
    title: "Automate everything",
    text: "Every agent talks to the same calendar, the same channels and the same numbers — so you never post twice or skip a slot.",
    mock: "agents 8 · channels 30 · calendars 1\nwebhooks on · api on",
  },
];

const TOOLS: { tag: string; title: string; text: string; mock: string }[] = [
  {
    tag: "Calendar",
    title: "One calendar for every channel",
    text: "Drag a post to a new slot and every channel follows it.",
    mock: "cal",
  },
  {
    tag: "Analytics",
    title: "Numbers that answer a question",
    text: "Reach, replies and clicks per post, side by side.",
    mock: "bars",
  },
  {
    tag: "AI images",
    title: "Images made for the post",
    text: "Ask for a square, a story or a banner without leaving the calendar.",
    mock: "img",
  },
  {
    tag: "AI video",
    title: "Clips cut from long video",
    text: "Drop a recording in and get shorts sized for each channel.",
    mock: "vid",
  },
  {
    tag: "Clipping",
    title: "Turn a link into a post",
    text: "Paste a URL and get a draft with the title, the image and a hook.",
    mock: "clip",
  },
  {
    tag: "API",
    title: "Built to be scripted",
    text: "A REST API, webhooks and an MCP server on every plan.",
    mock: "code",
  },
];

export const PZ_HOME_FAQ: PzFaq[] = [
  {
    q: "What is Postiz?",
    a: "A scheduling tool for social media: one calendar for every channel you run, with an API and an MCP server so AI agents can post through it too.",
  },
  {
    q: "Can AI agents like Claude or ChatGPT post to social media through Postiz?",
    a: "Yes. Connect Postiz to the agent once and it can draft, schedule and publish through the accounts you have already linked.",
  },
  {
    q: "What social media channels does Postiz support?",
    a: "30+ channels, including X, LinkedIn profiles and company pages, Facebook Pages, Instagram, Threads, TikTok, YouTube, Pinterest, Reddit, Bluesky, Mastodon, Telegram, Discord and WordPress.",
  },
  {
    q: "Can Postiz auto-repeat or recycle evergreen posts?",
    a: "Yes. Mark a post to repeat, pick the interval, and the calendar keeps filling the slot for you.",
  },
  {
    q: "Does Postiz have a public API and webhooks?",
    a: "Every plan includes the REST API and webhooks, so you can schedule from your own code or from a pipeline.",
  },
  {
    q: "What analytics does Postiz provide?",
    a: "Per-post and per-channel numbers in one view: reach, likes, comments and clicks, with a link out to each platform's own report.",
  },
  {
    q: "Can I cross-post the same content to multiple platforms at once?",
    a: "Yes. Write once, then pick the channels. Per-platform settings let you change the copy, the media or the timing for each one.",
  },
  {
    q: "What AI features does Postiz include?",
    a: "Drafting and rewording, image generation, short video clips and clipping a long video into shorts.",
  },
  {
    q: "Can I manage multiple brands or clients from a single Postiz account?",
    a: "Yes. Group channels per brand or client and invite only the people who need that brand.",
  },
  {
    q: "How many team members can I invite, and what can they do?",
    a: "Unlimited from the Team plan up, with Admin and Member roles so the people who publish are not always the people who pay.",
  },
  {
    q: "How much does Postiz cost, and what's included in each plan?",
    a: "Standard $29, Team $39, Pro $49 and Ultimate $99 a month, with 5, 10, 30 or 100 channels, unlimited posts, the API and webhooks.",
  },
  {
    q: "Can I swap or change my connected channels after choosing a plan?",
    a: "Yes, at any time. Changing plan takes effect straight away and your scheduled posts keep their slots.",
  },
  {
    q: "If I connect 3 Facebook pages, does that count as 1 channel or 3?",
    a: "Three. Every page, profile or account you connect counts as one channel.",
  },
  {
    q: "Is Postiz free?",
    a: "There is a 7-day trial for $0, and a self-hosted version you can run yourself at no cost.",
  },
  {
    q: "Is Postiz open-source?",
    a: "Yes, under AGPL-3.0. The whole app is on GitHub, so you can read it, change it and host it.",
  },
];

const ROTOR = ["ChatGPT", "Claude", "Claude Code", "Grok Bot", "Muse", "OpenAI", "dots", "OpenClaw", "Hermes Agent", "AI agents"];
/* capture/capture.json headings[level 1] is "Run your social media on autopilot
   with AI agents ChatGPT Claude Claude Code Gro…", and the phrase
   "Hermes Agent AI agents" occurs 3x in it — so the rotor has a ninth entry,
   "AI agents" (ev_f3f4834b01c809d64be7f08725b0744814a83b6fbb6babf6130abdc2ad2c15b5).
   The words are also separated by real spaces in the original's text; ours ran
   together as "…Grok Bot MuseOpenAI…" (ev_00d7dd8f9e4e0389d2fc0946265d67016698dba4307f823962f4308f96200246). */

function hero(): string {
  const words = ROTOR.map(
    (w, i) => `<span class="pz-rotor-word${i === 0 ? " is-on" : ""}"> ${esc(w)}</span>`,
  ).join("");
  return `<section class="pz-hero">
  <div class="pz-col">
    <span class="pz-eyebrow"><i aria-hidden="true">★</i>Open source · cloud or self-hosted</span>
    <h1>Run your social media on autopilot with AI agents<span class="pz-rotor" data-rotor='${esc(
      JSON.stringify(ROTOR),
    )}'>${words}</span></h1>
    <p class="pz-hero-sub">Plan, schedule and publish to 30+ channels from one calendar, while the agents you already use do the writing.</p>
    <div class="pz-btns">
      <a class="pz-btn pz-btn-lg pz-btn-light" href="https://platform.postiz.com/auth">Start for $0</a>
      <a class="pz-btn pz-btn-lg pz-btn-ghost" href="#pz-tools">See how it works</a>
    </div>
    <p class="pz-note">No card needed. Cancel whenever you like.</p>
  </div>
</section>`;
}

function demo(): string {
  const rail = Array.from({ length: 7 }, () => "<span></span>").join("");
  return `<section class="pz-demo" aria-label="Product preview">
  <p class="pz-demo-title">One calendar. Every channel. An agent in the loop.</p>
  <div class="pz-demo-stage">
    <div class="pz-demo-frame">
      <div class="pz-demo-win">
        <div class="pz-demo-rail" aria-hidden="true">${rail}</div>
        <div class="pz-demo-body">
          <div class="pz-bubble">Draft a launch post for Tuesday morning.</div>
          <div class="pz-bubble pz-reply">Queued for 9:00 on X, LinkedIn and Threads.</div>
          <div class="pz-bubble">Add a square image and a short hook.</div>
          <div class="pz-bubble pz-reply">Image attached. Nothing else needs you.</div>
          <div class="pz-demo-ask">Ask the agent anything…</div>
        </div>
      </div>
    </div>
  </div>
</section>`;
}

function strip(): string {
  const tiles = STRIP.flat()
    .map((m) => `<div class="pz-tile">${esc(m)}</div>`)
    .join("");
  return `<section class="pz-strip" aria-label="Channels you can publish to">
  <div class="pz-rows">${tiles}</div>
</section>`;
}

function who(): string {
  const items = [
    {
      mark: "AI",
      title: "AI-first marketers",
      text: "You already write with an agent. Point it at the calendar and the queue stays full.",
    },
    {
      mark: "DEV",
      title: "Developers",
      text: "A REST API, webhooks and an MCP server, so posting is one more thing your code can do.",
    },
    {
      mark: "OPS",
      title: "Automation teams",
      text: "One place to see every channel, every slot and who approved what.",
    },
  ]
    .map(
      (i) => `      <div class="pz-who-item">
        <div class="pz-badge" aria-hidden="true">${esc(i.mark)}</div>
        <h3>${esc(i.title)}</h3>
        <p>${esc(i.text)}</p>
      </div>`,
    )
    .join("\n");
  return `<section class="pz-who">
  <div class="pz-col">
    <h2 class="pz-h2">Who is Postiz for?</h2>
    <div class="pz-who-grid">
${items}
    </div>
  </div>
</section>`;
}

function action(): string {
  const steps = ["Idea", "Draft", "Review", "Queue", "Publish", "Reply", "Measure", "Repeat"]
    .map((s) => `<div class="pz-step">${esc(s)}</div>`)
    .join("");
  return `<section class="pz-action">
  <div class="pz-col">
    <h2 class="pz-h2">See Postiz in action</h2>
    <p class="pz-sub">From a message to a published post, with the same calendar doing the work at every step.</p>
    <div class="pz-poster">
      <div><b>Draft to done</b><em>without leaving the chat</em></div>
      <div class="pz-lifecycle" aria-hidden="true">${steps}</div>
    </div>
  </div>
</section>`;
}

function power(): string {
  const cards = VIA.map((v, i) => {
    const wide = i === VIA.length - 1 ? " pz-wide" : "";
    return `      <article class="pz-via${wide}">
        <div class="pz-via-head">
          <i aria-hidden="true">${esc(v.mark)}</i>
          <h3>${esc(v.title)}</h3>
        </div>
        <p>${esc(v.text)}</p>
        <div class="pz-mock">${esc(v.mock)}</div>
      </article>`;
  }).join("\n");
  return `<section class="pz-power">
  <div class="pz-col">
    <h2 class="pz-h2">Power Your Content with AI and Automation</h2>
    <p class="pz-sub">The agents you already use, connected to the channels you already run.</p>
    <div class="pz-via-grid">
${cards}
    </div>
  </div>
</section>`;
}

const TOOL_MOCKS: Record<string, string> = {
  cal: `<div class="pz-cal"><div></div><div class="pz-ev"></div><div></div><div class="pz-ev"></div><div></div></div>`,
  bars: `<div class="pz-cal"><div class="pz-ev"></div><div></div><div class="pz-ev"></div><div></div><div class="pz-ev"></div></div>`,
  img: `<div class="pz-cal"><div class="pz-ev"></div><div class="pz-ev"></div><div></div><div class="pz-ev"></div><div></div></div>`,
  vid: `<div class="pz-cal"><div></div><div class="pz-ev"></div><div class="pz-ev"></div><div></div><div></div></div>`,
  clip: `<div class="pz-cal"><div class="pz-ev"></div><div></div><div></div><div class="pz-ev"></div><div class="pz-ev"></div></div>`,
  code: `<div class="pz-cal"><div></div><div class="pz-ev"></div><div></div><div class="pz-ev"></div><div class="pz-ev"></div></div>`,
};

function tools(): string {
  const cards = TOOLS.map(
    (t) => `      <article class="pz-tool">
        <span class="pz-tag">${esc(t.tag)}</span>
        <h3>${esc(t.title)}</h3>
        <p>${esc(t.text)}</p>
        <div class="pz-mock">${TOOL_MOCKS[t.mock] ?? ""}</div>
      </article>`,
  ).join("\n");
  const full = `      <article class="pz-tool pz-full">
        <span class="pz-tag">Agents</span>
        <h3>Every agent, one queue</h3>
        <p>ChatGPT, Claude, Claude Code, Codex, Cursor and the rest all write into the same calendar, so nothing is posted twice and no slot is left empty.</p>
        <div class="pz-mock">
          <div class="pz-chatrow"><span></span><span></span><span></span></div>
          <div class="pz-chatrow"><span></span><span></span></div>
        </div>
      </article>`;
  return `<section class="pz-tools" id="pz-tools">
  <div class="pz-col">
    <div class="pz-tools-in">
      <h2 class="pz-h2">All the tools you need for social media growth in one place</h2>
      <div class="pz-tools-grid">
${cards}
${full}
      </div>
    </div>
  </div>
</section>`;
}

function publish(): string {
  const channels = [
    "X",
    "LinkedIn profile",
    "LinkedIn page",
    "Facebook Pages",
    "Instagram",
    "Threads",
    "TikTok",
    "YouTube",
    "Pinterest",
    "Reddit",
    "Bluesky",
    "Mastodon",
    "Telegram",
    "Discord",
    "Slack",
    "WordPress",
    "Medium",
    "Dev.to",
  ]
    .map(
      (c) =>
        `<div class="pz-pub"><i aria-hidden="true">${esc(
          c.slice(0, 2).toUpperCase(),
        )}</i><span>${esc(c)}</span></div>`,
    )
    .join("\n      ");
  return `<section class="pz-publish">
  <div class="pz-col">
    <h2 class="pz-h2">Publish to 30+ social media channels</h2>
    <p class="pz-sub">Connect once. Post from the calendar, the API or an agent.</p>
    <div class="pz-pub-grid">
      ${channels}
    </div>
  </div>
</section>`;
}

function ready(): string {
  return `<section class="pz-ready" id="pz-ready">
  <div class="pz-col">
    <div class="pz-cta-band">
      <div>
        <h3>Ready to get started?</h3>
        <p>Start for $0, connect the channels you already run, and let an agent do the scheduling.</p>
      </div>
      <div class="pz-btns">
        <a class="pz-btn pz-btn-light" href="https://platform.postiz.com/auth">Start for $0</a>
        <a class="pz-btn pz-btn-ghost" href="/#pz-faq">Read the FAQ</a>
      </div>
    </div>
  </div>
</section>`;
}

function wall(): string {
  /* Card geometry, text ladder and the 17-card count are taken from the
     original's measured outline (capture/capture.json, "outline"): each card is
     432 wide in three 432px columns at x 60 / 504 / 948, padding 29, radius 20,
     bg #1a191999, quote 18px/22.23px, avatar 40, name 18px/20px bold,
     handle 12px/13px, 24px source mark, 16px between rows. The words and the
     avatars are neutral placeholders: no real quotes, photos or brand marks. */
  const quotes: { text: string; name: string; role: string }[] = [
    {
      text: "We used to keep the week in a spreadsheet and a group chat. Now one request fills the calendar and everyone can see the queue before anything goes out.",
      name: "Anon A.",
      role: "@anon_a",
    },
    {
      text: "Set it up over a weekend and it has not needed me since.",
      name: "Anon B.",
      role: "@anon_b",
    },
    {
      text: "The part I did not expect was the API. Our build now schedules its own release notes the moment a version ships, so nobody has to remember.",
      name: "Anon C.",
      role: "@anon_c",
    },
    {
      text: "Approvals finally match how we actually work. A draft waits for the right person instead of the next person who happens to be online.",
      name: "Anon D.",
      role: "@anon_d",
    },
    {
      text: "One post, every channel we run, no copy-paste.",
      name: "Anon E.",
      role: "@anon_e",
    },
    {
      text: "I asked for a week of posts while the kettle boiled. I checked the drafts over coffee and it was done.",
      name: "Anon F.",
      role: "@anon_f",
    },
    {
      text: "Self-hosted in an afternoon. Every account we manage sits in one calendar, which sounds small until you have tried doing it across nine logins.",
      name: "Anon G.",
      role: "@anon_g",
    },
    {
      text: "Handing the queue to an agent sounded like a gimmick until it started keeping the week full on its own.",
      name: "Anon H.",
      role: "@anon_h",
    },
    {
      text: "Roles and permissions were the reason we switched. Writers draft, editors approve, and nothing reaches the calendar by accident.",
      name: "Anon I.",
      role: "@anon_i",
    },
    {
      text: "Clipping the long videos into shorts saved us a whole editor.",
      name: "Anon J.",
      role: "@anon_j",
    },
    {
      text: "The calendar view is the thing. Seeing the next month laid out tells you instantly whether the queue is healthy or whether you are about to go quiet for a fortnight.",
      name: "Anon K.",
      role: "@anon_k",
    },
    {
      text: "Open source mattered to us because we had to self-host for compliance. It passed review and it has been boring ever since, which is what we wanted from it.",
      name: "Anon L.",
      role: "@anon_l",
    },
    {
      text: "Replies used to live in six inboxes. Now they land in one place next to the post they belong to.",
      name: "Anon M.",
      role: "@anon_m",
    },
    {
      text: "I run content on my own, so the value for me is not a team feature, it is simply that the week gets planned once instead of every morning.",
      name: "Anon N.",
      role: "@anon_n",
    },
    {
      text: "The terminal workflow suits me. I keep the schedule in the repo and the calendar reflects it.",
      name: "Anon O.",
      role: "@anon_o",
    },
    {
      text: "Every channel in one calendar, and the analytics next to the post rather than in a separate report nobody opens.",
      name: "Anon P.",
      role: "@anon_p",
    },
    {
      text: "We schedule across a dozen accounts for clients. Having a single queue that we can hand over without losing the history is the difference between a busy week and a bad one.",
      name: "Anon Q.",
      role: "@anon_q",
    },
  ];
  const cards = quotes
    .map(
      (q) => `      <figure class="pz-quote">
        <p>${esc(q.text)}</p>
        <div class="pz-by"><img src="${PZ_ICON}" alt="" width="40" height="40" class="pz-ava"><div><b>${esc(
          q.name,
        )}</b><small>${esc(q.role)}</small></div><span class="pz-src" aria-hidden="true">#</span></div>
      </figure>`,
    )
    .join("\n");
  return `<section class="pz-wall" id="pz-wall">
  <div class="pz-col">
    <div class="pz-wall-head">
      <div class="pz-badge" aria-hidden="true">♥</div>
      <h2 class="pz-h2">Wall of love</h2>
    </div>
    <div class="pz-wall-list">
${cards}
    </div>
  </div>
</section>`;
}

function faq(): string {
  const items = PZ_HOME_FAQ.map(
    (f) => `        <details>
          <summary><h3>${esc(f.q)}</h3><span class="pz-plus" aria-hidden="true"></span></summary>
          <p>${esc(f.a)}</p>
        </details>`,
  ).join("\n");
  return `<section class="pz-faq" id="pz-faq">
  <div class="pz-col">
    <div class="pz-faq-grid">
      <div><h2>Frequently asked questions</h2></div>
      <div class="pz-faq-list">
${items}
      </div>
    </div>
  </div>
</section>`;
}

/**      One neutral placeholder mark, sized as the original's agent icon. */
const PZ_ICON = PZ_MARK_URL;

/** The 16 agent names the original renders as 23 px marks (capture/capture.json
 *  assets.images, /svgs/agents/*). Placeholders carry the same alt text. */
const PZ_AGENT_MARKS = [
  "ChatGPT",
  "OpenAI dots",
  "Claude",
  "Claude Cowork",
  "Claude Code",
  "Codex",
  "Cursor",
  "OpenClaw",
  "Hermes Agent",
  "Grok Bot",
  "Grok Build",
  "Muse",
  "Manus",
  "Cue",
  "Perplexity Computer",
  "MCP Server",
];

function marks(): string {
  const items = PZ_AGENT_MARKS.map(
    (a) =>
      `      <li><img src="${PZ_ICON}" alt="${esc(a)}" width="23" height="23" loading="lazy"></li>`,
  ).join("\n");
  return `  <section class="pz-marks" aria-label="AI agents that use Postiz">
    <div class="pz-col">
      <ul class="pz-mark-list">
${items}
      </ul>
    </div>
  </section>`;
}

/** The whole <main> of the home page. */
export function postizHomeBody(): string {
  return [hero(), marks(), strip(), demo(), who(), action(), power(), tools(), publish(), ready(), wall(), faq()].join("\n");
}
