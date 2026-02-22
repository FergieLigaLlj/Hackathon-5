import { streamText, stepCountIs, convertToModelMessages } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { systemPrompt } from "@/lib/system-prompt";
import { tools } from "@/lib/tools";

function formatTimestamp() {
  return new Date().toISOString();
}

export async function POST(req: Request) {
  const { messages } = await req.json();

  const modelMessages = await convertToModelMessages(messages);

  const lastUserMsg = modelMessages
    .filter((m: { role: string }) => m.role === "user")
    .pop();
  const userText =
    lastUserMsg && typeof lastUserMsg.content === "string"
      ? lastUserMsg.content
      : JSON.stringify(lastUserMsg?.content);

  console.log(
    `\n[${formatTimestamp()}] ── CHAT REQUEST ──────────────────────────`
  );
  console.log(`  Messages in context: ${modelMessages.length}`);
  console.log(`  Latest user message: "${userText}"`);

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(8),
    onStepFinish({ stepNumber, toolCalls, toolResults, text, usage }) {
      console.log(
        `\n[${formatTimestamp()}] ── STEP ${stepNumber + 1} ──`
      );

      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          console.log(`  Tool call: ${tc.toolName}`);
          console.log(`    Input: ${JSON.stringify(tc.input)}`);
        }
      }

      if (toolResults && toolResults.length > 0) {
        for (const tr of toolResults) {
          const resultStr = JSON.stringify(tr.output);
          const truncated =
            resultStr.length > 300
              ? resultStr.slice(0, 300) + "... (truncated)"
              : resultStr;
          console.log(`  Tool result [${tr.toolName}]: ${truncated}`);
        }
      }

      if (text) {
        const preview =
          text.length > 200 ? text.slice(0, 200) + "..." : text;
        console.log(`  Text: "${preview}"`);
      }

      if (usage) {
        console.log(
          `  Tokens: ${usage.inputTokens} input / ${usage.outputTokens} output`
        );
      }
    },
    onFinish({ text, usage, steps }) {
      console.log(
        `\n[${formatTimestamp()}] ── CHAT COMPLETE ─────────────────────────`
      );
      console.log(`  Total steps: ${steps.length}`);
      if (usage) {
        console.log(
          `  Total tokens: ${usage.inputTokens} input / ${usage.outputTokens} output`
        );
      }
      const responsePreview =
        text && text.length > 300 ? text.slice(0, 300) + "..." : text;
      console.log(`  Final response: "${responsePreview}"`);
      console.log(`  ──────────────────────────────────────────────────\n`);
    },
  });

  return result.toUIMessageStreamResponse();
}
