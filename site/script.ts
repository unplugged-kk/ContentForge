/**
 * Behaviour for the public marketing site (served at /_site/site.js).
 * Progressive enhancement only: every page is readable with this file blocked.
 */
export const SITE_JS = String.raw`(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Mobile menu.
  const burger = document.querySelector("[data-burger]");
  const mobile = document.querySelector("[data-mobile-nav]");
  if (burger && mobile) {
    burger.addEventListener("click", () => {
      const open = mobile.hidden;
      mobile.hidden = !open;
      burger.setAttribute("aria-expanded", String(open));
      document.body.style.overflow = open ? "hidden" : "";
    });
  }

  // Header dropdowns: one open at a time, close on outside click or Escape.
  const menus = [...document.querySelectorAll("details.menu")];
  menus.forEach((m) => m.addEventListener("toggle", () => {
    if (m.open) menus.forEach((o) => { if (o !== m) o.open = false; });
  }));
  document.addEventListener("click", (e) => {
    menus.forEach((m) => { if (!m.contains(e.target)) m.open = false; });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    menus.forEach((m) => { if (m.open) { m.open = false; m.querySelector("summary").focus(); } });
    if (mobile && !mobile.hidden) burger.click();
  });

  // Hero: rotate the agent name next to the headline.
  const rotor = document.querySelector("[data-rotor]");
  if (rotor && !reduce) {
    const items = JSON.parse(rotor.getAttribute("data-rotor"));
    const word = rotor.querySelector(".rotor-word");
    const icon = rotor.querySelector(".rotor-icon");
    let i = 0;
    setInterval(() => {
      i = (i + 1) % items.length;
      word.classList.add("out");
      setTimeout(() => {
        word.textContent = items[i].name;
        icon.style.background = items[i].bg;
        icon.innerHTML = items[i].svg;
        word.classList.remove("out");
      }, 350);
    }, 2600);
  }

  // Hero: agentic / classic switch swaps the demo window's story.
  const sw = document.querySelector("[data-mode-switch]");
  if (sw) {
    const title = document.querySelector("[data-demo-title]");
    const bubble = document.querySelector("[data-demo-bubble]");
    const reply = document.querySelector("[data-demo-reply]");
    sw.addEventListener("click", () => {
      const classic = sw.getAttribute("aria-checked") !== "true";
      sw.setAttribute("aria-checked", String(classic));
      title.textContent = classic ? sw.dataset.classicTitle : sw.dataset.agentTitle;
      bubble.textContent = classic ? sw.dataset.classicAsk : sw.dataset.agentAsk;
      reply.classList.toggle("on", classic);
    });
  }

  // Agent pages: copy buttons.
  document.querySelectorAll("[data-copy]").forEach((b) => {
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(b.getAttribute("data-copy"));
        const t = b.textContent; b.textContent = "Copied";
        setTimeout(() => { b.textContent = t; }, 1500);
      } catch { /* clipboard blocked: the text stays visible to select by hand */ }
    });
  });

  // Agent pages: "Also try" chips swap the example request in the chat panel.
  document.querySelectorAll("[data-chip]").forEach((b) => {
    b.addEventListener("click", () => {
      const me = document.querySelector("[data-chat-me]");
      const bot = document.querySelector("[data-chat-bot]");
      if (me) me.textContent = b.getAttribute("data-chip");
      if (bot) bot.textContent = b.getAttribute("data-answer");
    });
  });
})();`;
