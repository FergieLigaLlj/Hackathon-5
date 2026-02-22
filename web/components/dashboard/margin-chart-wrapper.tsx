import { getProjectSummaries } from "@/lib/queries";
import MarginChart from "./margin-chart";

export default async function MarginChartWrapper() {
  const projects = await getProjectSummaries();

  const data = projects.map((p) => ({
    project_name: String(p.project_name),
    bid_margin_pct: Number(p.bid_margin_pct),
    realized_margin_pct: Number(p.realized_margin_pct),
  }));

  return <MarginChart data={data} />;
}
