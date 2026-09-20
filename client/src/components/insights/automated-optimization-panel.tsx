/**
 * Automated Optimization panel (Phase 29.4).
 *
 * Server-derived only -- every field here comes from GET /api/autonomy/status
 * and /api/autonomy/decisions, never from local component state, so a
 * reload or a second browser tab always shows the same authoritative truth.
 * Deliberately non-anthropomorphic ("Automated Optimization", not "AI
 * Controls Your Content").
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui-shared/confirm-dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Bot, ShieldAlert } from "lucide-react";
import { humanizeScope } from "@/lib/insights-state";

function decisionTypeLabel(decisionType: string): string {
  switch (decisionType) {
    case "activation":
      return "Activation";
    case "rollback":
      return "Rollback";
    case "experiment_selection":
      return "Experiment Selection";
    default:
      return decisionType;
  }
}

interface AutonomyStatus {
  enabled: boolean;
  mode: string;
  experimentAutomationEnabled: boolean;
  activationAutomationEnabled: boolean;
  rollbackEnabled: boolean;
  circuitBreakerState: "open" | "closed";
  circuitBreakerReason: string | null;
  maxActivationsPerDay: number;
  maxActivationsPerWeek: number;
  cooldownMinutes: number;
}

interface AutonomyDecision {
  id: number;
  decisionType: string;
  targetScope: string | null;
  outcome: "allowed" | "denied";
  code: string;
  reason: string;
  evidenceQuality: string | null;
  createdAt: string;
}

function modeLabel(mode: string): string {
  switch (mode) {
    case "disabled":
      return "Disabled";
    case "observe_only":
      return "Observe Only";
    case "recommend":
      return "Recommend Only";
    case "experiment_only":
      return "Experiments Only";
    case "bounded_activation":
      return "Bounded Activation";
    default:
      return mode;
  }
}

export function AutomatedOptimizationPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAllDecisions, setShowAllDecisions] = useState(false);

  const { data: status, isLoading } = useQuery<AutonomyStatus>({
    queryKey: ["/api/autonomy/status"],
  });
  const { data: decisions } = useQuery<AutonomyDecision[]>({
    queryKey: ["/api/autonomy/decisions"],
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/autonomy/status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/autonomy/decisions"] });
  };

  const disableMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/autonomy/disable", {})).json(),
    onSuccess: () => {
      invalidate();
      toast({ title: "Automated optimization disabled", description: "No autonomous action can occur until re-enabled." });
    },
  });
  const pauseMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/autonomy/pause", {})).json(),
    onSuccess: () => {
      invalidate();
      toast({ title: "Automated optimization paused" });
    },
  });
  const resetBreakerMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/autonomy/circuit-breaker/reset", {})).json(),
    onSuccess: () => {
      invalidate();
      toast({ title: "Circuit breaker cleared" });
    },
  });

  if (isLoading) {
    return (
      <Card className="p-4" data-testid="section-automated-optimization">
        <Skeleton className="h-6 w-48 mb-3" />
        <Skeleton className="h-16 w-full" />
      </Card>
    );
  }

  const visibleDecisions = showAllDecisions ? decisions ?? [] : (decisions ?? []).slice(0, 5);

  return (
    <Card className="p-4" data-testid="section-automated-optimization">
      <CardHeader className="p-0 mb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
          <Bot className="h-4 w-4 text-primary" />
          Automated Optimization
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Bounded, deterministic autonomy: experiments and production activations only proceed when every safety gate
          passes. Never overrides a human decision.
        </p>
      </CardHeader>
      <CardContent className="p-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status?.enabled ? "default" : "secondary"} data-testid="badge-autonomy-enabled">
            {status?.enabled ? "Enabled" : "Disabled"}
          </Badge>
          <Badge variant="outline" data-testid="badge-autonomy-mode">
            Mode: {modeLabel(status?.mode ?? "disabled")}
          </Badge>
          <Badge
            variant={status?.circuitBreakerState === "open" ? "destructive" : "outline"}
            data-testid="badge-circuit-breaker"
          >
            Circuit Breaker: {status?.circuitBreakerState === "open" ? "Open" : "Closed"}
          </Badge>
        </div>

        {status?.circuitBreakerState === "open" && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Circuit breaker is open -- no autonomous activation can occur.</p>
              {status.circuitBreakerReason && <p className="mt-0.5">{status.circuitBreakerReason}</p>}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs text-muted-foreground">
          <div>
            <p className="font-medium text-foreground">Activation Budget</p>
            <p>{status?.maxActivationsPerDay ?? 0}/day, {status?.maxActivationsPerWeek ?? 0}/week</p>
          </div>
          <div>
            <p className="font-medium text-foreground">Cooldown</p>
            <p>{status?.cooldownMinutes ?? 0} minutes per scope</p>
          </div>
          <div>
            <p className="font-medium text-foreground">Automation</p>
            <p>
              Experiments: {status?.experimentAutomationEnabled ? "On" : "Off"} · Activation:{" "}
              {status?.activationAutomationEnabled ? "On" : "Off"} · Rollback: {status?.rollbackEnabled ? "On" : "Off"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pauseMutation.isPending || !status?.enabled}
            onClick={() => pauseMutation.mutate()}
            data-testid="button-autonomy-pause"
          >
            Pause
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disableMutation.isPending || !status?.enabled}
            onClick={() => disableMutation.mutate()}
            data-testid="button-autonomy-disable"
          >
            Disable
          </Button>
          {status?.circuitBreakerState === "open" && (
            <Button
              size="sm"
              variant="destructive"
              disabled={resetBreakerMutation.isPending}
              onClick={() => resetBreakerMutation.mutate()}
              data-testid="button-autonomy-reset-breaker"
            >
              Clear Circuit Breaker
            </Button>
          )}
        </div>

        <div>
          <h4 className="text-xs font-semibold text-foreground mb-2">Recent Decisions</h4>
          {!decisions || decisions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No autonomous decisions recorded yet.</p>
          ) : (
            <ul className="space-y-1.5" data-testid="list-autonomy-decisions">
              {visibleDecisions.map((d) => (
                <li key={d.id} className="text-xs border rounded-md p-2 flex items-start justify-between gap-2">
                  <div>
                    <span className={d.outcome === "allowed" ? "text-emerald-700 font-medium" : "text-muted-foreground font-medium"}>
                      {d.outcome === "allowed" ? "Allowed" : "Denied"}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      {decisionTypeLabel(d.decisionType)} ({d.code}){d.targetScope ? ` -- ${humanizeScope(d.targetScope)}` : ""}
                    </span>
                    <p className="text-muted-foreground mt-0.5">{d.reason}</p>
                  </div>
                  <time className="text-muted-foreground whitespace-nowrap">
                    {new Date(d.createdAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
          {decisions && decisions.length > 5 && !showAllDecisions && (
            <Button
              size="sm"
              variant="ghost"
              className="mt-2"
              onClick={() => setShowAllDecisions(true)}
              data-testid="button-autonomy-show-all-decisions"
            >
              Show all {decisions.length} decisions
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
