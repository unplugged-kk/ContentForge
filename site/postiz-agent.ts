/**
 * The four agent pages (/chatgpt, /dots, /claude, /claude-cowork).
 *
 * The originals share one skeleton: a hero, then a run of sections whose
 * outermost padding is `0 20px` (their rhythm comes from inner margins, not
 * section padding), then a CTA and the shared footer. Column counts per
 * breakpoint come from capture/routes/<slug>/README.md; they are expressed
 * with the stylesheet's --cm / --c7 / --ct ladder set inline per grid.
 */

import { PZ_MARK_URL } from "./postiz-layout";

export type PzAgentPath = "/chatgpt" | "/dots" | "/claude" | "/claude-cowork";

type Card = { mark: string; title: string; text: string };

type Block =
  | { kind: "cards"; id?: string; title: string; lede?: string; cols: string; cards: Card[]; wide?: boolean }
  | { kind: "steps"; id?: string; title: string; lede?: string; cols: string; cards: Card[]; code?: string; wide?: boolean }
  | { kind: "table"; id?: string; title: string; lede?: string; head: string[]; rows: string[][]; wide?: boolean };

type Faq = { q: string; a: string };

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function hero(o: { title: string; sub: string; note: string; live?: boolean }): string {
  return `<section class="pz-hero">
  <div class="pz-col">
    <span class="pz-eyebrow"><i aria-hidden="true">★</i>${
      o.live ? '<span class="pz-live" aria-hidden="true"></span> ' : ""
    }Works with the agent you already use</span>
    <h1>${esc(o.title)}</h1>
    <p class="pz-hero-sub">${esc(o.sub)}</p>
    <div class="pz-btns">
      <a class="pz-btn pz-btn-lg pz-btn-light" href="https://platform.postiz.com/auth">Start for $0</a>
      <a class="pz-btn pz-btn-lg pz-btn-ghost" href="#pz-faq">Read the FAQ</a>
    </div>
    <p class="pz-note">${esc(o.note)}</p>
    <img src="${PZ_MARK_URL}" alt="Preview of the agent working in the Postiz calendar" aria-hidden="true" style="width:100%;max-width:640px;height:160px;object-fit:contain;border-radius:14px;margin:24px auto 0">
  </div>
</section>`;
}

function renderBlock(b: Block): string {
  const id = b.id ? ` id="${b.id}"` : "";
  const head = `    <header class="pz-sub-head">
      <h2>${esc(b.title)}</h2>
      ${b.lede ? `<p class="pz-sec-lede">${esc(b.lede)}</p>` : ""}
    </header>`;

  if (b.kind === "table") {
    const headCells = b.head.map((h) => `<th scope="col">${esc(h)}</th>`).join("");
    const rows = b.rows
      .map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join("")}</tr>`)
      .join("\n        ");
    return `  <section class="pz-sec"${id}>
    <div class="pz-col">
${head}
      <table class="pz-table">
        <thead><tr>${headCells}</tr></thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  </section>`;
  }

  const gridCls = b.kind === "steps" ? "pz-grid pz-steps" : "pz-grid pz-sec-grid";
  const cells = b.cards
    .map((c) =>
      b.kind === "steps"
        ? `        <article class="pz-stepcard">
          <i aria-hidden="true">${esc(c.mark)}</i>
          <h3>${esc(c.title)}</h3>
          <p>${esc(c.text)}</p>
          <img src="${PZ_MARK_URL}" alt="Illustration for ${esc(c.title)}" style="width:100%;height:110px;object-fit:cover;border-radius:10px;margin-top:12px">
        </article>`
        : `        <article class="pz-card">
          <div class="pz-badge" aria-hidden="true">${esc(c.mark)}</div>
          <h3>${esc(c.title)}</h3>
          <p>${esc(c.text)}</p>
          <img src="${PZ_MARK_URL}" alt="Illustration for ${esc(c.title)}" style="width:100%;height:110px;object-fit:cover;border-radius:10px;margin-top:12px">
        </article>`,
    )
    .join("\n");
  const code = b.kind === "steps" && b.code ? `\n      <div class="pz-code">${esc(b.code)}</div>` : "";
  const colCls = b.wide ? "pz-col-wide" : "pz-col";
  return `  <section class="pz-sec"${id}>
    <div class="${colCls}">
${head}
      <div class="${gridCls}" style="${b.cols}">
${cells}
      </div>${code}
    </div>
  </section>`;
}

function faqSection(items: Faq[], title = "Frequently asked questions"): string {
  const list = items
    .map(
      (f) => `        <details>
          <summary><h3>${esc(f.q)}</h3><span class="pz-plus" aria-hidden="true"></span></summary>
          <p>${esc(f.a)}</p>
        </details>`,
    )
    .join("\n");
  return `  <section class="pz-sec" id="pz-faq">
    <div class="pz-col">
      <header class="pz-sub-head">
        <h2>${esc(title)}</h2>
      </header>
      <div class="pz-faq-list">
${list}
      </div>
    </div>
  </section>`;
}

function ctaSection(title: string, text: string): string {
  return `  <section class="pz-sec" id="pz-ready">
    <div class="pz-col">
      <div class="pz-cta-band">
        <div>
          <h3>${esc(title)}</h3>
          <p>${esc(text)}</p>
        </div>
        <div class="pz-btns">
          <a class="pz-btn pz-btn-light" href="https://platform.postiz.com/auth">Start for $0</a>
          <button class="pz-btn pz-btn-ghost" type="button" data-back="/">Back to Postiz</button>
        </div>
      </div>
    </div>
  </section>`;
}

/* ------------------------------------------------------------------ /chatgpt */

const CHATGPT: { hero: Parameters<typeof hero>[0]; blocks: Block[]; faq: Faq[]; faqTitle?: string; cta: [string, string] } = {
  hero: {
    title: "Schedule social media posts with ChatGPT",
    sub: "Connect Postiz to ChatGPT as an official app or a custom MCP connector, then schedule to 30+ platforms by asking.",
    note: "Free while you try it. No card needed.",
  },
  blocks: [
    {
      kind: "steps",
      title: "How do I connect Postiz to ChatGPT?",
      lede: "Four steps, once. After this the calendar is a sentence away.",
      cols: "--cm:1;--c7:2;--ct:4",
      cards: [
        { mark: "1", title: "Open ChatGPT apps", text: "In the ChatGPT app, open Settings and find the apps or connectors list." },
        { mark: "2", title: "Find Postiz", text: "Search for the official Postiz app and add it, or paste the custom MCP link instead." },
        { mark: "3", title: "Sign in", text: "Authorise the account once. ChatGPT never sees your social passwords." },
        { mark: "4", title: "Ask for a post", text: "Say what to post and where. It lands in the calendar for review or straight into a slot." },
      ],
      code: "Settings → Apps → Postiz → Connect\nor:  https://mcp.postiz.com/",
    },
    {
      kind: "cards",
      title: "Official Postiz app or custom MCP link?",
      lede: "Both reach the same calendar. Pick the one that fits how much control you want.",
      cols: "--cm:3;--c7:2;--ct:3",
      cards: [
        { mark: "A", title: "Official app", text: "One click, no key to copy, and updates arrive on their own. Best if you just want posting." },
        { mark: "M", title: "Custom MCP link", text: "Paste a URL in the developer settings. Best when you also want images, video and clipping." },
        { mark: "=", title: "Same calendar", text: "Either way the posts show up beside everything else, with the same channels and the same numbers." },
      ],
    },
    {
      kind: "cards",
      id: "pz-tools",
      title: "What can ChatGPT do with Postiz?",
      lede: "One connector powers every channel you run.",
      cols: "--cm:1;--c7:2;--ct:3",
      cards: [
        { mark: "✎", title: "Just Ask in Plain English", text: "No syntax, no templates: say what you want posted and when." },
        { mark: "30", title: "30+ platforms", text: "X, LinkedIn, Instagram, Threads, TikTok, YouTube, Reddit, Bluesky and more." },
        { mark: "1", title: "Official Connector, One Click", text: "Add the app, sign in, done. No key to copy." },
        { mark: "⌚", title: "Plan & Schedule Ahead", text: "Ask for a week and it fills the slots you already use." },
        { mark: "▣", title: "Generate Images & Videos", text: "The custom MCP link adds image, clip and clipping tools." },
        { mark: "🔒", title: "Stays in your account", text: "Access is OAuth-based. Revoke it whenever you like from your account." },
      ],
    },
    {
      kind: "cards",
      title: "What is the Postiz MCP?",
      lede: "MCP is the connector standard ChatGPT and Claude both speak.",
      cols: "--cm:1;--c7:1;--ct:2",
      cards: [
        { mark: "M", title: "A hosted server", text: "Postiz runs it for you with OAuth sign-in, so there is nothing to install." },
        { mark: "T", title: "A set of tools", text: "List channels, draft, schedule, publish, read numbers: each one is a tool the agent can call." },
      ],
    },
    {
      kind: "cards",
      title: "What can you ask ChatGPT to post?",
      lede: "Four things people ask for most.",
      cols: "--cm:2;--c7:2;--ct:4",
      cards: [
        { mark: "⇢", title: "Ship a launch post", text: "“Post the launch to X and LinkedIn at 9 tomorrow.”" },
        { mark: "▦", title: "Plan a whole week", text: "“Draft a week of posts for our docs series.”" },
        { mark: "▣", title: "Post with a generated image", text: "“Write it and make a square image to go with it.”" },
        { mark: "◎", title: "Share with your community", text: "“Put a short version in the Discord and the Telegram.”" },
      ],
    },
    {
      kind: "cards",
      title: "Which platforms can ChatGPT post to?",
      lede: "Everything Postiz supports, from the same connector.",
      cols: "--cm:2;--c7:4;--ct:6",
      cards: [
        { mark: "X", title: "X", text: "Posts and threads." },
        { mark: "in", title: "LinkedIn", text: "Profiles and company pages." },
        { mark: "fd", title: "Facebook Pages", text: "Page posts and images." },
        { mark: "ig", title: "Instagram", text: "Feed, carousel and stories." },
        { mark: "th", title: "Threads", text: "Posts and replies." },
        { mark: "tk", title: "TikTok", text: "Video with caption." },
      ],
    },
    {
      kind: "table",
      title: "Is ChatGPT the same as Codex?",
      lede: "No. They share a model family but not a place to run or a job to do.",
      head: ["", "ChatGPT", "Codex"],
      rows: [
        ["Where it runs", "In the ChatGPT app", "In a terminal or an editor"],
        ["Best for", "Everyday posting", "Scripted pipelines"],
        ["Setup", "Official app or MCP link", "MCP server, CLI or the API"],
      ],
    },
  ],
  faq: [
    { q: "How does Postiz work with ChatGPT?", a: "Postiz exposes its calendar as tools. ChatGPT calls them, so a sentence becomes a scheduled post." },
    { q: "How do I connect Postiz to ChatGPT?", a: "Add the official app from the ChatGPT settings, or paste the custom MCP link. Sign in once and it is ready." },
    { q: "Do I need a paid ChatGPT plan to use Postiz?", a: "The official app works on the plans that allow apps; the custom MCP link needs a plan that can reach developer settings." },
    { q: "Is ChatGPT the same as Codex?", a: "No. ChatGPT is a chat app; Codex runs in a terminal or editor for scripted work." },
    { q: "What can ChatGPT do with Postiz?", a: "Draft, schedule, publish, read channel lists and pull numbers, on every channel you have linked." },
    { q: "Can ChatGPT post to social media on a schedule while I am away?", a: "Yes. Ask for a time or a week and the calendar holds the posts until then." },
    { q: "Is it safe? Does ChatGPT need my social media passwords?", a: "It never gets your passwords. Access is granted through OAuth and you can revoke it at any time." },
    { q: "Which social media platforms can ChatGPT post to?", a: "30+, including X, LinkedIn, Facebook Pages, Instagram, Threads, TikTok, YouTube, Reddit and WordPress." },
    { q: "ChatGPT does not show the Postiz tools. What should I check?", a: "Confirm the connector is enabled, then start a new chat. Long chats sometimes keep an older tool list." },
    { q: "Is it free to start?", a: "There is a 7-day trial for $0, and the self-hosted version is free." },
  ],
  faqTitle: "Frequently asked questions about ChatGPT and Postiz",
  cta: ["Let ChatGPT run your social media", "Connect once, then ask for a week of posts whenever the queue runs low."],
};

/* --------------------------------------------------------------------- /dots */

const DOTS: { hero: Parameters<typeof hero>[0]; blocks: Block[]; faq: Faq[]; faqTitle?: string; cta: [string, string] } = {
  hero: {
    title: "Schedule social media posts with OpenAI dots",
    sub: "Connect Postiz to your dot with the official plugin. Your always-on agent drafts, schedules and publishes to 30+ platforms.",
    note: "The plugin is free. Postiz starts at $0 for 7 days.",
  },
  blocks: [
    {
      kind: "steps",
      title: "How do I connect Postiz to my dot?",
      lede: "Five steps. You only do them once.",
      cols: "--cm:1;--c7:5;--ct:5",
      cards: [
        { mark: "1", title: "Open your dot", text: "Start the dot you want doing the posting." },
        { mark: "2", title: "Add a plugin", text: "Open the plugin list in the dot's settings." },
        { mark: "3", title: "Find Postiz", text: "Search the plugin directory and add Postiz." },
        { mark: "4", title: "Sign in", text: "Authorise your Postiz account through the OAuth screen." },
        { mark: "5", title: "Give it a job", text: "Tell the dot what cadence to keep and on which channels." },
      ],
      code: "dot settings → Plugins → Postiz → Connect",
    },
    {
      kind: "cards",
      id: "pz-tools",
      title: "What can your dot do with Postiz?",
      lede: "An always-on agent with a calendar is a different job from a chat window.",
      cols: "--cm:1;--c7:2;--ct:3",
      cards: [
        { mark: "24", title: "Keep the queue full", text: "The dot can top up the calendar whenever a slot is empty." },
        { mark: "⚑", title: "Watch a topic", text: "Point it at sources you trust and let it post when something happens." },
        { mark: "◎", title: "Report back", text: "Ask what went out this week and how it did." },
      ],
    },
    {
      kind: "cards",
      title: "What are OpenAI dots?",
      lede: "Small, persistent agents that run away from the chat window.",
      cols: "--cm:1;--c7:2;--ct:3",
      cards: [
        { mark: "▪", title: "A dot, not a chat", text: "It keeps its own context and runs on its own schedule." },
        { mark: "⚙", title: "Plugins give it reach", text: "A dot is only as useful as the tools it can call." },
        { mark: "⤢", title: "Built for background work", text: "You check the results; it does not need you present." },
      ],
    },
    {
      kind: "cards",
      title: "What is the Postiz plugin in ChatGPT?",
      lede: "The same connection, two names for it.",
      cols: "--cm:2;--c7:1;--ct:2",
      cards: [
        { mark: "P", title: "One plugin, one calendar", text: "The plugin is the door; the calendar behind it is the same one you use by hand." },
        { mark: "M", title: "Under it, MCP", text: "Technically it speaks MCP, the connector standard, so the same server serves other agents." },
      ],
    },
    {
      kind: "cards",
      title: "What can you ask your dot to post?",
      lede: "Short instructions work best.",
      cols: "--cm:2;--c7:2;--ct:4",
      cards: [
        { mark: "▦", title: "A weekly plan", text: "“Every Monday, fill the week with three posts per channel.”" },
        { mark: "⇢", title: "A launch", text: "“When the changelog ships, post it to X and LinkedIn.”" },
        { mark: "▣", title: "An image post", text: "“Make a square image and post it to Instagram.”" },
        { mark: "◎", title: "A digest", text: "“Summarise the week and post it to the community channel.”" },
      ],
    },
    {
      kind: "cards",
      title: "Can a dot post on a schedule automatically?",
      lede: "Yes, and that is the point of the pairing.",
      cols: "--cm:1;--c7:2;--ct:3",
      cards: [
        { mark: "⌚", title: "It can schedule ahead", text: "Ask once for a week and the calendar holds the slots." },
        { mark: "⟳", title: "It can repeat", text: "Evergreen posts can repeat on an interval you choose." },
        { mark: "✓", title: "You can review first", text: "Keep an approval step on, or let it publish and read the reports." },
      ],
    },
    {
      kind: "cards",
      title: "Is it safe to let a dot post for you?",
      lede: "It is as safe as the permissions you give it.",
      cols: "--cm:3;--c7:2;--ct:3",
      cards: [
        { mark: "🔒", title: "No passwords shared", text: "The dot gets an OAuth grant, not your social logins." },
        { mark: "⌫", title: "Revoke any time", text: "Remove the plugin and the grant goes with it." },
        { mark: "◫", title: "Keep the audit trail", text: "Every post says which agent queued it and when." },
      ],
    },
  ],
  faq: [
    { q: "How do OpenAI dots work with Postiz?", a: "Add the Postiz plugin to a dot and the dot can draft, schedule and publish through your calendar." },
    { q: "How do I add the Postiz plugin to a dot?", a: "Open the dot's plugin list, find Postiz, add it and sign in once." },
    { q: "Do I need a paid Postiz plan?", a: "The trial covers the first 7 days; after that any plan includes the calendar and the API." },
    { q: "Which platforms can a dot post to?", a: "All 30+ that Postiz supports, from X and LinkedIn to Reddit, Bluesky and WordPress." },
    { q: "Can a dot post on a schedule automatically?", a: "Yes. Tell it the cadence and it keeps the calendar full." },
    { q: "Is it safe to let a dot post for you?", a: "Access is OAuth-based and revocable, and every post records which agent queued it." },
    { q: "How much does it cost to use dots with Postiz?", a: "The plugin is free; Postiz plans start at $29 a month after the trial." },
    { q: "A channel is missing from my dot. What do I check?", a: "Confirm the channel is connected in Postiz first; the dot can only post where Postiz can." },
  ],
  faqTitle: "Frequently asked questions about dots and Postiz",
  cta: ["Let your dot run the calendar", "Connect the plugin once and the queue looks after itself."],
};

/* ------------------------------------------------------------------- /claude */

const CLAUDE: { hero: Parameters<typeof hero>[0]; blocks: Block[]; faq: Faq[]; faqTitle?: string; cta: [string, string] } = {
  hero: {
    title: "How to post to social media from Claude",
    sub: "Add the official Postiz connector and schedule posts on 30+ platforms by asking. Use the custom MCP link for image, video and clipping tools.",
    note: "Connector and MCP link both included in every plan.",
  },
  blocks: [
    {
      kind: "steps",
      title: "How to post to social media from Claude in 3 steps",
      lede: "Once per account. After that it is a sentence.",
      cols: "--cm:1;--c7:3;--ct:3",
      cards: [
        { mark: "1", title: "Add the connector", text: "Open Claude's connectors list and add the official Postiz connector." },
        { mark: "2", title: "Authorise", text: "Sign in through OAuth so Claude can reach your calendar without your passwords." },
        { mark: "3", title: "Ask for a post", text: "Describe the post and the channel. It appears in the calendar or goes out on schedule." },
      ],
      code: "Settings → Connectors → Postiz → Connect\ncustom MCP:  https://mcp.postiz.com/",
    },
    {
      kind: "cards",
      title: "Official connector vs custom MCP link: what is the difference?",
      lede: "One is quick, the other is complete.",
      cols: "--cm:3;--c7:2;--ct:3",
      cards: [
        { mark: "O", title: "Official connector", text: "One click and no key. Covers drafting, scheduling and publishing." },
        { mark: "M", title: "Custom MCP link", text: "Adds the heavier tools: image generation, video clips and clipping long video." },
        { mark: "=", title: "Both at once", text: "They can live side by side; the calendar does not mind which one you used." },
      ],
    },
    {
      kind: "cards",
      id: "pz-tools",
      title: "What can Claude do with Postiz?",
      lede: "What Claude can do with Postiz, once the connector is in place.",
      cols: "--cm:1;--c7:2;--ct:3",
      cards: [
        { mark: "✎", title: "Write in your voice", text: "Claude already has the context; the connector gives it somewhere to publish." },
        { mark: "⌚", title: "Schedule ahead", text: "Ask for a week and the slots fill in the order you already use." },
        { mark: "30", title: "30+ platforms", text: "One connector, every channel you have connected to Postiz." },
        { mark: "▣", title: "Images, video, clipping", text: "The MCP link adds the media tools the connector alone does not have." },
        { mark: "◎", title: "Read the numbers", text: "Ask how last week went and get per-post reach and replies." },
        { mark: "⟲", title: "Turn a long video into shorts", text: "Point the clipping tool at a recording and pick the moments worth posting." },
      ],
    },
    {
      kind: "cards",
      title: "What is the Postiz MCP?",
      lede: "MCP is the connector standard Claude and ChatGPT both speak.",
      cols: "--cm:1;--c7:1;--ct:2",
      cards: [
        { mark: "M", title: "A hosted server", text: "Postiz runs it with OAuth sign-in, so there is nothing to install or host." },
        { mark: "T", title: "A set of tools", text: "List channels, draft, schedule, publish, generate media, read numbers." },
      ],
    },
    {
      kind: "cards",
      title: "What can I ask Claude to post?",
      lede: "The four requests people start with.",
      cols: "--cm:1;--c7:2;--ct:4",
      cards: [
        { mark: "⇢", title: "Ship a launch post", text: "“Draft the launch and schedule it for Tuesday at 9.”" },
        { mark: "▦", title: "Plan a whole week", text: "“Give me a week of posts for the docs series.”" },
        { mark: "▣", title: "Post with a generated image", text: "“Write the post and make a square image for it.”" },
        { mark: "✂", title: "Turn a long video into shorts", text: "“Clip the demo into three short verticals.”" },
      ],
    },
    {
      kind: "cards",
      title: "Which platforms can Claude post to?",
      lede: "Everywhere Postiz publishes.",
      cols: "--cm:2;--c7:4;--ct:6",
      cards: [
        { mark: "X", title: "X", text: "Posts and threads." },
        { mark: "in", title: "LinkedIn", text: "Profiles and pages." },
        { mark: "ig", title: "Instagram", text: "Feed and carousel." },
        { mark: "th", title: "Threads", text: "Posts and replies." },
        { mark: "yt", title: "YouTube", text: "Video and shorts." },
        { mark: "rd", title: "Reddit", text: "Posts to your subreddit." },
      ],
    },
    {
      kind: "cards",
      title: "Claude vs Claude Code vs Claude Cowork: which guide do I need?",
      lede: "Same connector family, three different places to work.",
      cols: "--cm:1;--c7:2;--ct:3",
      cards: [
        { mark: "C", title: "Claude", text: "You want to post from the chat app. This page is the one." },
        { mark: "CC", title: "Claude Code", text: "You want it scripted in a repo. The MCP server works there too." },
        { mark: "CW", title: "Claude Cowork", text: "You want desktop workflows without a terminal. There is a guide for that." },
      ],
    },
  ],
  faq: [
    { q: "How do I connect Postiz to Claude?", a: "Add the official Postiz connector from Claude's connector settings and sign in once." },
    { q: "What can Claude do with Postiz?", a: "Draft, schedule and publish to every channel you have connected, and read the numbers afterwards." },
    { q: "Why doesn't the official Postiz connector generate images or videos?", a: "The connector carries the posting tools only. Image, video and clipping ship with the custom MCP link." },
    { q: "Is Claude the same as Claude Code or Claude Cowork?", a: "No. Claude is the chat app, Claude Code runs in a repo, and Claude Cowork is desktop automation." },
    { q: "Does the Postiz connector work in Claude Code too?", a: "Yes. Point Claude Code at the same MCP server and the same tools appear." },
    { q: "Which social media platforms can Claude post to through Postiz?", a: "30+, including X, LinkedIn, Facebook Pages, Instagram, Threads, TikTok, YouTube and Reddit." },
    { q: "Is it free to use Postiz with Claude?", a: "The trial is 7 days for $0 after that plans start at $29 a month." },
    { q: "Is it safe to let Claude post to my social accounts?", a: "Claude signs in through OAuth and never sees your social passwords. Revoking the grant stops it immediately." },
    { q: "Can Claude post automatically on a schedule?", a: "Yes. It can place a post on a future slot, and the calendar publishes it at that time." },
  ],
  faqTitle: "Frequently Asked Questions",
  cta: ["Let Claude run your social media", "Add the connector once and stop switching tabs to post."],
};

/* ------------------------------------------------------------ /claude-cowork */

const COWORK: { hero: Parameters<typeof hero>[0]; blocks: Block[]; faq: Faq[]; faqTitle?: string; cta: [string, string] } = {
  hero: {
    title: "Schedule social media posts with Claude Cowork",
    sub: "Connect Postiz to Claude Cowork as a connector and schedule posts to 30+ platforms by asking. No terminal, no API key.",
    note: "Runs on your desktop. Nothing to install from this page.",
    live: true,
  },
  blocks: [
    {
      kind: "steps",
      title: "How do you connect Postiz to Claude Cowork?",
      lede: "Five steps in the Cowork app, then it behaves like any other tool.",
      cols: "--cm:4;--c7:5;--ct:5",
      cards: [
        { mark: "1", title: "Open Cowork", text: "Launch Claude Cowork and open its settings." },
        { mark: "2", title: "Connectors", text: "Find the connectors list inside settings." },
        { mark: "3", title: "Add Postiz", text: "Search for Postiz and add the official connector." },
        { mark: "4", title: "Sign in", text: "Authorise your account once through the OAuth screen." },
        { mark: "5", title: "Ask for a post", text: "Describe it and pick the channels. It lands in the calendar." },
      ],
      code: "Cowork → Settings → Connectors → Postiz → Connect",
    },
    {
      kind: "cards",
      id: "pz-tools",
      title: "What can Claude Cowork do with Postiz?",
      lede: "Six things, all from the desktop without a terminal.",
      cols: "--cm:1;--c7:2;--ct:3",
      cards: [
        { mark: "▤", title: "AI agent ready", text: "Cowork can call the tools without you writing a command." },
        { mark: "30", title: "30+ platforms", text: "Every channel Postiz connects to is reachable from Cowork." },
        { mark: "⌘", title: "Threads and comments", text: "Post a thread, then follow up with replies to the earliest engagement." },
        { mark: "▣", title: "Rich media support", text: "Images and video go out as part of the same request." },
        { mark: "⌚", title: "Scheduled posting", text: "Ask for a day or a week and the calendar holds it." },
        { mark: "⚙", title: "Platform-specific settings", text: "Different copy or media per channel in the same pass." },
      ],
    },
    {
      kind: "cards",
      title: "How does posting from Claude Cowork work?",
      lede: "Discover, create, manage.",
      cols: "--cm:1;--c7:1;--ct:2",
      cards: [
        { mark: "▤", title: "Discover integrations", text: "Cowork finds the connector on its own; you never paste a key." },
        { mark: "✎", title: "Create posts", text: "You describe the post; the agent writes it and picks the channels." },
        { mark: "◎", title: "Manage and analyse", text: "Ask what is queued and what it did after it went out." },
      ],
    },
    {
      kind: "cards",
      title: "One request, every platform",
      lede: "Say it once and choose where it goes. Per-channel settings let you change the copy, the image or the time for each network without repeating the request.",
      cols: "--cm:1;--c7:1;--ct:1",
      cards: [
        { mark: "⇢", title: "One sentence, several channels", text: "The same post goes out with the right lengths and formats for each platform." },
      ],
    },
    {
      kind: "cards",
      title: "What is Claude Cowork?",
      lede: "A desktop agent that works with the apps already on your machine.",
      cols: "--cm:4;--c7:4;--ct:4",
      cards: [
        { mark: "▣", title: "Desktop native", text: "It runs on your computer, not in a browser tab." },
        { mark: "⚒", title: "App integrations", text: "It can drive the tools you already have open." },
        { mark: "⟳", title: "Autonomous tasks", text: "Give it a job and come back to the result." },
        { mark: "P", title: "How Postiz fits in", text: "Postiz is the publishing end: the calendar, the channels and the queue, so closing the lid changes nothing." },
      ],
    },
    {
      kind: "cards",
      title: "How do social media workflows run in Claude Cowork?",
      lede: "The pattern is the same each time: look, act, check.",
      cols: "--cm:1;--c7:1;--ct:2",
      cards: [
        { mark: "▤", title: "Check your channels", text: "Ask which accounts are connected before you commit to a plan." },
        { mark: "⌚", title: "Schedule across channels", text: "One request places posts on several networks at different times." },
        { mark: "◎", title: "Read the numbers", text: "Ask how the week did and get the per-post figures back." },
      ],
    },
    {
      kind: "cards",
      title: "Also works with OpenClaw",
      lede: "The same connector standard serves other desktop agents, so nothing here is locked to one app.",
      cols: "--cm:1;--c7:1;--ct:1",
      cards: [
        { mark: "OC", title: "One server, several agents", text: "Point another agent at the same MCP server and the calendar is shared." },
      ],
    },
  ],
  faq: [
    { q: "Do I need a terminal or an API key?", a: "No. The connector handles sign-in; the MCP link is only for people who want the extra media tools." },
    { q: "Which platforms can Claude Cowork post to?", a: "All 30+ that Postiz supports, including X, LinkedIn, Instagram, Facebook and Reddit." },
    { q: "Can I post to several platforms in one request?", a: "Yes. One request can place posts on several channels, with per-channel copy or timing if you want it." },
    { q: "Does Cowork support images and video?", a: "Yes, and the custom MCP link adds generation and clipping as well." },
    { q: "Can posts be scheduled ahead?", a: "Yes. Ask for a day or a week and the calendar holds the posts until then." },
    { q: "Is Claude Cowork the same as Claude Code?", a: "No. Claude Code runs in a repo from a terminal; Cowork is desktop automation with no terminal." },
    { q: "Is it free to start?", a: "There is a 7-day trial for $0; plans start at $29 a month afterwards." },
  ],
  faqTitle: "Questions about Claude Cowork and Postiz",
  cta: ["Start automating today", "Connect the calendar once and describe what you want posted."],
};

const PAGES: Record<PzAgentPath, { hero: Parameters<typeof hero>[0]; blocks: Block[]; faq: Faq[]; faqTitle?: string; cta: [string, string] }> =
  {
    "/chatgpt": CHATGPT,
    "/dots": DOTS,
    "/claude": CLAUDE,
    "/claude-cowork": COWORK,
  };

/** The whole <main> of one agent page. */
export function postizAgentBody(path: PzAgentPath): string {
  const page = PAGES[path];
  const blocks = page.blocks.map(renderBlock).join("\n");
  return [hero(page.hero), blocks, faqSection(page.faq, page.faqTitle), ctaSection(page.cta[0], page.cta[1])].join("\n");
}

/** Page title and description per route, used by the document shell. */
export const PZ_AGENT_META: Record<PzAgentPath, { title: string; description: string }> = {
  "/chatgpt": {
    title: "Schedule Social Media Posts with ChatGPT: Postiz Connector + MCP",
    description:
      "Connect Postiz to ChatGPT as an official app or custom MCP connector and schedule posts to X, LinkedIn, Instagram and 30+ platforms by asking. Start for $0.",
  },
  "/dots": {
    title: "Schedule Social Media Posts with OpenAI dots | Postiz",
    description:
      "Connect Postiz to your OpenAI dot with the official ChatGPT plugin. Your always-on agent drafts, schedules and publishes posts to 30+ platforms.",
  },
  "/claude": {
    title: "How to Post to Social Media from Claude (Connector + MCP) | Postiz",
    description:
      "Add the official Postiz connector to Claude and schedule posts on 30+ social platforms by asking. Use the custom MCP link for image, video and clipping tools.",
  },
  "/claude-cowork": {
    title: "Schedule Social Media Posts with Claude Cowork | Postiz",
    description:
      "Connect Postiz to Claude Cowork as a connector and schedule posts to 30+ social platforms by asking. No terminal, no API key. Guides for X, LinkedIn, and more.",
  },
};
