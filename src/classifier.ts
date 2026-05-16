import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { complete } from "@earendil-works/pi-ai";
import type { AssistantMessage, Context, Message, Tool } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { ResolvedConfig, ClassifierDecision } from "./types";

const CLASSIFIER_TOOL_NAME = "auto_mode_classifier";

const classifierToolSchema = Type.Object({
  decision: Type.Union([Type.Literal("allow"), Type.Literal("block")]),
  reason: Type.String(),
  confidence: Type.Union([
    Type.Literal("high"),
    Type.Literal("medium"),
    Type.Literal("low"),
  ]),
  category: Type.Union([
    Type.Literal("user_intent"),
    Type.Literal("security"),
    Type.Literal("data_loss"),
    Type.Literal("scope_creep"),
    Type.Literal("infrastructure"),
    Type.Literal("credential_access"),
    Type.Literal("other"),
  ]),
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
    "You are a security classifier for a coding agent. Evaluate whether the following tool call should be allowed or blocked.",
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
    "Respond with your decision using the classifier tool.",
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

export function parseClassifierToolCall(message: AssistantMessage): ClassifierDecision | null {
  const toolCall = message.content.find((c) => c.type === "toolCall") as
    | { type: "toolCall"; arguments: Record<string, unknown> }
    | undefined;
  if (!toolCall) return null;

  const args = toolCall.arguments;
  if (
    typeof args.decision === "string" &&
    (args.decision === "allow" || args.decision === "block") &&
    typeof args.reason === "string" &&
    typeof args.confidence === "string" &&
    (args.confidence === "high" || args.confidence === "medium" || args.confidence === "low") &&
    typeof args.category === "string" &&
    [
      "user_intent",
      "security",
      "data_loss",
      "scope_creep",
      "infrastructure",
      "credential_access",
      "other",
    ].includes(args.category)
  ) {
    return {
      decision: args.decision,
      reason: args.reason,
      confidence: args.confidence,
      category: args.category as ClassifierDecision["category"],
    };
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

  const systemPrompt = buildPrompt(config);
  const userMessages = stripTranscript(transcript);
  const pendingTool = formatPendingToolCall(toolName, toolInput);

  const context: Context = {
    systemPrompt,
    messages: [
      ...userMessages,
      { role: "user", content: pendingTool, timestamp: Date.now() },
    ],
    tools: [classifierTool],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await deps.complete(model, context, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const parsed = parseClassifierToolCall(response);
    if (parsed) return parsed;

    throw new Error("Classifier returned malformed decision");
  } catch (error) {
    clearTimeout(timeout);
    throw new Error(`Classifier failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
