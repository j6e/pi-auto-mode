import { describe, it, expect, vi } from "vitest";
import { buildPrompt, classify, parseClassifierToolCall } from "../../src/classifier";
import type { ResolvedConfig } from "../../src/types";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
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
    timeoutMs: 3000,
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
    hasUI: true,
    model: model ?? makeMockModel(),
    modelRegistry: {
      find: vi.fn().mockReturnValue(model ?? makeMockModel()),
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({
        ok: true,
        apiKey: "test-key",
        headers: {},
      }),
    },
    sessionManager: {
      getEntries: vi.fn().mockReturnValue([]),
    },
    ui: {
      setStatus: vi.fn(),
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
    stopReason: "toolUse" as any,
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

  it("parses tool call arguments when returned as a JSON string", () => {
    const msg = makeToolCallMessage({
      decision: "allow",
      reason: "Safe",
      confidence: "medium",
      category: "user_intent",
    });
    // Some providers return arguments as a raw JSON string
    (msg.content[0] as any).arguments = JSON.stringify({
      decision: "allow",
      reason: "Safe",
      confidence: "medium",
      category: "user_intent",
    });
    const result = parseClassifierToolCall(msg);
    expect(result).toEqual({
      decision: "allow",
      reason: "Safe",
      confidence: "medium",
      category: "user_intent",
    });
  });

  it("rejects JSON returned as text instead of the classifier tool call", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: '{"decision":"block","reason":"Bad","confidence":"low","category":"security"}' }],
      api: "openai-completions",
      provider: "openai",
      model: "gpt-4o",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop" as any,
      timestamp: Date.now(),
    };
    expect(parseClassifierToolCall(msg)).toBeNull();
  });

  it("ignores tool calls with wrong name", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "tc-1",
          name: "some_other_tool",
          arguments: { decision: "allow", reason: "OK", confidence: "high", category: "user_intent" },
        },
      ],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-sonnet-4",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "toolUse" as any,
      timestamp: Date.now(),
    };
    expect(parseClassifierToolCall(msg)).toBeNull();
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

  it("rejects JSON returned in thinking content instead of the classifier tool call", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: 'Let me analyze this... The decision should be {"decision":"allow","reason":"Safe operation","confidence":"high","category":"user_intent"}',
        },
      ],
      api: "openai-completions",
      provider: "openai",
      model: "gpt-4o",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop" as any,
      timestamp: Date.now(),
    };
    expect(parseClassifierToolCall(msg)).toBeNull();
  });

  it("prefers toolCall over text and thinking content", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "tc-1",
          name: "auto_mode_classifier",
          arguments: {
            decision: "allow",
            reason: "From tool",
            confidence: "high",
            category: "user_intent",
          },
        },
        {
          type: "text",
          text: '{"decision":"block","reason":"From text","confidence":"low","category":"security"}',
        },
        {
          type: "thinking",
          thinking: '{"decision":"block","reason":"From thinking","confidence":"medium","category":"other"}',
        },
      ],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-sonnet-4",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "toolUse" as any,
      timestamp: Date.now(),
    };
    const result = parseClassifierToolCall(msg);
    expect(result!.reason).toBe("From tool");
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
      "auto",
      { complete: mockComplete },
    );

    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("Safe command");
    expect(result.confidence).toBe("high");
    expect(result.category).toBe("user_intent");
  });

  it("sets auto-mode: classifying... status during classification and restores it after", async () => {
    const mockComplete = vi.fn().mockResolvedValue(
      makeToolCallMessage({
        decision: "allow",
        reason: "Safe",
        confidence: "high",
        category: "user_intent",
      }),
    );

    const ctx = makeMockCtx();
    await classify(
      DEFAULT_CONFIG,
      "bash",
      { command: "npm test" },
      [],
      ctx,
      "auto",
      { complete: mockComplete },
    );

    expect(ctx.ui.setStatus).toHaveBeenCalledWith("auto-mode", "auto-mode: classifying...");
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("auto-mode", "auto-mode: auto");
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
        stopReason: "stop" as any,
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
    await classify(DEFAULT_CONFIG, "bash", { command: "rm -rf /" }, transcript, ctx, "auto", {
      complete: mockComplete,
    });

    const passedContext = mockComplete.mock.calls[0][1];
    const messages = passedContext.messages as Message[];

    // Should only contain user messages + the pending tool call + explicit instruction
    const userMessages = messages.filter((m) => m.role === "user");
    expect(userMessages.length).toBe(4); // 2 original user messages + pending tool call + instruction
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
    await classify(DEFAULT_CONFIG, "bash", { command: "ls" }, [], ctx, "auto", {
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

    await classify(config, "bash", { command: "ls" }, [], ctx, "auto", {
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

    await classify(config, "bash", { command: "ls" }, [], ctx, "auto", {
      complete: mockComplete,
    });

    expect(mockComplete.mock.calls[0][0]).toBe(activeModel);
  });

  it("throws on timeout", async () => {
    const mockComplete = vi.fn().mockRejectedValue(new Error("Timeout"));

    const ctx = makeMockCtx();
    await expect(
      classify(DEFAULT_CONFIG, "bash", { command: "ls" }, [], ctx, "auto", {
        complete: mockComplete,
      }),
    ).rejects.toThrow("Timeout");
  });

  it("throws on malformed tool call response", async () => {
    const mockComplete = vi.fn().mockResolvedValue(
      makeToolCallMessage({ decision: "maybe" }),
    );

    const ctx = makeMockCtx();
    await expect(
      classify(DEFAULT_CONFIG, "bash", { command: "ls" }, [], ctx, "auto", {
        complete: mockComplete,
      }),
    ).rejects.toThrow("malformed");
  });

  it("omits toolChoice when classifier tool mode is auto", async () => {
    const mockComplete = vi.fn().mockResolvedValue(
      makeToolCallMessage({
        decision: "allow",
        reason: "OK",
        confidence: "high",
        category: "user_intent",
      }),
    );

    const ctx = makeMockCtx();
    await classify(
      { ...DEFAULT_CONFIG, classifier: { ...DEFAULT_CONFIG.classifier, toolMode: "auto" } },
      "bash",
      { command: "ls" },
      [],
      ctx,
      "auto",
      { complete: mockComplete },
    );

    expect(mockComplete.mock.calls[0][2].toolChoice).toBeUndefined();
  });

  it("passes required toolChoice when classifier tool mode is required", async () => {
    const mockComplete = vi.fn().mockResolvedValue(
      makeToolCallMessage({
        decision: "allow",
        reason: "OK",
        confidence: "high",
        category: "user_intent",
      }),
    );

    const ctx = makeMockCtx();
    await classify(
      { ...DEFAULT_CONFIG, classifier: { ...DEFAULT_CONFIG.classifier, toolMode: "required" } },
      "bash",
      { command: "ls" },
      [],
      ctx,
      "auto",
      { complete: mockComplete },
    );

    expect(mockComplete.mock.calls[0][2].toolChoice).toBe("required");
  });

  it("passes toolChoice to force the classifier tool", async () => {
    const mockComplete = vi.fn().mockResolvedValue(
      makeToolCallMessage({
        decision: "allow",
        reason: "OK",
        confidence: "high",
        category: "user_intent",
      }),
    );

    const ctx = makeMockCtx();
    await classify(DEFAULT_CONFIG, "bash", { command: "ls" }, [], ctx, "auto", {
      complete: mockComplete,
    });

    const options = mockComplete.mock.calls[0][2];
    expect(options.toolChoice).toEqual({
      type: "function",
      function: { name: "auto_mode_classifier" },
    });
    // Mock model has no thinkingLevelMap, so reasoningEffort should not be set
    expect(options.reasoningEffort).toBeUndefined();
  });

  it("passes reasoningEffort mapped value when model declares a thinkingLevelMap.off string", async () => {
    const mockComplete = vi.fn().mockResolvedValue(
      makeToolCallMessage({
        decision: "allow",
        reason: "OK",
        confidence: "high",
        category: "user_intent",
      }),
    );

    const modelWithThinking = makeMockModel();
    (modelWithThinking as any).thinkingLevelMap = { off: "none" };

    const ctx = makeMockCtx(modelWithThinking);
    await classify(DEFAULT_CONFIG, "bash", { command: "ls" }, [], ctx, "auto", {
      complete: mockComplete,
    });

    const options = mockComplete.mock.calls[0][2];
    // reasoningEffort uses the provider-mapped value, not a hardcoded "off"
    expect(options.reasoningEffort).toBe("none");
  });

  it("returns block fallback when model returns completely empty content", async () => {
    const emptyResponse: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "openai-completions",
      provider: "openai",
      model: "gpt-4o",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop" as any,
      timestamp: Date.now(),
    };
    const mockComplete = vi.fn().mockResolvedValue(emptyResponse);

    const ctx = makeMockCtx();
    const result = await classify(DEFAULT_CONFIG, "bash", { command: "ls" }, [], ctx, "auto", {
      complete: mockComplete,
    });

    expect(result.decision).toBe("block");
    expect(result.reason).toContain("empty response");
  });

  it("throws when model returns an error stopReason", async () => {
    const errorMsg: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Error" }],
      api: "openai-completions",
      provider: "openai",
      model: "gpt-4o",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "error",
      errorMessage: "Provider rate limited",
      timestamp: Date.now(),
    };
    const mockComplete = vi.fn().mockResolvedValue(errorMsg);

    const ctx = makeMockCtx();
    await expect(
      classify(DEFAULT_CONFIG, "bash", { command: "ls" }, [], ctx, "auto", {
        complete: mockComplete,
      }),
    ).rejects.toThrow("Provider rate limited");
  });

  it("returns block when no model is available", async () => {
    const ctx = makeMockCtx();
    ctx.model = undefined;
    ctx.modelRegistry.find = vi.fn().mockReturnValue(undefined);

    const result = await classify(
      DEFAULT_CONFIG,
      "bash",
      { command: "ls" },
      [],
      ctx,
      "auto",
    );

    expect(result.decision).toBe("block");
    expect(result.reason).toContain("no model available");
  });
});
