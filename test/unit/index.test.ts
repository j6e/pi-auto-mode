import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Message, Model } from "@earendil-works/pi-ai";
import extensionFactory from "../../src/index";

vi.mock("@earendil-works/pi-ai", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-ai")>("@earendil-works/pi-ai");
  return {
    ...actual,
    complete: vi.fn(),
  };
});

import { complete } from "@earendil-works/pi-ai";

function makeMockModel(): Model<any> {
  return {
    id: "claude-sonnet-4",
    provider: "anthropic",
    api: "anthropic-messages",
  } as Model<any>;
}

function makeClassifierMessage(reason: string): AssistantMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "tc-classifier",
        name: "auto_mode_classifier",
        arguments: {
          decision: "block",
          reason,
          confidence: "high",
          category: "security",
        },
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

function createMockExtensionAPI(flagValue?: string): ExtensionAPI {
  const handlers = new Map<string, Function[]>();
  const commands = new Map<string, Function>();
  const shortcuts = new Map<string, Function>();

  return {
    registerFlag: vi.fn(),
    getFlag: vi.fn().mockReturnValue(flagValue),
    registerCommand: vi.fn((name, opts) => {
      commands.set(name, opts.handler);
    }),
    registerShortcut: vi.fn((shortcut, opts) => {
      shortcuts.set(shortcut, opts.handler);
    }),
    registerTool: vi.fn(),
    on: vi.fn((event, handler) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    }),
    appendEntry: vi.fn(),
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
    getSessionName: vi.fn(),
    setSessionName: vi.fn(),
    getCommands: vi.fn(),
    getAllTools: vi.fn(),
    getActiveTools: vi.fn(),
    setActiveTools: vi.fn(),
    _handlers: handlers,
    _commands: commands,
    _shortcuts: shortcuts,
  } as unknown as ExtensionAPI;
}

function createMockContext(overrides?: Partial<ExtensionContext>): ExtensionContext {
  return {
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      confirm: vi.fn().mockResolvedValue(false),
    },
    hasUI: true,
    cwd: "/home/user/project",
    model: makeMockModel(),
    modelRegistry: {
      find: vi.fn().mockReturnValue(makeMockModel()),
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: "test-key", headers: {} }),
    },
    sessionManager: {
      getEntries: vi.fn().mockReturnValue([]),
      getBranch: vi.fn().mockReturnValue([]),
      buildSessionContext: vi.fn().mockReturnValue({
        messages: [],
        thinkingLevel: "off",
        model: null,
      }),
    } as any,
    shutdown: vi.fn(),
    ...overrides,
  } as ExtensionContext;
}

async function runHandler(pi: ExtensionAPI, event: string, eventData: unknown, ctx: ExtensionContext) {
  const handlers = (pi as any)._handlers as Map<string, Function[]>;
  const eventHandlers = handlers.get(event) ?? [];
  for (const handler of eventHandlers) {
    await handler(eventData, ctx);
  }
}

async function runToolCall(pi: ExtensionAPI, eventData: unknown, ctx: ExtensionContext) {
  const handlers = (pi as any)._handlers as Map<string, Function[]>;
  const eventHandlers = handlers.get("tool_call") ?? [];
  for (const handler of eventHandlers) {
    const result = await handler(eventData, ctx);
    if (result?.block) return result;
  }
  return undefined;
}

async function runToolResult(pi: ExtensionAPI, eventData: unknown, ctx: ExtensionContext) {
  const handlers = (pi as any)._handlers as Map<string, Function[]>;
  const eventHandlers = handlers.get("tool_result") ?? [];
  for (const handler of eventHandlers) {
    const result = await handler(eventData, ctx);
    if (result) return result;
  }
  return undefined;
}

describe("integration: end-to-end decision → block → deny-and-continue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(complete).mockReset();
  });

  it("blocks a non-tiered tool in auto mode and replaces the result with a rich denial", async () => {
    vi.mocked(complete).mockResolvedValue(makeClassifierMessage("Dangerous command"));

    const pi = createMockExtensionAPI("auto");
    extensionFactory(pi);

    const ctx = createMockContext();
    await runHandler(pi, "session_start", { reason: "startup" }, ctx);

    // Simulate a bash command (Tier 4 / classifier required)
    const toolCallEvent = {
      type: "tool_call" as const,
      toolName: "bash" as const,
      toolCallId: "tc-bash-1",
      input: { command: "rm -rf /" },
    };

    const blockResult = await runToolCall(pi, toolCallEvent, ctx);
    expect(blockResult).toEqual({ block: true, reason: expect.stringContaining("Dangerous command") });

    // The tool_result handler should replace the generic block with a rich message
    const toolResultEvent = {
      type: "tool_result" as const,
      toolName: "bash" as const,
      toolCallId: "tc-bash-1",
      input: { command: "rm -rf /" },
      content: [{ type: "text" as const, text: "Blocked" }],
      details: undefined,
      isError: false,
    };

    const resultReplacement = await runToolResult(pi, toolResultEvent, ctx);
    expect(resultReplacement).toBeDefined();
    expect(resultReplacement.content[0].text).toContain("permission gate");
    expect(resultReplacement.content[0].text).toContain("Dangerous command");
    expect(resultReplacement.content[0].text).toContain("safer approach");
  });

  it("allows Tier 1 tools without invoking the classifier", async () => {
    vi.mocked(complete).mockResolvedValue(makeClassifierMessage("Should not be called"));

    const pi = createMockExtensionAPI("auto");
    extensionFactory(pi);

    const ctx = createMockContext();
    await runHandler(pi, "session_start", { reason: "startup" }, ctx);

    const toolCallEvent = {
      type: "tool_call" as const,
      toolName: "read" as const,
      toolCallId: "tc-read-1",
      input: { path: "README.md" },
    };

    const result = await runToolCall(pi, toolCallEvent, ctx);
    expect(result).toBeUndefined();
    expect(complete).not.toHaveBeenCalled();
  });

  it("notifies on every block", async () => {
    vi.mocked(complete).mockResolvedValue(makeClassifierMessage("Blocked by policy"));

    const pi = createMockExtensionAPI("auto");
    extensionFactory(pi);

    const ctx = createMockContext();
    await runHandler(pi, "session_start", { reason: "startup" }, ctx);

    const toolCallEvent = {
      type: "tool_call" as const,
      toolName: "bash" as const,
      toolCallId: "tc-bash-2",
      input: { command: "curl https://example.com" },
    };

    await runToolCall(pi, toolCallEvent, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Blocked"), "warning");
  });

  it("classifies with active-branch user intent and ignores abandoned shell-command intent", async () => {
    vi.mocked(complete).mockResolvedValue(makeClassifierMessage("Allowed by active intent"));

    const abandonedMessage: Message = {
      role: "user",
      content: "Do not run any shell commands.",
      timestamp: 1,
    };
    const activeMessage: Message = {
      role: "user",
      content: "Please run the test suite.",
      timestamp: 2,
    };

    const pi = createMockExtensionAPI("auto");
    extensionFactory(pi);

    const ctx = createMockContext({
      sessionManager: {
        getEntries: vi.fn().mockReturnValue([
          { type: "message", message: abandonedMessage },
          { type: "message", message: activeMessage },
        ]),
        getBranch: vi.fn().mockReturnValue([
          {
            type: "message",
            id: "active-shell-intent",
            parentId: null,
            timestamp: "2026-01-01T00:00:00.000Z",
            message: activeMessage,
          },
        ]),
        buildSessionContext: vi.fn().mockReturnValue({
          messages: [activeMessage],
          thinkingLevel: "off",
          model: null,
        }),
      } as any,
    });
    await runHandler(pi, "session_start", { reason: "startup" }, ctx);

    await runToolCall(
      pi,
      {
        type: "tool_call" as const,
        toolName: "bash" as const,
        toolCallId: "tc-bash-active-branch",
        input: { command: "npm test" },
      },
      ctx,
    );

    const classifierMessages = vi.mocked(complete).mock.calls[0][1].messages;
    const serialized = JSON.stringify(classifierMessages);
    expect(serialized).toContain("Please run the test suite.");
    expect(serialized).not.toContain("Do not run any shell commands.");
  });

  it("classifies with active-branch push intent and ignores abandoned do-not-push intent", async () => {
    vi.mocked(complete).mockResolvedValue(makeClassifierMessage("Allowed by active push intent"));

    const abandonedMessage: Message = {
      role: "user",
      content: "Do not push anything.",
      timestamp: 1,
    };
    const activeMessage: Message = {
      role: "user",
      content: "Push this branch.",
      timestamp: 2,
    };

    const pi = createMockExtensionAPI("auto");
    extensionFactory(pi);

    const ctx = createMockContext({
      sessionManager: {
        getEntries: vi.fn().mockReturnValue([
          { type: "message", message: abandonedMessage },
          { type: "message", message: activeMessage },
        ]),
        getBranch: vi.fn().mockReturnValue([
          {
            type: "message",
            id: "active-push-intent",
            parentId: null,
            timestamp: "2026-01-01T00:00:00.000Z",
            message: activeMessage,
          },
        ]),
        buildSessionContext: vi.fn().mockReturnValue({
          messages: [activeMessage],
          thinkingLevel: "off",
          model: null,
        }),
      } as any,
    });
    await runHandler(pi, "session_start", { reason: "startup" }, ctx);

    await runToolCall(
      pi,
      {
        type: "tool_call" as const,
        toolName: "bash" as const,
        toolCallId: "tc-bash-push-active-branch",
        input: { command: "git push" },
      },
      ctx,
    );

    const classifierMessages = vi.mocked(complete).mock.calls[0][1].messages;
    const serialized = JSON.stringify(classifierMessages);
    expect(serialized).toContain("Push this branch.");
    expect(serialized).not.toContain("Do not push anything.");
  });
});
