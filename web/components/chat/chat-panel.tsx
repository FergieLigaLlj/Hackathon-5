"use client";

import { useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { Bot, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MessageList } from "./message-list";

const QUICK_ACTIONS = [
  "Portfolio Overview",
  "Find Margin Leaks",
  "Billing Lag Analysis",
  "Scope Creep Report",
  "Labor Overruns",
  "Change Order Pipeline",
] as const;

export function ChatPanel() {
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    setInput,
    append,
  } = useChat();

  const formRef = useRef<HTMLFormElement>(null);

  const handleQuickAction = (prompt: string) => {
    append({ role: "user", content: prompt });
  };

  return (
    <div className="flex h-full flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3">
        <Bot className="size-5 text-primary" />
        <h2 className="text-base font-semibold">AI Financial Advisor</h2>
      </div>

      <Separator />

      {/* Message List */}
      <div className="flex-1 overflow-hidden">
        <MessageList messages={messages} />
      </div>

      <Separator />

      {/* Quick Action Chips */}
      <div className="px-3 py-2">
        <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
          {QUICK_ACTIONS.map((action) => (
            <Badge
              key={action}
              variant="outline"
              className={cn(
                "cursor-pointer whitespace-nowrap px-3 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground",
                isLoading && "pointer-events-none opacity-50"
              )}
              onClick={() => handleQuickAction(action)}
            >
              {action}
            </Badge>
          ))}
        </div>
      </div>

      {/* Loading Indicator */}
      {isLoading && (
        <div className="flex items-center gap-2 px-4 pb-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          <span>Thinking...</span>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t px-3 py-3">
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="flex items-center gap-2"
        >
          <Input
            value={input}
            onChange={handleInputChange}
            placeholder="Ask about your projects..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button
            type="submit"
            size="icon"
            disabled={isLoading || !(input ?? "").trim()}
          >
            <Send className="size-4" />
            <span className="sr-only">Send message</span>
          </Button>
        </form>
      </div>
    </div>
  );
}
