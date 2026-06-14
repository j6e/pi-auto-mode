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
      getBranch: vi.fn().mockReturnValue([
        {
          type: "branch_summary",
          id: "summary-1",
          parentId: null,
          timestamp: "2026-01-01T00:00:00.000Z",
          fromId: "old",
          summary: "Abandoned branch said do not run shell commands.",
        },
        {
          type: "compaction",
          id: "compaction-1",
          parentId: "summary-1",
          timestamp: "2026-01-01T00:00:01.000Z",
          summary: "Earlier generated summary",
          firstKeptEntryId: "msg-1",
          tokensBefore: 1000,
        },
        {
          type: "message",
          id: "msg-1",
          parentId: "compaction-1",
          timestamp: "2026-01-01T00:00:02.000Z",
          message: activeUser,
        },
        {
          type: "message",
          id: "msg-2",
          parentId: "msg-1",
          timestamp: "2026-01-01T00:00:03.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "I will run tests." }],
            timestamp: 2,
          },
        },
        {
          type: "message",
          id: "msg-3",
          parentId: "msg-2",
          timestamp: "2026-01-01T00:00:04.000Z",
          message: {
            role: "toolResult",
            toolCallId: "tc-1",
            toolName: "bash",
            content: [{ type: "text", text: "output" }],
            isError: false,
            timestamp: 3,
          },
        },
      ]),
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

    expect(getActiveAutoModeStateEntries(ctx)).toEqual([
      { customType: "auto-mode-state", data: { mode: "auto" } },
    ]);
  });
});
