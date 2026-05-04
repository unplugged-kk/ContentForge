import { db } from "./db";
import { pillars, templates, posts, tweets, ideas, analytics, rssSources, monitoredAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { MODELS } from "./ai/config";

export async function seedDatabase() {
  const existingRss = await db.select().from(rssSources);
  if (existingRss.length === 0) {
    console.log("Seeding RSS sources and monitored accounts...");
    await db.insert(rssSources).values([
      { name: "TLDR AI", feedUrl: "https://tldr.tech/ai/rss", category: "ai" },
      { name: "TLDR DevOps", feedUrl: "https://tldr.tech/devops/rss", category: "devops" },
      { name: "Hacker News Best (AI/K8s/DevOps)", feedUrl: "https://hnrss.org/best?q=AI+OR+kubernetes+OR+devops+OR+mlops", category: "tech" },
      { name: "The Pragmatic Engineer", feedUrl: "https://newsletter.pragmaticengineer.com/feed", category: "leadership" },
      { name: "ByteByteGo", feedUrl: "https://blog.bytebytego.com/feed", category: "system_design" },
      { name: "Last Week in AI", feedUrl: "https://lastweekin.ai/feed", category: "ai" },
      { name: "Kubernetes Blog", feedUrl: "https://kubernetes.io/feed.xml", category: "devops" },
      { name: "CNCF Blog", feedUrl: "https://www.cncf.io/feed/", category: "devops" },
      { name: "The New Stack", feedUrl: "https://thenewstack.io/feed/", category: "devops" },
      { name: "InfoQ DevOps", feedUrl: "https://feed.infoq.com/devops/", category: "devops" },
      { name: "SRE Weekly", feedUrl: "https://sreweekly.com/feed/", category: "devops" },
      { name: "AWS What's New", feedUrl: "https://aws.amazon.com/about-aws/whats-new/recent/feed/", category: "tech" },
      { name: "Google Cloud Blog", feedUrl: "https://cloudblog.withgoogle.com/rss/", category: "tech" },
      { name: "AI Snake Oil (Substack)", feedUrl: "https://aisnakeoil.substack.com/feed", category: "ai" },
    ]);
    const existingAccounts = await db.select().from(monitoredAccounts);
    if (existingAccounts.length === 0) {
      await db.insert(monitoredAccounts).values([
        { platform: "x", username: "kelseyhightower", displayName: "Kelsey Hightower", category: "devops" },
        { platform: "x", username: "chiphuyen", displayName: "Chip Huyen", category: "mlops" },
        { platform: "x", username: "GergelyOrosz", displayName: "Gergely Orosz", category: "leadership" },
        { platform: "x", username: "AndrewYNg", displayName: "Andrew Ng", category: "ai_research" },
        { platform: "x", username: "karpathy", displayName: "Andrej Karpathy", category: "ai_research" },
      ]);
    }
  }

  const existingPillars = await db.select().from(pillars);
  if (existingPillars.length > 0) return;

  console.log("Seeding database...");

  const pillarData = [
    { name: "Data Infrastructure & MLOps", description: "Data pipelines, feature stores, model serving on Kubernetes, ML platform engineering, data mesh, lakehouse architecture", color: "#3B82F6" },
    { name: "AIOps & AI-Assisted DevOps", description: "AI-powered observability, intelligent incident management, LLM-assisted IaC, AI agents for platform engineering", color: "#8B5CF6" },
    { name: "Cloud-Native Data Platforms", description: "Running Kafka, Spark, Flink, Airflow on Kubernetes; multi-cloud data strategies; cost optimization for data workloads", color: "#06B6D4" },
    { name: "Infrastructure as Code", description: "Terraform, Crossplane, Pulumi, GitOps, Flux, ArgoCD — automating infra provisioning at scale", color: "#10B981" },
    { name: "SRE & Reliability Engineering", description: "SLOs/error budgets, chaos engineering, incident management, on-call culture, post-mortems", color: "#EC4899" },
    { name: "Platform Engineering & DevEx", description: "Internal developer platforms, Backstage, golden paths, self-service infra, platform teams", color: "#F97316" },
    { name: "Kubernetes Deep Dives", description: "K8s internals, operators, scheduling, networking (CNI), storage (CSI), multi-cluster", color: "#14B8A6" },
    { name: "AI Agents & Agentic Workflows", description: "LLM agents, RAG pipelines, agentic DevOps, MCP, guardrails, LangChain patterns in production", color: "#A855F7" },
    { name: "Technical Leadership & Eng Management", description: "Staff/Principal patterns, managing distributed teams, hiring, roadmaps, IC-to-manager transitions", color: "#F59E0B" },
    { name: "Security & DevSecOps", description: "Supply chain security, SLSA, secrets management, SAST/DAST, zero-trust infra, compliance as code", color: "#EF4444" },
    { name: "FinOps & Cloud Cost Engineering", description: "Reserved instances, spot strategy, K8s cost attribution, rightsizing, multi-cloud cost optimisation", color: "#84CC16" },
    { name: "Open Source & CNCF Ecosystem", description: "CNCF project spotlights, contribution strategy, CNCF landscape navigation", color: "#0EA5E9" },
    { name: "Career & Leadership", description: "IC growth, remote-first teams, mentoring, salary negotiation, building your technical brand", color: "#F59E0B" },
    { name: "Hot Takes & Trends", description: "Tool wars, industry shifts, AI hype vs reality, unpopular opinions, bold predictions", color: "#EF4444" },
  ];
  await db.insert(pillars).values(pillarData);

  const templateData = [
    // MLOps / Data
    { name: "Lessons Learned", pattern: "X things I learned about [topic] after [experience]", postType: "thread", pillarId: 1 },
    { name: "Feature Store Story", pattern: "We moved to [tool] for feature management. Here's what changed.", postType: "thread", pillarId: 1 },
    { name: "ML in Prod Reality", pattern: "Everyone talks about [ML concept]. Nobody talks about [the hard part].", postType: "tweet", pillarId: 1 },
    // AIOps
    { name: "Stop/Start", pattern: "Stop doing [common practice]. Do [better practice] instead.", postType: "tweet", pillarId: 2 },
    { name: "AI Tool Deep Dive", pattern: "I used [AI tool] for [DevOps task] for 30 days. My honest take:", postType: "thread", pillarId: 2 },
    { name: "AIOps Hot Take", pattern: "Most 'AIOps' tools are just [real description]. Real AIOps means [actual definition].", postType: "tweet", pillarId: 2 },
    // Cloud-Native
    { name: "Tool Comparison", pattern: "[Tool A] vs [Tool B] — here's what nobody tells you", postType: "thread", pillarId: 3 },
    { name: "Cost Breakdown", pattern: "We cut [platform] costs by [X]% on Kubernetes. Exact playbook:", postType: "thread", pillarId: 3 },
    { name: "Migration Story", pattern: "I migrated [X] to [Y]. Here's the real cost breakdown", postType: "thread", pillarId: 3 },
    // IaC
    { name: "IaC Pattern", pattern: "The [Terraform/Crossplane/Pulumi] pattern that saved us [X hours/$/incidents]", postType: "thread", pillarId: 4 },
    { name: "GitOps Story", pattern: "We went all-in on GitOps. 6 months later, here's the honest review:", postType: "thread", pillarId: 4 },
    // SRE
    { name: "Incident Story", pattern: "We had a [severity] incident last [week/month]. Here's the full timeline + what we changed:", postType: "thread", pillarId: 5 },
    { name: "SLO Myth", pattern: "SLOs are not just for [X]. We used them to [unexpected use case].", postType: "tweet", pillarId: 5 },
    { name: "On-Call Reality", pattern: "After [N] years of on-call, here's what nobody told me:", postType: "thread", pillarId: 5 },
    // Platform Eng
    { name: "IDP Story", pattern: "We built an internal developer platform. Here's what we wish we knew:", postType: "thread", pillarId: 6 },
    { name: "Golden Path", pattern: "The [X] golden path that cut our deployment time from [A] to [B]:", postType: "thread", pillarId: 6 },
    // Kubernetes
    { name: "K8s Deep Dive", pattern: "Most people use [K8s feature] wrong. Here's the correct mental model:", postType: "thread", pillarId: 7 },
    { name: "Operator Pattern", pattern: "I wrote a Kubernetes operator for [use case]. Here's when you should (and shouldn't):", postType: "thread", pillarId: 7 },
    // AI Agents
    { name: "Agent Pattern", pattern: "I built an AI agent to [DevOps task]. Here's what worked and what failed:", postType: "thread", pillarId: 8 },
    { name: "RAG in Prod", pattern: "RAG for [infra use case] sounds simple. In production it's not. Thread:", postType: "thread", pillarId: 8 },
    // Leadership
    { name: "Career Growth", pattern: "The 3 skills that took me from [junior role] to [senior role]", postType: "thread", pillarId: 9 },
    { name: "Staff IC Lessons", pattern: "6 things I learned in my first year as a Staff Engineer:", postType: "thread", pillarId: 9 },
    // Security
    { name: "Supply Chain Reality", pattern: "Your K8s cluster has a supply chain problem. Here's how to find it:", postType: "thread", pillarId: 10 },
    { name: "Secrets Mgmt", pattern: "We moved from [old secrets approach] to [new]. Here's what changed:", postType: "thread", pillarId: 10 },
    // FinOps
    { name: "Cloud Cost Story", pattern: "We saved $[X] on cloud last quarter. The 3 changes we made:", postType: "thread", pillarId: 11 },
    { name: "K8s Cost Attribution", pattern: "Nobody told me K8s cost attribution was this hard. Here's our approach:", postType: "thread", pillarId: 11 },
    // CNCF
    { name: "CNCF Spotlight", pattern: "[CNCF project] solves a problem everyone pretends doesn't exist:", postType: "tweet", pillarId: 12 },
    // Career
    { name: "Remote Team Lessons", pattern: "Leading a [N]-person remote engineering team. Honest lessons after [X] years:", postType: "thread", pillarId: 13 },
    { name: "Salary Negotiation", pattern: "I've helped [N] engineers negotiate salaries. Here's what actually works:", postType: "thread", pillarId: 13 },
    // Hot Takes
    { name: "Unpopular Opinion", pattern: "Unpopular opinion: [hot take about tool/practice in AI/DevOps]", postType: "tweet", pillarId: 14 },
    { name: "Tool War", pattern: "[Tool A] fans are going to hate me for this. But [Tool B] wins because:", postType: "tweet", pillarId: 14 },
    { name: "Bold Prediction", pattern: "Prediction: by [year], [thing everyone is doing today] will be dead. Here's why:", postType: "tweet", pillarId: 14 },
  ];
  await db.insert(templates).values(templateData);

  const ideaData = [
    { title: "Why feature stores are the unsung heroes of ML in production", notes: "Talk about how most teams skip feature stores and end up with training-serving skew. Reference our Feast implementation.", pillarId: 1 },
    { title: "The real cost of running Spark on Kubernetes vs EMR", notes: "We saved 40% by moving to K8s-native Spark. Break down the numbers.", pillarId: 3 },
    { title: "How I use AI to review Terraform plans before apply", notes: "Built a simple LLM-powered pre-apply check that catches misconfigs. Could be a thread.", pillarId: 2 },
    { title: "Remote engineering teams: async-first is not optional", notes: "Lessons from leading a distributed team across 3 time zones", pillarId: 5 },
    { title: "Crossplane vs Terraform for data infrastructure provisioning", notes: "Hot take: Crossplane wins for data resources. Here's why.", pillarId: 4 },
  ];
  await db.insert(ideas).values(ideaData);

  const [post1] = await db.insert(posts).values({
    pillarId: 1,
    postType: "thread",
    tone: "technical",
    targetPlatform: "x",
    status: "posted",
    aiModel: MODELS.TEXT,
    postedAt: new Date("2025-02-10"),
  }).returning();

  await db.insert(tweets).values([
    { postId: post1.id, position: 0, content: "We just migrated our ML feature store from a custom solution to Feast on Kubernetes. Here's what 6 months of production taught us.", charCount: 139 },
    { postId: post1.id, position: 1, content: "Training-serving skew was our #1 problem. Features computed differently in batch training vs real-time serving. Feast's unified SDK eliminated this overnight.", charCount: 155 },
    { postId: post1.id, position: 2, content: "Running Feast on K8s with ArgoCD for GitOps: every feature definition change goes through PR review. Infrastructure as Code for ML features. Game changer.", charCount: 153 },
    { postId: post1.id, position: 3, content: "Result: model accuracy improved 12%, deployment time dropped from 2 days to 4 hours. The ROI of getting feature management right is massive.", charCount: 136 },
  ]);

  await db.insert(analytics).values({
    postId: post1.id,
    platform: "x",
    impressions: 12400,
    likes: 187,
    retweets: 43,
    replies: 28,
    bookmarks: 91,
    source: "manual",
  });

  const [post2] = await db.insert(posts).values({
    pillarId: 2,
    postType: "tweet",
    tone: "provocative",
    targetPlatform: "both",
    status: "ready",
    aiModel: MODELS.TEXT,
  }).returning();

  await db.insert(tweets).values([
    { postId: post2.id, position: 0, content: "Hot take: 90% of \"AIOps\" tools are just fancy dashboards with a chatbot bolted on. Real AIOps means the AI decides AND acts. We're not there yet.", charCount: 152 },
  ]);

  const [post3] = await db.insert(posts).values({
    pillarId: 3,
    postType: "thread",
    tone: "educational",
    targetPlatform: "x",
    status: "scheduled",
    aiModel: MODELS.TEXT,
    scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
  }).returning();

  await db.insert(tweets).values([
    { postId: post3.id, position: 0, content: "We cut our Kafka costs by 35% on Kubernetes. Here's the exact playbook we followed.", charCount: 87 },
    { postId: post3.id, position: 1, content: "Step 1: Right-size your brokers. Most teams over-provision. We used Strimzi operator + VPA to auto-tune resource requests based on actual throughput.", charCount: 155 },
    { postId: post3.id, position: 2, content: "Step 2: Tiered storage. Move cold data from local SSDs to S3-compatible storage. Reduced our EBS costs by 60% alone.", charCount: 114 },
  ]);

  await db.insert(analytics).values({
    postId: post3.id,
    platform: "x",
    impressions: 0,
    likes: 0,
    retweets: 0,
    replies: 0,
    source: "manual",
  });

  const [post4] = await db.insert(posts).values({
    pillarId: 5,
    postType: "tweet",
    tone: "storytelling",
    targetPlatform: "threads",
    status: "draft",
    aiModel: MODELS.TEXT,
  }).returning();

  await db.insert(tweets).values([
    { postId: post4.id, position: 0, content: "3 years ago I was debugging Kubernetes clusters at 2 AM alone. Today I lead a team of 12 engineers across 3 time zones. The difference? I stopped trying to be the smartest person in the room and started building systems that made everyone smarter.", charCount: 253 },
  ]);

  console.log("Database seeded successfully!");
}
