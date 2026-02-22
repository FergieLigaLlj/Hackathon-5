"use client";

import { useEffect, useRef } from "react";
import { type UIMessage } from "ai";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ToolCallDisplay } from "./tool-call-display";

interface MessageListProps {
  messages: UIMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
        No messages yet. Start a conversation below.
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-4 p-4">
        {messages.map((message, index) => {
          const isUser = message.role === "user";

          return (
            <div
              key={message.id}
              className={cn(
                "flex flex-col gap-1",
                isUser ? "items-end" : "items-start"
              )}
            >
              <span className="text-[10px] text-muted-foreground px-1">
                {isUser ? "You" : "Assistant"} &middot; #{index + 1}
              </span>

              {isUser ? (
                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
                  {message.parts
                    .filter((part) => part.type === "text")
                    .map((part, i) => (
                      <p key={i} className="whitespace-pre-wrap">
                        {part.text}
                      </p>
                    ))}
                </div>
              ) : (
                <div className="max-w-[80%] space-y-1">
                  {message.parts.map((part, partIndex) => {
                    if (part.type === "text") {
                      return (
                        <div
                          key={partIndex}
                          className="rounded-2xl rounded-bl-sm bg-muted px-4 py-2 text-sm"
                        >
                          <p className="whitespace-pre-wrap">{part.text}</p>
                        </div>
                      );
                    }

                    if (
                      part.type === "dynamic-tool" ||
                      part.type.startsWith("tool-")
                    ) {
                      const toolPart = part as {
                        toolName: string;
                        toolCallId: string;
                        state: string;
                        input?: unknown;
                        output?: unknown;
                      };

                      let displayState: "call" | "result" | "partial-call";
                      if (
                        toolPart.state === "output-available"
                      ) {
                        displayState = "result";
                      } else if (toolPart.state === "input-streaming") {
                        displayState = "partial-call";
                      } else {
                        displayState = "call";
                      }

                      return (
                        <ToolCallDisplay
                          key={toolPart.toolCallId || partIndex}
                          toolName={toolPart.toolName}
                          args={
                            (toolPart.input as Record<string, unknown>) ?? {}
                          }
                          result={toolPart.output}
                          state={displayState}
                        />
                      );
                    }

                    return null;
                  })}
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
