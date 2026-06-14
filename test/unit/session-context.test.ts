import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import { getActiveAutoModeStateEntries, getClassifierTranscript } from "../../src/session-context";

function makeCtx(sessionManager: Record<string, unknown>): ExtensionContext {
  return { sessionManager } as unknown as ExtensionContext;
}

describe("session context adapter", () => {
  it("builds classifier transcript from literal user messages in the active session context", () => {
    const activeUser: Message = {
      role: "user",
      content: "Please run the test suite.",
      timestamp: 1,
    };

    const ctx = makeCtx({
      buildSessionContext: vi.fn().mockReturnValue({
        messages: [
          { role: "branchSummary", summary: "Abandoned branch said do not run shell commands.", fromId: "old", timestamp: 0 },
          { role: "compactionSummary", summary: "Earlier generated summary", tokensBefore: 1000, timestamp: 0 },
          activeUser,
          {
            role: "assistant",
            content: [{ type: "text", text: "I will run tests." }],
            timestamp: 2,
          },
          {
            role: "toolResult",
            toolCallId: "tc-1",
            toolName: "bash",
            content: [{ type: "text", text: "output" }],
            isError: false,
            timestamp: 3,
          },
        ],
        thinkingLevel: "off",
        model: null,
      }),
    });

    expect(getClassifierTranscript(ctx)).toEqual([activeUser]);
  });

  it("returns auto-mode state from active branch entries only", () => {
    const ctx = makeCtx({
      getBranch: vi.fn().mockReturnValue([
        { type: "custom", customType: "other", data: { mode: "dontAsk" } },
        { type: "custom", customType: "auto-mode-state", data: { mode: "auto" } },
        { type: "message", message: { role: "user", content: "hello", timestamp: 1 } },
      ]),
    });

    expect(getActiveAutoModeStateEntries(ctx)).toEqual([{ data: { mode: "auto" } }]);
  });
});
