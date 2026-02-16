import { db } from "./db";
import { pillars, templates, posts, tweets, ideas, analytics, rssSources, monitoredAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";

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
    { name: "AI for DevOps / AIOps", description: "AI-powered observability, intelligent incident management, LLM-assisted IaC, AI agents for platform engineering", color: "#8B5CF6" },
    { name: "Cloud-Native Data Platforms", description: "Running Kafka, Spark, Flink, Airflow on Kubernetes; multi-cloud data strategies; cost optimization for data workloads", color: "#06B6D4" },
    { name: "Infrastructure as Code for Data", description: "Terraform/Crossplane for data resources, GitOps for data pipelines, automating data platform provisioning", color: "#10B981" },
    { name: "Career & Leadership", description: "Engineering management insights, team building in remote-first orgs, mentoring, career growth in DevOps/Data/AI", color: "#F59E0B" },
    { name: "Hot Takes & Trends", description: "Commentary on latest Data & AI news, tool comparisons, industry shifts", color: "#EF4444" },
  ];
  await db.insert(pillars).values(pillarData);

  const templateData = [
    { name: "Lessons Learned", pattern: "X things I learned about [topic] after [experience]", postType: "thread", pillarId: 1 },
    { name: "Unpopular Opinion", pattern: "Unpopular opinion: [hot take about Data/AI tool]", postType: "hot_take", pillarId: 6 },
    { name: "Tool Comparison", pattern: "[Tool A] vs [Tool B] -- here's what nobody tells you", postType: "thread", pillarId: 3 },
    { name: "Migration Story", pattern: "I migrated [X] to [Y]. Here's the real cost breakdown", postType: "thread", pillarId: 4 },
    { name: "Stop/Start", pattern: "Stop doing [common practice]. Do [better practice] instead.", postType: "tweet", pillarId: 2 },
    { name: "Career Growth", pattern: "The 3 skills that took me from [junior role] to [senior role]", postType: "thread", pillarId: 5 },
    { name: "Building at Scale", pattern: "A thread on how we built [system] at scale", postType: "thread", pillarId: 1 },
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
    aiModel: "gpt-4o-mini",
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
    aiModel: "gpt-4o-mini",
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
    aiModel: "gpt-4o-mini",
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
    aiModel: "gpt-4o-mini",
  }).returning();

  await db.insert(tweets).values([
    { postId: post4.id, position: 0, content: "3 years ago I was debugging Kubernetes clusters at 2 AM alone. Today I lead a team of 12 engineers across 3 time zones. The difference? I stopped trying to be the smartest person in the room and started building systems that made everyone smarter.", charCount: 253 },
  ]);

  console.log("Database seeded successfully!");
}
