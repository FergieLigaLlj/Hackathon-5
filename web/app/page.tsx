import { Suspense } from "react";
import PortfolioOverview from "@/components/dashboard/portfolio-overview";
import MarginChartWrapper from "@/components/dashboard/margin-chart-wrapper";
import ProjectTable from "@/components/dashboard/project-table";
import RiskAlerts from "@/components/dashboard/risk-alerts";
import { ChatPanel } from "@/components/chat/chat-panel";

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-28 bg-muted rounded-lg" />
        ))}
      </div>
      <div className="h-80 bg-muted rounded-lg" />
      <div className="h-64 bg-muted rounded-lg" />
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Dashboard — left side, scrollable */}
      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Morrison Mechanical
            </h1>
            <p className="text-sm text-muted-foreground">
              HVAC Portfolio Dashboard — $50M/yr Contractor
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            Margin Rescue Agent v1.0
          </div>
        </div>

        <Suspense fallback={<DashboardSkeleton />}>
          <PortfolioOverview />
        </Suspense>

        <Suspense
          fallback={<div className="h-80 bg-muted rounded-lg animate-pulse" />}
        >
          <MarginChartWrapper />
        </Suspense>

        <Suspense
          fallback={<div className="h-64 bg-muted rounded-lg animate-pulse" />}
        >
          <ProjectTable />
        </Suspense>

        <Suspense
          fallback={<div className="h-48 bg-muted rounded-lg animate-pulse" />}
        >
          <RiskAlerts />
        </Suspense>
      </main>

      {/* Chat panel — right side, fixed width */}
      <aside className="w-[440px] shrink-0 border-l border-border">
        <ChatPanel />
      </aside>
    </div>
  );
}
