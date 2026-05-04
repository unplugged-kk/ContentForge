import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";
import { DollarSign, Zap, Activity, Clock, TrendingUp, Bot } from "lucide-react";

interface DashboardData {
  provider: {
    name: string;
    activeModel: string;
    pricing: { input: number; output: number };
    note: string;
  };
  summary: {
    todayCost: number;
    weekCost: number;
    monthCost: number;
    totalCost: number;
    totalTokens: number;
    totalCalls: number;
    todayCalls: number;
  };
  daily: { date: string; tokens: number; cost: number; calls: number }[];
  byFeature: { feature: string; tokens: number; cost: number; calls: number }[];
  byModel: { model: string; tokens: number; cost: number; calls: number }[];
  recent: {
    id: number;
    model: string;
    feature: string | null;
    totalTokens: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    latencyMs: number | null;
    estimatedCost: number;
    createdAt: string;
  }[];
  daysWindow: number;
}

const FEATURE_LABELS: Record<string, string> = {
  discover_ideas:      "Discover",
  autopilot_draft:     "Autopilot Draft",
  generate_post:       "Generate Post",
  generate_variants:   "Variants",
  smart_scheduling:    "Scheduling",
  image_prompt:        "Image Prompt",
  image_prompt_for_post: "Image Prompt",
  hook_generator:      "Hooks",
  carousel:            "Carousel",
  article_generate:    "Article",
  chat:                "Chat",
  analyze_style:       "Style Analysis",
  score_post:          "Viral Score",
  unknown:             "Other",
};

const CHART_COLORS = ["#3B82F6", "#8B5CF6", "#06B6D4", "#10B981", "#F97316", "#EF4444", "#F59E0B", "#84CC16"];

function fmt$(v: number) {
  if (v === 0) return "$0.00";
  if (v < 0.001) return `$${(v * 1000).toFixed(3)}m`;
  return `$${v.toFixed(4)}`;
}

function fmtK(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

function StatCard({ label, value, sub, icon: Icon, color = "text-muted-foreground" }: {
  label: string; value: string; sub?: string; icon: any; color?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
    </Card>
  );
}

function CostTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border rounded-lg p-2 text-xs shadow-md">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {p.name === "cost" ? fmt$(p.value) : fmtK(p.value)}
        </p>
      ))}
    </div>
  );
}

export default function AiUsagePage() {
  const [days, setDays] = useState("30");

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: [`/api/ai-usage/dashboard?days=${days}`],
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b">
          <h1 className="text-lg font-semibold" data-testid="text-ai-usage-title">AI Usage & Cost</h1>
          <p className="text-xs text-muted-foreground">Token consumption and estimated spend</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="p-4"><Skeleton className="h-3 w-20 mb-2" /><Skeleton className="h-7 w-16" /></Card>
            ))}
          </div>
          <Card className="p-4"><Skeleton className="h-56" /></Card>
        </div>
      </div>
    );
  }

  const d = data!;
  const s = d.summary;

  // Show last 14 days in chart regardless of window selection (cleaner)
  const chartDays = d.daily.slice(-14);

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2" data-testid="text-ai-usage-title">
            <Bot className="h-5 w-5 text-purple-500" />
            AI Usage & Cost
          </h1>
          <p className="text-xs text-muted-foreground">Estimated spend based on model pricing. Actual may vary by provider.</p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-32 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">

        {/* Provider banner */}
        <Card className="p-3 bg-muted/40 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Bot className="h-4 w-4 text-purple-500 shrink-0" />
            <div>
              <span className="text-xs font-medium">{d.provider.name}</span>
              <span className="mx-2 text-muted-foreground">·</span>
              <span className="text-xs font-mono">{d.provider.activeModel}</span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>Input: <span className="font-medium text-foreground">${d.provider.pricing.input}/1M tok</span></span>
            <span>Output: <span className="font-medium text-foreground">${d.provider.pricing.output}/1M tok</span></span>
            <Badge variant="outline" className="text-[10px]">{d.provider.note}</Badge>
          </div>
        </Card>

        {/* Summary stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Today's cost"
            value={fmt$(s.todayCost)}
            sub={`${s.todayCalls} calls`}
            icon={DollarSign}
            color="text-green-500"
          />
          <StatCard
            label="This week"
            value={fmt$(s.weekCost)}
            icon={TrendingUp}
            color="text-blue-500"
          />
          <StatCard
            label={`Last ${days} days`}
            value={fmt$(s.monthCost)}
            sub={`${s.totalCalls} total calls`}
            icon={Activity}
            color="text-purple-500"
          />
          <StatCard
            label="Total tokens"
            value={fmtK(s.totalTokens)}
            sub={`≈ ${fmt$(s.totalCost)} all-time`}
            icon={Zap}
            color="text-amber-500"
          />
        </div>

        {/* Daily cost chart */}
        <Card className="p-4">
          <h3 className="text-sm font-medium mb-4">Daily cost — last 14 days</h3>
          {chartDays.some((d) => d.cost > 0) ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartDays} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => v.slice(5)} // MM-DD
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `$${v.toFixed(3)}`}
                  width={58}
                />
                <Tooltip content={<CostTooltip />} />
                <Bar dataKey="cost" name="cost" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
              No AI usage recorded yet
            </div>
          )}
        </Card>

        {/* Feature breakdown + Model breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* By feature */}
          <Card className="p-4">
            <h3 className="text-sm font-medium mb-4">Cost by feature</h3>
            {d.byFeature.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={d.byFeature}
                      dataKey="cost"
                      nameKey="feature"
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      innerRadius={35}
                    >
                      {d.byFeature.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => fmt$(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 space-y-1">
                  {d.byFeature.map((f, i) => (
                    <div key={f.feature} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span className="text-muted-foreground">
                          {FEATURE_LABELS[f.feature] ?? f.feature}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 tabular-nums">
                        <span className="text-muted-foreground">{f.calls} calls</span>
                        <span className="font-medium">{fmt$(f.cost)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-sm text-muted-foreground">No data</div>
            )}
          </Card>

          {/* By model */}
          <Card className="p-4">
            <h3 className="text-sm font-medium mb-4">Cost by model</h3>
            {d.byModel.length > 0 ? (
              <div className="space-y-3">
                {d.byModel.map((m, i) => {
                  const pct = s.totalCost > 0 ? (m.cost / s.totalCost) * 100 : 0;
                  return (
                    <div key={m.model}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                          <span className="font-mono text-[11px] truncate max-w-[140px]">{m.model}</span>
                        </div>
                        <div className="flex items-center gap-3 tabular-nums">
                          <span className="text-muted-foreground">{fmtK(m.tokens)} tok</span>
                          <span className="font-medium">{fmt$(m.cost)}</span>
                        </div>
                      </div>
                      <div className="w-full bg-muted rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full"
                          style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}
                        />
                      </div>
                    </div>
                  );
                })}

                <div className="pt-3 border-t mt-3">
                  <p className="text-[11px] text-muted-foreground">
                    Pricing: gpt-4o-mini $0.15/$0.60 · gpt-4o $2.50/$10 · claude-sonnet $3/$15 per 1M tokens (in/out).
                    Estimates only — check your provider dashboard for actuals.
                  </p>
                </div>
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">No data</div>
            )}
          </Card>
        </div>

        {/* Daily token trend line */}
        {chartDays.some((d) => d.tokens > 0) && (
          <Card className="p-4">
            <h3 className="text-sm font-medium mb-4">Token consumption trend</h3>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={chartDays} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtK} width={46} />
                <Tooltip content={<CostTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="tokens" stroke="#3B82F6" strokeWidth={2} dot={false} name="tokens" />
                <Line type="monotone" dataKey="calls" stroke="#10B981" strokeWidth={2} dot={false} name="calls" />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* Recent calls table */}
        <Card className="p-4">
          <h3 className="text-sm font-medium mb-3">Recent calls</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-1.5 pr-3 font-medium">Feature</th>
                  <th className="text-left py-1.5 pr-3 font-medium">Model</th>
                  <th className="text-right py-1.5 pr-3 font-medium">In</th>
                  <th className="text-right py-1.5 pr-3 font-medium">Out</th>
                  <th className="text-right py-1.5 pr-3 font-medium">
                    <Clock className="h-3 w-3 inline" />
                  </th>
                  <th className="text-right py-1.5 font-medium">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {d.recent.length === 0 ? (
                  <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No calls recorded yet</td></tr>
                ) : d.recent.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-1.5 pr-3">
                      <Badge variant="secondary" className="text-[10px]">
                        {FEATURE_LABELS[r.feature || "unknown"] ?? r.feature ?? "—"}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-[10px] text-muted-foreground max-w-[120px] truncate">
                      {r.model}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                      {fmtK(r.inputTokens || 0)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                      {fmtK(r.outputTokens || 0)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                      {r.latencyMs ? `${(r.latencyMs / 1000).toFixed(1)}s` : "—"}
                    </td>
                    <td className="py-1.5 text-right tabular-nums font-medium">
                      {fmt$(r.estimatedCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

      </div>
    </div>
  );
}
