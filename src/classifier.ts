import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { complete, StringEnum } from "@earendil-works/pi-ai";
import type { AssistantMessage, Context, Message, Tool, ToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { ResolvedConfig, ClassifierDecision } from "./types";

const CLASSIFIER_TOOL_NAME = "auto_mode_classifier";

const classifierToolSchema = Type.Object({
  decision: StringEnum(["allow", "block"] as const, {
    description: "Whether to allow or block the pending tool call",
  }),
  reason: Type.String({ description: "Concise explanation for the decision" }),
  confidence: StringEnum(["high", "medium", "low"] as const, {
    description: "Confidence level in the decision",
  }),
  category: StringEnum(
    [
      "user_intent",
      "security",
      "data_loss",
      "scope_creep",
      "infrastructure",
      "credential_access",
      "other",
    ] as const,
    { description: "Category of the decision" },
  ),
});

const classifierTool: Tool = {
  name: CLASSIFIER_TOOL_NAME,
  description:
    "Classify whether the pending tool call should be allowed or blocked. Provide a concise reason.",
  parameters: classifierToolSchema,
};

export function buildPrompt(config: ResolvedConfig): string {
  if (config.classifier.prompt) {
    return config.classifier.prompt;
  }

  return [
    "You are a security classifier for a coding agent. Your job is to evaluate a pending tool call and decide whether it should be allowed or blocked.",
    "",
    "## Environment",
    ...config.classifier.environment,
    "",
    "## Hard Deny Rules (block unless explicitly justified)",
    ...config.classifier.hardDeny,
    "",
    "## Soft Deny Rules (be cautious)",
    ...config.classifier.softDeny,
    "",
    "## Allow Rules (exceptions that are safe)",
    ...config.classifier.allow,
    "",
    "## Decision Rules",
    "1. Evaluate real-world impact, not surface text.",
    "2. Be conservative on user intent.",
    "3. Apply block rules first, then allow exceptions.",
    "4. If uncertain, block with low confidence.",
    "",
    "## IMPORTANT",
    `You MUST call the \`${CLASSIFIER_TOOL_NAME}\` tool to submit your decision.`,
    "Do not write a text response — use the tool.",
  ].join("\n");
}

function formatPendingToolCall(toolName: string, input: Record<string, unknown>): string {
  return [
    "## Pending Tool Call",
    `Tool: ${toolName}`,
    "Arguments:",
    JSON.stringify(input, null, 2),
  ].join("\n");
}

function stripTranscript(messages: Message[]): Message[] {
  return messages.filter((m) => m.role === "user");
}

const VALID_DECISIONS = ["allow", "block"] as const;
const VALID_CONFIDENCES = ["high", "medium", "low"] as const;
const VALID_CATEGORIES = [
  "user_intent",
  "security",
  "data_loss",
  "scope_creep",
  "infrastructure",
  "credential_access",
  "other",
] as const;

function isValidDecision(obj: unknown): obj is ClassifierDecision {
  if (typeof obj !== "object" || obj === null) return false;
  const d = obj as Record<string, unknown>;
  return (
    typeof d.decision === "string" && VALID_DECISIONS.includes(d.decision as any) &&
    typeof d.reason === "string" &&
    typeof d.confidence === "string" && VALID_CONFIDENCES.includes(d.confidence as any) &&
    typeof d.category === "string" && VALID_CATEGORIES.includes(d.category as any)
  );
}

function extractArgsFromToolCall(toolCall: { arguments: unknown } | ToolCall): ClassifierDecision | null {
  let args = toolCall.arguments;
  // Some providers return arguments as a JSON string
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return null;
    }
  }
  return isValidDecision(args) ? args : null;
}

function extractArgsFromText(text: string): ClassifierDecision | null {
  // Try to find JSON in the text (with or without code fences)
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch ? jsonMatch[1]!.trim() : text.trim();
  try {
    const parsed = JSON.parse(jsonStr);
    return isValidDecision(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseClassifierToolCall(message: AssistantMessage): ClassifierDecision | null {
  // Prefer a matching tool call
  const toolCall = message.content.find(
    (c): c is ToolCall =>
      c.type === "toolCall" && "name" in c && c.name === CLASSIFIER_TOOL_NAME,
  );

  if (toolCall) {
    const parsed = extractArgsFromToolCall(toolCall);
    if (parsed) return parsed;
  }

  // Fallback: try to parse JSON from text content
  for (const c of message.content) {
    if (c.type === "text") {
      const parsed = extractArgsFromText(c.text);
      if (parsed) return parsed;
    }
  }

  // Fallback: some reasoning models embed the decision in thinking blocks
  for (const c of message.content) {
    if (c.type === "thinking") {
      const parsed = extractArgsFromText(c.thinking);
      if (parsed) return parsed;
    }
  }

  return null;
}

export interface ClassifierDeps {
  complete: typeof complete;
}

function resolveModel(
  config: ResolvedConfig,
  ctx: ExtensionContext,
): Model<any> | undefined {
  if (config.classifier.model) {
    const parts = config.classifier.model.split("/");
    if (parts.length >= 2) {
      const provider = parts[0];
      const modelId = parts.slice(1).join("/");
      const found = ctx.modelRegistry.find(provider, modelId);
      if (found) return found;
    }
  }
  return ctx.model;
}

export async function classify(
  config: ResolvedConfig,
  toolName: string,
  toolInput: Record<string, unknown>,
  transcript: Message[],
  ctx: ExtensionContext,
  currentMode: string,
  deps: ClassifierDeps = { complete },
): Promise<ClassifierDecision> {
  const model = resolveModel(config, ctx);
  if (!model) {
    return {
      decision: "block",
      reason: "Classifier failed: no model available",
      confidence: "low",
      category: "other",
    };
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    return {
      decision: "block",
      reason: `Classifier failed: ${auth.error || "no API key available"}`,
      confidence: "low",
      category: "other",
    };
  }

  const systemPrompt = buildPrompt(config);
  const userMessages = stripTranscript(transcript);
  const pendingTool = formatPendingToolCall(toolName, toolInput);

  const context: Context = {
    systemPrompt,
    messages: [
      ...userMessages,
      { role: "user", content: pendingTool, timestamp: Date.now() },
      {
        role: "user",
        content: `Call the \`${CLASSIFIER_TOOL_NAME}\` tool now with your decision.`,
        timestamp: Date.now(),
      },
    ],
    tools: [classifierTool],
  };

  if (ctx.hasUI) {
    ctx.ui.setStatus("auto-mode", "auto-mode: classifying...");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.classifier.timeoutMs);

  try {
    // Some providers (e.g. Moonshot/Kimi) reject tool_choice when reasoning is
    // enabled. We disable reasoning when the model declares a way to do so via
    // its thinkingLevelMap (model-agnostic, no hard-coding).
    const streamOptions: Parameters<typeof deps.complete>[2] = {
      signal: controller.signal,
      apiKey: auth.apiKey,
      headers: auth.headers,
      toolChoice: { type: "function", function: { name: CLASSIFIER_TOOL_NAME } },
    };
    // Disable reasoning when the model declares a provider-specific way to do so.
    // If thinkingLevelMap.off is a string, it maps to a provider value (e.g. "none").
    // If it's null or undefined, reasoning cannot be disabled via this mechanism.
    if (model.thinkingLevelMap?.off != null) {
      streamOptions.reasoningEffort = model.thinkingLevelMap.off;
    }
    const response = await deps.complete(model, context, streamOptions);
    clearTimeout(timeout);

    if (response.stopReason === "error") {
      throw new Error(response.errorMessage || "Classifier model returned an error");
    }

    const parsed = parseClassifierToolCall(response);
    if (parsed) return parsed;

    // Build a preview of whatever the model returned for debugging
    const preview = response.content
      .map((c) => {
        if (c.type === "text") return c.text;
        if (c.type === "toolCall") return `[tool:${c.name}] ${JSON.stringify(c.arguments)}`;
        if (c.type === "thinking") return `[thinking] ${c.thinking.slice(0, 100)}`;
        return "";
      })
      .join(" ")
      .slice(0, 300);

    // If the model returned absolutely nothing, default to block (safe fallback)
    if (!preview.trim()) {
      return {
        decision: "block",
        reason: "Classifier returned empty response (model did not produce output)",
        confidence: "low",
        category: "other",
      };
    }

    throw new Error(`Classifier returned malformed decision (preview: ${preview})`);
  } catch (error) {
    clearTimeout(timeout);
    throw new Error(`Classifier failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (ctx.hasUI) {
      ctx.ui.setStatus("auto-mode", `auto-mode: ${currentMode}`);
    }
  }
}
