# Key Takeaways: Cloning Claude's Auto Mode for Pi

> **Research date:** 2026-05-16
> **Goal:** Build an "auto mode" permission system for Pi (the coding agent harness) inspired by Claude Code's auto mode.

---

## 1. Pi Currently Has NO Built-in Permission System

From Pi's README / Philosophy section:

> **"No permission popups. Run in a container, or build your own confirmation flow with extensions inline with your environment and security requirements."**

- Pi delegates all permission/confirmation behavior to **extensions**.
- The extension hook point is the **`tool_call` event**, which can **`block: true`** with a reason.
- This is the *correct* extension point for building auto mode — Pi's architecture is already designed for this.

---

## 2. Claude's Auto Mode is a Classifier-Based Gate (Not Rule-Based)

Claude Code uses a **separate LLM classifier** (Sonnet 4.6) to evaluate each tool call before execution. It is NOT a static rule engine.

### The Three-Tier Decision Flow (Claude)

```
Tool Call
    |
    v
Tier 1: Static allowlist
        - Read-only ops (file reads, grep, etc.) → AUTO-APPROVE
        - In-project file edits (working directory) → AUTO-APPROVE
        - Protected paths (.git, .vscode, etc.) → never auto-approve
    |
    v
Tier 2: User-configured permission rules
        - permissions.allow → AUTO-APPROVE
        - permissions.deny → BLOCK (deny beats allow)
        - permissions.ask → PROMPT
    |
    v
Tier 3: Transcript classifier (LLM)
        - Evaluates action against user intent
        - Blocks overeager behavior, honest mistakes, injection-driven actions
        - Allowed → execute
        - Blocked → return as tool result with reason, agent retries alternative
```

**Key insight:** Most routine actions (reads, local edits) skip the classifier entirely. Only shell commands, web fetches, external tools, and out-of-project ops reach Tier 3. This keeps latency/cost low.

---

## 3. Critical Design Decisions from Anthropic's Engineering Deep Dive

### 3.1 Strip Assistant Text & Tool Results from Classifier Input

- The classifier sees **only user messages + pending tool calls**.
- Assistant prose and tool outputs are stripped.
- **Why:** Prevents the agent from "talking the classifier into" a bad decision. Also the primary prompt-injection defense.
- **Tradeoff:** Loses provenance (can't tell if agent fabricated a target vs. read it from a file). Acceptable cost.

### 3.2 Two-Stage Classification (Efficiency + Recall)

```
Stage 1: Fast single-token filter (yes/no)
        - "Err on the side of blocking"
        - Tuned for low false-negative rate (catches dangerous actions)
        - Cost: 8.5% false-positive rate (benign actions blocked)
        - Most actions clear here → execute immediately

Stage 2: Chain-of-thought reasoning (only on Stage 1 flags)
        - Same prompt, only final instruction changes
        - Reduces false positives: 8.5% → 0.4%
        - Slightly higher false-negative rate vs Stage 1 alone
        - Almost entirely cache-hit from Stage 1
```

**Performance (Anthropic internal eval):**

| Dataset | Stage 1 FPR / FNR | Full Pipeline FPR / FNR |
|---------|-------------------|------------------------|
| Real traffic (n=10,000) | 8.5% / — | **0.4%** / — |
| Real overeager (n=52) | — / 6.6% | — / **17%** |
| Synthetic exfil (n=1,000) | — / 1.8% | — / **5.7%** |

### 3.3 Prompt-Injection Probe (Input Layer)

- Separate server-side probe scans tool outputs before they enter agent context.
- Flags suspicious content → injects warning telling agent to re-anchor on user intent.
- Two layers compound: injection must evade probe AND steer agent into action that classifier allows.

### 3.4 Multi-Agent Handoffs

Classifier runs at **both ends** of subagent delegation:
- **Outbound:** Checks if delegated task was originally user-intended (prevents agent from spawning dangerous subtasks).
- **Return:** Reviews subagent's full action history; if flagged, prepends security warning to results.

### 3.5 Deny-and-Continue (Critical UX Pattern)

- When classifier blocks: action returns as **tool result** with reason + instruction to find safer path.
- Agent retries with alternative approach.
- **Fallback thresholds:** 3 consecutive denials OR 20 total denials → pause auto mode, escalate to human prompt.
- In headless mode (`-p`): terminate process instead.
- This makes false positives survivable — a 0.4% FPR would kill long tasks if every block halted execution.

---

## 4. What the Classifier Blocks vs. Allows (Default Rules)

### Blocked by default:
- `curl | bash` (downloading & executing code)
- Sending sensitive data to external endpoints
- Production deploys and migrations
- Mass deletion on cloud storage
- Granting IAM or repo permissions
- Modifying shared infrastructure
- Irreversibly destroying files that existed before session
- Force push, pushing directly to `main`
- Installing persistence (SSH keys, cronjobs)
- Disabling logging / safety checks
- Running code cloned from external repos

### Allowed by default:
- Local file operations in working directory
- Installing dependencies from lock files / manifests
- Reading `.env` and sending credentials to matching API
- Read-only HTTP requests
- Pushing to session's working branch

### Conversation Boundaries:
- If user says "don't push" or "wait until I review" → classifier blocks matching actions even if defaults would allow.
- Boundaries are re-read from transcript each time (not stored as rules).
- Can be lost during context compaction.

---

## 5. Pi Extension API: What We Have to Work With

### The `tool_call` Event (Primary Hook)

```typescript
pi.on("tool_call", async (event, ctx) => {
  // event.toolName: "bash" | "read" | "write" | "edit" | "grep" | "find" | "ls" | custom
  // event.toolCallId: string
  // event.input: tool parameters (MUTABLE — can patch before execution)
  //
  // Return { block: true, reason: string } to block
  // Return undefined to allow
});
```

### UI Interaction (for Prompts)

```typescript
ctx.ui.confirm(title, message, { timeout?: number }) → Promise<boolean>
ctx.ui.select(title, options, { timeout?: number }) → Promise<string | null>
ctx.ui.notify(message, "info" | "success" | "warning" | "error")
ctx.ui.setStatus(key, text)        // Footer status line
```

### Session Access (for Transcript)

```typescript
ctx.sessionManager.getEntries()     // All entries (messages, tool calls, results)
ctx.sessionManager.getBranch()      // Current branch
ctx.sessionManager.getLeafId()      // Current leaf
```

### Messaging (for Deny-and-Continue)

```typescript
pi.sendUserMessage(text, { deliverAs: "steer" | "followUp" })
pi.sendMessage({ customType, content, display: true })
```

### State Persistence

```typescript
pi.appendEntry("auto-mode-state", { ... })
// Restore on session_start by scanning ctx.sessionManager.getEntries()
```

### Read-Only Commands (Already Free in Pi)

Pi's built-in tools that are inherently safe:
- `read`, `grep`, `find`, `ls` — no state mutation
- These would be Tier 1 auto-approve in our system

---

## 6. Permission Rule Syntax (From Claude — Adaptable)

Claude uses `Tool(specifier)` format:

| Rule | Effect |
|------|--------|
| `Bash` | All bash commands |
| `Bash(npm run *)` | Commands starting with `npm run` |
| `Read(./.env)` | Read `.env` in cwd |
| `Edit(/src/**/*.ts)` | Edit TS files in project src |
| `WebFetch(domain:github.com)` | Fetch from github.com |

Rules evaluated: **deny → ask → allow** (first match wins).

**Pi currently has no settings for this.** We'd need to add to `.pi/settings.json` or a dedicated config file.

---

## 7. Auto Mode Configuration (Claude's `autoMode` Settings)

Claude uses prose-based natural language rules (not regex):

```json
{
  "autoMode": {
    "environment": [
      "$defaults",
      "Organization: Acme Corp",
      "Source control: github.com/acme-corp",
      "Trusted cloud buckets: s3://acme-builds"
    ],
    "allow": [
      "$defaults",
      "Deploying to staging is allowed"
    ],
    "soft_deny": [
      "$defaults",
      "Never run DB migrations outside the migrations CLI"
    ],
    "hard_deny": [
      "$defaults",
      "Never send repo contents to third-party code review APIs"
    ]
  }
}
```

Precedence inside classifier:
1. `hard_deny` → unconditional block
2. `soft_deny` → blocked unless user explicitly authorized
3. `allow` → overrides matching `soft_deny`
4. Explicit user intent → overrides remaining soft blocks

---

## 8. Existing Pi Permission Extension Examples

### `permission-gate.ts`
- Regex-based blocking of `rm -rf`, `sudo`, `chmod 777`
- Prompts user via `ctx.ui.select()` when UI available
- Blocks by default in non-interactive mode (`-p`)

### `protected-paths.ts`
- Blocks `write`/`edit` to `.env`, `.git/`, `node_modules/`
- No prompt — unconditional block with `ctx.ui.notify()`

### `confirm-destructive.ts`
- Cancels `session_before_switch` and `session_before_fork` events
- Pattern for "before" event interception

---

## 9. Recommended Architecture for Pi Auto Mode Extension

Based on the research, a Pi auto-mode extension should implement:

### Core Components:

1. **Permission Mode State Machine**
   - Modes: `default` (prompt), `auto` (classifier), `acceptEdits` (auto-approve local edits), `dontAsk` (deny unless allowed)
   - Toggle via `/auto-mode` command or keyboard shortcut
   - Persist mode in session via `pi.appendEntry()`

2. **Tiered Decision Engine** (in `tool_call` handler)
   - Tier 1: Read-only tools (`read`, `grep`, `find`, `ls`) → allow
   - Tier 2: In-project file edits → allow in `acceptEdits`/`auto` mode
   - Tier 3: User-configured allow/deny rules → match and decide
   - Tier 4: LLM classifier → for everything else in `auto` mode
   - Fallback: Prompt user (in `default` mode or classifier uncertain)

3. **LLM Classifier**
   - Send transcript subset (user messages + pending tool call) to LLM
   - Two-stage optional: fast cheap model for filter, better model for reasoning
   - Or single-call with a structured prompt
   - Must strip tool results and assistant messages from context

4. **Deny-and-Continue**
   - Return blocked action as tool result with explanation
   - Use `pi.sendUserMessage()` to steer agent toward safer path
   - Track denial counts; escalate to prompt after thresholds

5. **Configuration**
   - Read from `.pi/settings.json` under an `autoMode` key
   - Support `environment`, `allow`, `soft_deny`, `hard_deny` as prose arrays
   - Support `$defaults` inheritance pattern

6. **Protected Paths**
   - Hard-coded list: `.git/`, `.env`, shell configs, `.pi/`
   - Never auto-approve writes to these

7. **Non-Interactive Safety**
   - In `pi -p` (print mode), auto mode should either:
     - Fall back to `dontAsk` mode (deny unless explicitly allowed)
     - Or require explicit `--auto-mode` flag with warning

---

## 10. Open Questions / Design Decisions to Make

1. **Which model for the classifier?** Use the same model as the active agent (costly) or a cheaper model? Claude uses a fixed server-side model.
2. **Single-stage or two-stage?** Two-stage is more efficient but complex. Single-stage with good prompt engineering may suffice for Pi's use case.
3. **How to handle cost?** Each tool call in auto mode costs extra tokens. Should there be a token budget or rate limit?
4. **Should deny rules be in settings.json or AGENTS.md?** Claude uses both. AGENTS.md is already loaded by Pi.
5. **Prompt injection defense?** Pi has no server-side probe. The extension would need to rely on the classifier's reasoning-blind design (stripping tool results).
6. **Subagent support?** Pi has no built-in subagents. Less relevant unless user installs a subagent extension.
7. **Should we cache classifier decisions?** Same command pattern in same session → skip classifier?

---

## Source Files

All original documentation saved to `docs/research/original_spec/`:

- `claude_permissions.md` — Full permission system reference
- `claude_permission_modes.md` — Mode descriptions and switching
- `claude_auto_mode_blog.md` — Announcement post
- `claude_auto_mode_config.md` — Configuration reference
- `claude_auto_mode_engineering.md` — Engineering deep dive (most valuable)
- `pi_readme.md` — Pi README with philosophy
- `pi_extensions.md` — Full extension API documentation
- `pi_settings.md` — Pi settings schema
- `pi_permission_gate_example.ts` — Permission gate extension
- `pi_protected_paths_example.ts` — Protected paths extension
- `pi_confirm_destructive_example.ts` — Confirm destructive actions extension
