import { getRiskAlerts } from "@/lib/queries";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";

const severityConfig = {
  high: {
    icon: AlertTriangle,
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-950/30",
    border: "border-red-200 dark:border-red-900",
  },
  medium: {
    icon: AlertCircle,
    color: "text-yellow-600 dark:text-yellow-400",
    bg: "bg-yellow-50 dark:bg-yellow-950/30",
    border: "border-yellow-200 dark:border-yellow-900",
  },
  low: {
    icon: Info,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-200 dark:border-blue-900",
  },
} as const;

const typeLabels: Record<string, string> = {
  scope_creep: "Scope Creep",
  labor_overrun: "Labor Overrun",
  billing_lag: "Billing Lag",
  pending_co: "Pending CO",
};

function formatAmount(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  return `$${(amount / 1_000).toFixed(0)}K`;
}

export default async function RiskAlerts() {
  const alerts = await getRiskAlerts();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Active Risk Alerts</CardTitle>
        <Badge variant={alerts.length > 0 ? "destructive" : "secondary"}>
          {alerts.length}
        </Badge>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Info className="mr-2 h-4 w-4" />
            No active risk alerts
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert, index) => {
              const config = severityConfig[alert.severity];
              const Icon = config.icon;

              return (
                <div key={`${alert.project_id}-${alert.type}-${index}`}>
                  <div
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3",
                      config.bg,
                      config.border
                    )}
                  >
                    <Icon
                      className={cn("mt-0.5 h-4 w-4 shrink-0", config.color)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">
                          {alert.project_name}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {typeLabels[alert.type] ?? alert.type}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {alert.message}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "shrink-0 text-sm font-bold tabular-nums",
                        config.color
                      )}
                    >
                      {formatAmount(alert.amount)}
                    </div>
                  </div>
                  {index < alerts.length - 1 && (
                    <Separator className="mt-3" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
