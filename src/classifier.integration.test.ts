import { describe, it, expect, vi } from "vitest";
import { classify } from "./classifier";
import type { ResolvedConfig } from "./types";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model, AssistantMessage, Message } from "@earendil-works/pi-ai";

const BASE_CONFIG: ResolvedConfig = {
  defaultMode: "auto",
  classifier: {
    model: null,
    prompt: null,
    environment: ["Env A", "Env B"],
    hardDeny: ["Hard 1", "Hard 2"],
    softDeny: ["Soft 1"],
    allow: ["Allow 1", "Allow 2"],
    timeoutMs: 3000,
  },
  denyAndContinue: {
    maxConsecutiveDenials: 3,
    maxTotalDenials: 20,
  },
};

function makeCtx(modelOverrides?: Partial<Model<any>>): ExtensionContext {
  const model: Model<any> = {
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 4096,
    ...modelOverrides,
  };
  return {
    cwd: "/project",
    hasUI: true,
    model,
    modelRegistry: {
      find: vi.fn().mockReturnValue(model),
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({
        ok: true,
        apiKey: "test-key",
        headers: { "X-Custom": "header" },
      }),
    },
    ui: {
      setStatus: vi.fn(),
    },
  } as unknown as ExtensionContext;
}

function makeErrorResponse(errorMessage: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
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
    stopReason: "error" as any,
    errorMessage,
    timestamp: Date.now(),
  };
}

function makeToolCallResponse(args: Record<string, unknown>): AssistantMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "tc-classifier",
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

describe("classify integration", () => {
  it("assembles the full context and passes it to complete", async () => {
    const complete = vi.fn().mockResolvedValue(
      makeToolCallResponse({
        decision: "block",
        reason: "Dangerous",
        confidence: "high",
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
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop" as any,
        timestamp: 2,
      },
      { role: "user", content: [{ type: "text", text: "Run tests" }], timestamp: 3 },
    ];

    const ctx = makeCtx();
    await classify(
      BASE_CONFIG,
      "bash",
      { command: "rm -rf /" },
      transcript,
      ctx,
      "auto",
      { complete },
    );

    expect(complete).toHaveBeenCalledTimes(1);
    const [model, context, options] = complete.mock.calls[0];

    // Model resolution
    expect(model).toBe(ctx.model);

    // Prompt construction
    expect(context.systemPrompt).toContain("Env A");
    expect(context.systemPrompt).toContain("Env B");
    expect(context.systemPrompt).toContain("Hard 1");
    expect(context.systemPrompt).toContain("Hard 2");
    expect(context.systemPrompt).toContain("Soft 1");
    expect(context.systemPrompt).toContain("Allow 1");
    expect(context.systemPrompt).toContain("Allow 2");
    expect(context.systemPrompt).toContain("auto_mode_classifier");

    // Messages: only user messages from transcript + pending tool call + instruction
    expect(context.messages.length).toBe(4);
    expect(context.messages.every((m: Message) => m.role === "user")).toBe(true);
    expect(context.messages[0].content[0].text).toBe("Hello");
    expect(context.messages[1].content[0].text).toBe("Run tests");
    expect(context.messages[2].content).toContain("Pending Tool Call");
    expect(context.messages[2].content).toContain("rm -rf /");
    expect(context.messages[3].content).toContain("auto_mode_classifier");

    // Tools
    expect(context.tools.length).toBe(1);
    expect(context.tools[0].name).toBe("auto_mode_classifier");

    // Options
    expect(options.apiKey).toBe("test-key");
    expect(options.headers).toEqual({ "X-Custom": "header" });
    expect(options.toolChoice).toEqual({
      type: "function",
      function: { name: "auto_mode_classifier" },
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.reasoningEffort).toBeUndefined();
  });

  it("uses custom prompt when configured instead of built-in assembly", async () => {
    const complete = vi.fn().mockResolvedValue(
      makeToolCallResponse({
        decision: "allow",
        reason: "OK",
        confidence: "high",
        category: "user_intent",
      }),
    );

    const config: ResolvedConfig = {
      ...BASE_CONFIG,
      classifier: { ...BASE_CONFIG.classifier, prompt: "Custom prompt only" },
    };

    const ctx = makeCtx();
    await classify(config, "bash", { command: "ls" }, [], ctx, "auto", {
      complete,
    });

    const [, context] = complete.mock.calls[0];
    expect(context.systemPrompt).toBe("Custom prompt only");
    expect(context.systemPrompt).not.toContain("Hard 1");
  });

  it("resolves dedicated model from config and passes correct options", async () => {
    const dedicatedModel: Model<any> = {
      id: "gpt-4o",
      name: "GPT-4o",
      api: "openai-completions",
      provider: "openai",
      baseUrl: "https://api.openai.com",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
      thinkingLevelMap: { off: "none" },
    };
    const complete = vi.fn().mockResolvedValue(
      makeToolCallResponse({
        decision: "allow",
        reason: "OK",
        confidence: "high",
        category: "user_intent",
      }),
    );

    const ctx = makeCtx();
    ctx.modelRegistry.find = vi.fn().mockReturnValue(dedicatedModel);

    const config: ResolvedConfig = {
      ...BASE_CONFIG,
      classifier: { ...BASE_CONFIG.classifier, model: "openai/gpt-4o" },
    };

    await classify(config, "bash", { command: "ls" }, [], ctx, "auto", {
      complete,
    });

    expect(ctx.modelRegistry.find).toHaveBeenCalledWith("openai", "gpt-4o");
    expect(complete.mock.calls[0][0]).toBe(dedicatedModel);
    expect(complete.mock.calls[0][2].reasoningEffort).toBe("none");
  });

  it("does not retry when the provider rejects the configured tool choice", async () => {
    const complete = vi.fn().mockResolvedValueOnce(
      makeErrorResponse(
        "400 Error from provider: tool_choice 'specified' is incompatible with thinking enabled",
      ),
    );

    const ctx = makeCtx();
    await expect(
      classify(
        BASE_CONFIG,
        "bash",
        { command: "rm -rf /" },
        [],
        ctx,
        "auto",
        { complete },
      ),
    ).rejects.toThrow("tool_choice");

    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][2].toolChoice).toEqual({
      type: "function",
      function: { name: "auto_mode_classifier" },
    });
  });

  it("aborts the request when the configured timeout fires", async () => {
    const complete = vi.fn().mockImplementation((_model, _context, options) => {
      return new Promise<void>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Should have been aborted")),
          5000,
        );
        options.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("Aborted by signal"));
        });
      });
    });

    const config: ResolvedConfig = {
      ...BASE_CONFIG,
      classifier: { ...BASE_CONFIG.classifier, timeoutMs: 50 },
    };

    const ctx = makeCtx();
    await expect(
      classify(config, "bash", { command: "ls" }, [], ctx, "auto", {
        complete,
      }),
    ).rejects.toThrow("Classifier failed");
  });
});
