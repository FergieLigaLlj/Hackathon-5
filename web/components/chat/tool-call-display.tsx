"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolCallDisplayProps {
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  state: "call" | "result" | "partial-call";
}

function formatToolName(name: string): string {
  if (!name) return "Unknown Tool";
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function truncateJson(value: unknown, maxLength: number = 200): string {
  const json = JSON.stringify(value, null, 2);
  if (json.length <= maxLength) return json;
  return json.slice(0, maxLength) + "\u2026";
}

export function ToolCallDisplay({
  toolName,
  args,
  result,
  state,
}: ToolCallDisplayProps) {
  const isLoading = state === "call" || state === "partial-call";
  const displayName = formatToolName(toolName);

  if (isLoading) {
    return (
      <div
        className={cn(
          "my-2 flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
        )}
      >
        <Loader2 className="size-4 animate-spin text-primary" />
        <span>
          Calling <span className="font-medium">{displayName}</span>...
        </span>
      </div>
    );
  }

  return (
    <details
      className={cn(
        "my-2 rounded-md border border-border/50 bg-muted/30 text-sm"
      )}
    >
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-muted-foreground hover:bg-muted/50">
        <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
        <span className="font-medium">{displayName}</span>
      </summary>

      <div className="border-t border-border/50 px-3 py-2 space-y-2">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Arguments
          </p>
          <pre className="whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 font-mono text-xs">
            {JSON.stringify(args, null, 2)}
          </pre>
        </div>

        {result !== undefined && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Result
            </p>
            <pre className="whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 font-mono text-xs">
              {truncateJson(result)}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}
