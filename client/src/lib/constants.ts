export const CONTENT_PILLARS = [
  { id: 1, name: "Data Infrastructure & MLOps", color: "#3B82F6", description: "Data pipelines, feature stores, model serving on Kubernetes, ML platform engineering" },
  { id: 2, name: "AI for DevOps / AIOps", color: "#8B5CF6", description: "AI-powered observability, intelligent incident management, LLM-assisted IaC" },
  { id: 3, name: "Cloud-Native Data Platforms", color: "#06B6D4", description: "Running Kafka, Spark, Flink, Airflow on Kubernetes; multi-cloud data strategies" },
  { id: 4, name: "Infrastructure as Code for Data", color: "#10B981", description: "Terraform/Crossplane for data resources, GitOps for data pipelines" },
  { id: 5, name: "Career & Leadership", color: "#F59E0B", description: "Engineering management, team building, mentoring, career growth" },
  { id: 6, name: "Hot Takes & Trends", color: "#EF4444", description: "Commentary on latest Data & AI news, tool comparisons, industry shifts" },
] as const;

export const POST_TYPES = [
  { value: "tweet", label: "Single Tweet" },
  { value: "thread", label: "Thread" },
  { value: "hot_take", label: "Hot Take" },
  { value: "poll", label: "Poll" },
  { value: "quote_template", label: "Quote Tweet" },
] as const;

export const TONES = [
  { value: "technical", label: "Technical" },
  { value: "conversational", label: "Conversational" },
  { value: "provocative", label: "Provocative" },
  { value: "storytelling", label: "Storytelling" },
  { value: "educational", label: "Educational" },
] as const;

export const PLATFORMS = [
  { value: "x", label: "X (Twitter)" },
  { value: "threads", label: "Threads" },
  { value: "both", label: "Both" },
] as const;

export const POST_STATUSES = [
  { value: "draft", label: "Draft", color: "text-muted-foreground" },
  { value: "ready", label: "Ready", color: "text-blue-500" },
  { value: "scheduled", label: "Scheduled", color: "text-amber-500" },
  { value: "posted", label: "Posted", color: "text-green-500" },
  { value: "failed", label: "Failed", color: "text-red-500" },
] as const;

export const CHAR_LIMITS = {
  x: 280,
  threads: 500,
} as const;
