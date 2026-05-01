#!/usr/bin/env node
/**
 * ContentForge Full Integration Test Suite v2
 * Tests every API endpoint and feature comprehensively
 */

const BASE = "http://localhost:3000";
let sessionCookie = "";
const testEmail = `test${Date.now()}@cf.io`;
const testUser = { email: testEmail, password: "TestPass123!", name: "Test User" };
let results = [];

function ok(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function req(method, path, body = null, auth = true) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (auth && sessionCookie) opts.headers.Cookie = sessionCookie;
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${BASE}${path}`, opts);
    const data = await res.json().catch(() => null);
    return { status: res.status, data, headers: res.headers };
  } catch (e) {
    return { status: 0, data: null, error: e.message };
  }
}

async function runTests() {
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  ContentForge Full Integration Test Suite v2");
  console.log("═══════════════════════════════════════════════════\n");

  // ── AUTH ─────────────────────────────────────────────────────
  console.log("\n📦 AUTH");
  
  let r = await req("POST", "/api/auth/register", testUser, false);
  ok("Register new user", r.status === 200 && r.data?.id, `id=${r.data?.id}`);
  const userId = r.data?.id;
  
  r = await req("POST", "/api/auth/login", { email: testEmail, password: "TestPass123!" }, false);
  ok("Login", r.status === 200, `status=${r.status}`);
  if (r.headers.get("set-cookie")) {
    sessionCookie = r.headers.get("set-cookie").split(";")[0];
  }
  
  r = await req("GET", "/api/auth/me", null, false);
  ok("Get user without session", r.status === 401, `status=${r.status}`);
  
  r = await req("GET", "/api/auth/me");
  ok("Get user with session", r.status === 200 && r.data?.id === userId, `id=${r.data?.id}`);
  
  r = await req("GET", "/api/auth/config", null, false);
  ok("Auth config", r.status === 200, `google=${r.data?.googleEnabled}`);

  // ── PILLARS ──────────────────────────────────────────────────
  console.log("\n📦 PILLARS");
  
  r = await req("GET", "/api/pillars");
  ok("List pillars", r.status === 200 && Array.isArray(r.data) && r.data.length >= 6, `count=${r.data?.length}`);
  const pillarId = r.data?.[0]?.id;

  // ── IDEAS ────────────────────────────────────────────────────
  console.log("\n📦 IDEAS");
  
  r = await req("GET", "/api/ideas");
  ok("List ideas", r.status === 200 && Array.isArray(r.data), `count=${r.data?.length}`);
  const initialIdeaCount = r.data?.length || 0;
  
  r = await req("POST", "/api/ideas", { title: "Test Idea", notes: "Test notes", pillarId });
  ok("Create idea", (r.status === 200 || r.status === 201) && r.data?.title === "Test Idea", `id=${r.data?.id}`);
  const ideaId = r.data?.id;
  
  r = await req("GET", `/api/ideas/${ideaId}`);
  ok("Get idea by ID", r.status === 200 && r.data?.id === ideaId, `title=${r.data?.title}`);
  
  r = await req("DELETE", `/api/ideas/${ideaId}`);
  ok("Delete idea", r.status === 204 || r.status === 200, `status=${r.status}`);

  // ── POSTS ────────────────────────────────────────────────────
  console.log("\n📦 POSTS");
  
  r = await req("GET", "/api/posts");
  ok("List posts", r.status === 200 && Array.isArray(r.data), `count=${r.data?.length}`);
  
  r = await req("POST", "/api/posts", { 
    pillarId, postType: "tweet", tone: "technical", 
    targetPlatform: "x", status: "draft", 
    tweets: [{ content: "Test tweet content", position: 0, charCount: 18 }]
  });
  ok("Create post", (r.status === 200 || r.status === 201) && r.data?.tweets?.length === 1, `id=${r.data?.id}, tweets=${r.data?.tweets?.length}`);
  const postId = r.data?.id;
  
  r = await req("GET", `/api/posts/${postId}`);
  ok("Get post by ID", r.status === 200 && r.data?.id === postId, `status=${r.data?.status}`);
  
  r = await req("PATCH", `/api/posts/${postId}/status`, { status: "ready" });
  ok("Update post status to ready", r.status === 200 && r.data?.status === "ready", `status=${r.data?.status}`);
  
  r = await req("PATCH", `/api/posts/${postId}/status`, { status: "scheduled", scheduledAt: new Date(Date.now() + 3600000).toISOString() });
  ok("Schedule post", r.status === 200 && r.data?.status === "scheduled", `status=${r.data?.status}`);

  // ── AI GENERATION ────────────────────────────────────────────
  console.log("\n📦 AI GENERATION (uses OpenAI credits)");
  
  r = await req("POST", "/api/generate", { 
    pillar: String(pillarId), postType: "tweet", tone: "technical", 
    platform: "x", context: "Kubernetes networking best practices" 
  });
  ok("Generate tweet variations", r.status === 200 && r.data?.variations?.length > 0, 
    `variations=${r.data?.variations?.length}, model=${r.data?.model}`);
  
  r = await req("POST", "/api/generate", { 
    pillar: String(pillarId), postType: "thread", tone: "educational", 
    platform: "x", context: "Testing CI/CD pipelines" 
  });
  ok("Generate thread variations", r.status === 200 && r.data?.variations?.length > 0,
    `variations=${r.data?.variations?.length}, model=${r.data?.model}`);
  
  r = await req("POST", "/api/hooks/generate", { topic: "DevOps automation", count: 3 });
  ok("Generate hooks", r.status === 200 && r.data?.hooks?.length > 0, `hooks=${r.data?.hooks?.length}`);

  // ── TEMPLATES ────────────────────────────────────────────────
  console.log("\n📦 TEMPLATES");
  
  r = await req("GET", "/api/templates");
  ok("List templates", r.status === 200 && Array.isArray(r.data) && r.data.length >= 1, `count=${r.data?.length}`);

  // ── DISCOVERY ────────────────────────────────────────────────
  console.log("\n📦 DISCOVERY");
  
  r = await req("GET", "/api/discover/ideas");
  ok("List discovered ideas", r.status === 200 && Array.isArray(r.data), `count=${r.data?.length}`);
  
  r = await req("GET", "/api/discover/rss-sources");
  ok("List RSS sources", r.status === 200 && r.data.length >= 1, `count=${r.data?.length}`);
  
  r = await req("GET", "/api/discover/monitored-accounts");
  ok("List monitored accounts", r.status === 200 && r.data.length >= 1, `count=${r.data?.length}`);
  
  r = await req("GET", "/api/discover/settings");
  ok("Discovery settings", r.status === 200, `sources=${JSON.stringify(r.data?.enabledSources)}`);

  // ── ANALYTICS ────────────────────────────────────────────────
  console.log("\n📦 ANALYTICS");
  
  r = await req("GET", "/api/analytics/summary");
  ok("Analytics summary", r.status === 200 && r.data?.totalPosts !== undefined, `posts=${r.data?.totalPosts}`);

  // ── PROFILE / SETTINGS ───────────────────────────────────────
  console.log("\n📦 PROFILE & SETTINGS");
  
  r = await req("GET", "/api/profile");
  ok("Get profile", r.status === 200, `hasData=${!!r.data}`);
  
  r = await req("GET", "/api/profile/memory");
  ok("Get brand memory", r.status === 200, `hasData=${!!r.data}`);
  
  r = await req("PUT", "/api/profile/memory", { memoryJson: { test: true, brand: "Kishore" } });
  ok("Update brand memory", r.status === 200 && r.data?.memoryJson?.test === true, `memoryJson=${JSON.stringify(r.data?.memoryJson)}`);
  
  r = await req("GET", "/api/profile/memory");
  ok("Verify brand memory persisted", r.status === 200 && r.data?.memoryJson?.test === true, `memoryJson=${JSON.stringify(r.data?.memoryJson)}`);
  
  r = await req("GET", "/api/accounts");
  ok("Connected accounts", r.status === 200 && Array.isArray(r.data), `count=${r.data?.length}`);

  // ── REFERENCES / VAULT ───────────────────────────────────────
  console.log("\n📦 REFERENCES & VAULT");
  
  r = await req("GET", "/api/references");
  ok("List references", r.status === 200 && Array.isArray(r.data), `count=${r.data?.length}`);
  
  r = await req("GET", "/api/vault");
  ok("Context vault", r.status === 200 && Array.isArray(r.data), `count=${r.data?.length}`);

  // ── STYLES ───────────────────────────────────────────────────
  console.log("\n📦 STYLES");
  
  r = await req("GET", "/api/styles");
  ok("List style profiles", r.status === 200 && Array.isArray(r.data), `count=${r.data?.length}`);

  // ── ARTICLES ─────────────────────────────────────────────────
  console.log("\n📦 ARTICLES");
  
  r = await req("GET", "/api/articles");
  ok("List articles", r.status === 200 && Array.isArray(r.data), `count=${r.data?.length}`);

  // ── IMAGES / CAROUSELS ───────────────────────────────────────
  console.log("\n📦 IMAGES & CAROUSELS");
  
  r = await req("GET", "/api/images");
  ok("List images", r.status === 200 && Array.isArray(r.data), `count=${r.data?.length}`);
  
  r = await req("GET", "/api/carousels");
  ok("List carousels", r.status === 200 && Array.isArray(r.data), `count=${r.data?.length}`);

  // ── CHAT ─────────────────────────────────────────────────────
  console.log("\n📦 CHAT");
  
  r = await req("GET", "/api/conversations");
  ok("List conversations", r.status === 200, `count=${r.data?.length}`);

  // ── AI USAGE LOG ─────────────────────────────────────────────
  console.log("\n📦 AI USAGE");
  
  r = await req("GET", "/api/ai-usage");
  ok("AI usage log", r.status === 200, `count=${r.data?.length}`);

  // ── POSTING (Phase 1 - should NOT exist yet) ─────────────────
  console.log("\n📦 POSTING (Phase 1 - not yet built)");
  
  r = await req("POST", `/api/posts/${postId}/publish`);
  // In dev mode, missing API routes fall through to Vite (returns HTML 200)
  // So we check if response is JSON (real API) or HTML (fallback)
  const isJson = r.data !== null && typeof r.data === "object" && !r.data?.message?.includes("DOCTYPE");
  ok("Publish endpoint does NOT exist (expected)", !isJson || r.status === 404, `status=${r.status}, isJson=${isJson}`);

  // ── SUMMARY ──────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════");
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`  Results: ${passed} passed, ${failed} failed out of ${results.length}`);
  console.log("═══════════════════════════════════════════════════\n");
  
  if (failed > 0) {
    console.log("Failed tests:");
    results.filter(r => !r.passed).forEach(r => console.log(`  ❌ ${r.name} — ${r.detail}`));
    console.log("");
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error("Test suite error:", err);
  process.exit(1);
});
