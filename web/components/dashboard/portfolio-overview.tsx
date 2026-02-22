import { getPortfolioSummary } from "@/lib/queries";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
} from "lucide-react";

function formatMillions(value: number): string {
  return `$${(value / 1_000_000).toFixed(1)}M`;
}

function marginColor(margin: number): string {
  if (margin > 0.15) return "text-emerald-600 dark:text-emerald-400";
  if (margin > 0.1) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

export default async function PortfolioOverview() {
  const summary = await getPortfolioSummary();

  const cards = [
    {
      title: "Portfolio Value",
      value: formatMillions(summary.totalContractValue),
      subtitle: `${summary.projectCount} active projects`,
      icon: DollarSign,
      valueClass: "text-foreground",
    },
    {
      title: "Bid Margin",
      value: `${(summary.bidMargin * 100).toFixed(1)}%`,
      subtitle: `Cost: ${formatMillions(summary.totalBidCost)}`,
      icon: TrendingUp,
      valueClass: marginColor(summary.bidMargin),
    },
    {
      title: "Realized Margin",
      value: `${(summary.realizedMargin * 100).toFixed(1)}%`,
      subtitle: `Billed: ${formatMillions(summary.totalBilled)}`,
      icon: summary.realizedMargin >= summary.bidMargin ? TrendingUp : TrendingDown,
      valueClass: marginColor(summary.realizedMargin),
    },
    {
      title: "At Risk",
      value: formatMillions(summary.atRiskAmount),
      subtitle: `Pending COs: ${formatMillions(summary.pendingCOAmount)}`,
      icon: AlertTriangle,
      valueClass: "text-red-600 dark:text-red-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className={cn("text-2xl font-bold tracking-tight", card.valueClass)}>
                {card.value}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {card.subtitle}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
