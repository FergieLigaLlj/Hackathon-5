import { getProjectSummaries } from "@/lib/queries";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

function formatMillions(value: number): string {
  return `$${(Number(value) / 1_000_000).toFixed(1)}M`;
}

function marginColor(margin: number): string {
  const pct = Number(margin);
  if (pct > 0.15) return "text-emerald-600 dark:text-emerald-400";
  if (pct > 0.1) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function formatPct(value: number): string {
  return `${(Number(value) * 100).toFixed(1)}%`;
}

export default async function ProjectTable() {
  const projects = await getProjectSummaries();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Status</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project Name</TableHead>
              <TableHead className="text-right">Contract Value</TableHead>
              <TableHead className="text-right">Bid Margin</TableHead>
              <TableHead className="text-right">Realized Margin</TableHead>
              <TableHead className="text-right">% Complete</TableHead>
              <TableHead className="text-right">Pending COs</TableHead>
              <TableHead className="text-right">Scope Creep</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => (
              <TableRow key={project.project_id}>
                <TableCell className="font-medium">
                  {project.project_name}
                </TableCell>
                <TableCell className="text-right">
                  {formatMillions(project.original_contract_value)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-semibold",
                    marginColor(project.bid_margin_pct)
                  )}
                >
                  {formatPct(project.bid_margin_pct)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-semibold",
                    marginColor(project.realized_margin_pct)
                  )}
                >
                  {formatPct(project.realized_margin_pct)}
                </TableCell>
                <TableCell className="text-right">
                  {`${Number(project.pct_complete).toFixed(1)}%`}
                </TableCell>
                <TableCell className="text-right">
                  {Number(project.pending_cos) > 0 ? (
                    <Badge variant="outline">{project.pending_cos}</Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {Number(project.scope_creep_count) > 0 ? (
                    <Badge variant="destructive">
                      {project.scope_creep_count}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
