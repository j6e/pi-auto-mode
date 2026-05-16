import { describe, it, expect, vi } from "vitest";
import { buildPrompt, classify, parseClassifierToolCall } from "./classifier";
import type { ResolvedConfig } from "./types";
import type { ExtensionContext, Model } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";

const DEFAULT_CONFIG: ResolvedConfig = {
  defaultMode: "auto",
  classifier: {
    model: null,
    prompt: null,
    environment: ["Dev env"],
    hardDeny: ["No rm -rf"],
    softDeny: ["Be careful with APIs"],
    allow: ["Tests are fine"],
  },
  denyAndContinue: {
    maxConsecutiveDenials: 3,
    maxTotalDenials: 20,
  },
};

function makeMockModel(): Model<any> {
  return {
    id: "claude-sonnet-4",
    provider: "anthropic",
  } as Model<any>;
}

function makeMockCtx(model?: Model<any>): ExtensionContext {
  return {
    cwd: "/project",
    model: model ?? makeMockModel(),
    modelRegistry: {
      find: vi.fn().mockReturnValue(model ?? makeMockModel()),
    },
    sessionManager: {
      getEntries: vi.fn().mockReturnValue([]),
    },
  } as unknown as ExtensionContext;
}

function makeToolCallMessage(args: Record<string, unknown>): AssistantMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "tc-1",
        name: "auto_mode_classifier",
        arguments: args,
      },
    ],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "tool_call",
    timestamp: Date.now(),
  };
}

describe("buildPrompt", () => {
  it("includes environment, hardDeny, softDeny, and allow sections", () => {
    const prompt = buildPrompt(DEFAULT_CONFIG);
    expect(prompt).toContain("Dev env");
    expect(prompt).toContain("No rm -rf");
    expect(prompt).toContain("Be careful with APIs");
    expect(prompt).toContain("Tests are fine");
  });

  it("uses custom prompt override when configured", () => {
    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      classifier: { ...DEFAULT_CONFIG.classifier, prompt: "Custom prompt only" },
    };
    const prompt = buildPrompt(config);
    expect(prompt).toBe("Custom prompt only");
  });
});

describe("parseClassifierToolCall", () => {
  it("parses valid tool call arguments", () => {
    const msg = makeToolCallMessage({
      decision: "block",
      reason: "Too dangerous",
      confidence: "high",
      category: "security",
    });
    const result = parseClassifierToolCall(msg);
    expect(result).toEqual({
      decision: "block",
      reason: "Too dangerous",
      confidence: "high",
      category: "security",
    });
  });

  it("returns null when no tool calls present", () => {
    const msg: AssistantMessage = {
      ...makeToolCallMessage({}),
      content: [{ type: "text", text: "Hello" }],
    };
    expect(parseClassifierToolCall(msg)).toBeNull();
  });

  it("returns null when arguments are malformed", () => {
    const msg = makeToolCallMessage({ decision: "maybe", reason: 123 });
    expect(parseClassifierToolCall(msg)).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    const msg = makeToolCallMessage({ decision: "allow" });
    expect(parseClassifierToolCall(msg)).toBeNull();
  });
});

describe("classify", () => {
  it("returns parsed decision on successful completion", async () => {
    const mockComplete = vi.fn().mockResolvedValue(
      makeToolCallMessage({
        decision: "allow",
        reason: "Safe command",
        confidence: "high",
        category: "user_intent",
      }),
    );

    const ctx = makeMockCtx();
    const result = await classify(
      DEFAULT_CONFIG,
      "bash",
      { command: "npm test" },
      [],
      ctx,
      { complete: mockComplete },
    );

    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("Safe command");
    expect(result.confidence).toBe("high");
    expect(result.category).toBe("user_intent");
  });

  it("strips assistant and tool_result messages from transcript", async () => {
    const mockComplete = vi.fn().mockResolvedValue(
      makeToolCallMessage({
        decision: "block",
        reason: "Bad",
        confidence: "medium",
        category: "security",
      }),
    );

    const transcript: Message[] = [
      { role: "user", content: [{ type: "text", text: "Hello" }], timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "text", text: "Hi" }],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "end_turn",
        timestamp: 2,
      },
      {
        role: "toolResult",
        toolCallId: "1",
        toolName: "read",
        content: [{ type: "text", text: "content" }],
        isError: false,
        timestamp: 3,
      },
      { role: "user", content: [{ type: "text", text: "Do it" }], timestamp: 4 },
    ];

    const ctx = makeMockCtx();
    await classify(DEFAULT_CONFIG, "bash", { command: "rm -rf /" }, transcript, ctx, {
      complete: mockComplete,
    });

    const passedContext = mockComplete.mock.calls[0][1];
    const messages = passedContext.messages as Message[];

    // Should only contain user messages + the pending tool call description
    const userMessages = messages.filter((m) => m.role === "user");
    expect(userMessages.length).toBe(3); // 2 original user messages + pending tool call
    expect(messages.some((m) => m.role === "assistant")).toBe(false);
    expect(messages.some((m) => m.role === "toolResult")).toBe(false);
  });

  it("defaults to ctx.model when no classifier model configured", async () => {
    const mockComplete = vi.fn().mockResolvedValue(
      makeToolCallMessage({
        decision: "allow",
        reason: "OK",
        confidence: "high",
        category: "user_intent",
      }),
    );

    const activeModel = makeMockModel();
    const ctx = makeMockCtx(activeModel);
    await classify(DEFAULT_CONFIG, "bash", { command: "ls" }, [], ctx, {
      complete: mockComplete,
    });

    expect(mockComplete.mock.calls[0][0]).toBe(activeModel);
  });

  it("uses configured model when classifier.model is set", async () => {
    const mockComplete = vi.fn().mockResolvedValue(
      makeToolCallMessage({
        decision: "allow",
        reason: "OK",
        confidence: "high",
        category: "user_intent",
      }),
    );

    const dedicatedModel = { id: "gpt-4o", provider: "openai" } as Model<any>;
    const ctx = makeMockCtx();
    ctx.modelRegistry.find = vi.fn().mockReturnValue(dedicatedModel);

    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      classifier: { ...DEFAULT_CONFIG.classifier, model: "openai/gpt-4o" },
    };

    await classify(config, "bash", { command: "ls" }, [], ctx, {
      complete: mockComplete,
    });

    expect(ctx.modelRegistry.find).toHaveBeenCalledWith("openai", "gpt-4o");
    expect(mockComplete.mock.calls[0][0]).toBe(dedicatedModel);
  });

  it("falls back to ctx.model when configured model is not found", async () => {
    const mockComplete = vi.fn().mockResolvedValue(
      makeToolCallMessage({
        decision: "allow",
        reason: "OK",
        confidence: "high",
        category: "user_intent",
      }),
    );

    const activeModel = makeMockModel();
    const ctx = makeMockCtx(activeModel);
    ctx.modelRegistry.find = vi.fn().mockReturnValue(undefined);

    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      classifier: { ...DEFAULT_CONFIG.classifier, model: "openai/gpt-4o" },
    };

    await classify(config, "bash", { command: "ls" }, [], ctx, {
      complete: mockComplete,
    });

    expect(mockComplete.mock.calls[0][0]).toBe(activeModel);
  });

  it("returns block on timeout", async () => {
    const mockComplete = vi.fn().mockRejectedValue(new Error("Timeout"));

    const ctx = makeMockCtx();
    const result = await classify(DEFAULT_CONFIG, "bash", { command: "ls" }, [], ctx, {
      complete: mockComplete,
    });

    expect(result.decision).toBe("block");
    expect(result.reason).toContain("Timeout");
    expect(result.confidence).toBe("low");
    expect(result.category).toBe("other");
  });

  it("returns block on malformed tool call response", async () => {
    const mockComplete = vi.fn().mockResolvedValue(
      makeToolCallMessage({ decision: "maybe" }),
    );

    const ctx = makeMockCtx();
    const result = await classify(DEFAULT_CONFIG, "bash", { command: "ls" }, [], ctx, {
      complete: mockComplete,
    });

    expect(result.decision).toBe("block");
    expect(result.reason).toContain("malformed");
    expect(result.confidence).toBe("low");
    expect(result.category).toBe("other");
  });
});
