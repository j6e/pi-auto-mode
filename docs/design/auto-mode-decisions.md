# Handoff: Pi Auto Mode Extension — Design Decisions

**Date:** 2026-05-16
**Source conversation:** Grilling session on reimplementing Claude Auto Mode permissions for Pi
**Next session focus:** Implementation scaffold and first code

---

## Project

Reimplement Claude Code's Auto Mode permission system as a **Pi extension** (never core).
Repository: `/home/lhankor/repos/pi-auto-mode/`
Research docs: `docs/research/original_spec/` (including `KEY_TAKEAWAYS.md`, `claude_auto_mode_engineering.md`, etc.)

---

## Every Decision & Rationale

### 1. Extension vs. Core Modification
**Decision:** Build as a Pi extension only. Never upstream to core.
**Rationale:** Pi's README explicitly says "build your own confirmation flow with extensions." The `tool_call` event with `block: true` is the designed hook. Extension lets users opt-in, avoids forking Pi, and validates the design before any core lobbying.

### 2. Classifier LLM Source
**Decision:** Configurable classifier model. Default to the user's currently active model (`ctx.model`).
**Rationale:** MVP goal is to prove UX works. Defaulting to active model means zero setup. Later iterations can add a cheaper dedicated model via config (`autoMode.classifier.model`).

### 3. How the Extension Invokes the Classifier
**Decision:** Use `@earendil-works/pi-ai`'s `complete()` function with a `Model` and `Context`.
**Rationale:** `pi-ai` provides `complete(model, context)`, `stream()`, `getModel()`, and `validateToolCall()`. `ctx.model` and `ctx.modelRegistry` expose the active model + API key resolution. No raw `fetch()` needed — we stand on Pi ecosystem primitives.

### 4. Single-Stage vs. Two-Stage Classifier
**Decision:** Single-stage for MVP. Two-stage is on the long-term roadmap.
**Rationale:** Two-stage adds significant complexity (cache management, two prompt templates, two parsers) for marginal gain at non-Anthropic scale. Architect the classifier module so Stage 1 can slot in front later (prompt builder produces base prompt + stage-specific suffix; parser handles both simple and complex outputs).

### 5. Classifier Output Format
**Decision:** Tool calling via `pi-ai`'s TypeBox-based tool definitions.
**Rationale:** Text-based JSON is fragile across models. Tool calling works on every major provider today. `pi-ai` provides `validateToolCall()` for type-safe parsing. The model emits a `toolCall` content block with validated arguments.

### 6. Classifier Tool Schema
**Decision:** Four fields:
- `decision`: `"allow" | "block"`
- `reason`: `string` — concise explanation for the agent (feeds deny-and-continue)
- `confidence`: `"high" | "medium" | "low"`
- `category`: `"user_intent" | "security" | "data_loss" | "scope_creep" | "infrastructure" | "credential_access" | "other"`
**Rationale:** `confidence` enables future threshold tuning (e.g., prompt user if `low` confidence). `category` gives targeted retry hints. No `"uncertain"` — classifier must always make a call; uncertainty is `block` with `low` confidence.

### 7. Permission Modes
**Decision:** Three modes: `off`, `auto`, `dontAsk`. No separate `acceptEdits` mode.
**Rationale:** `acceptEdits` behavior is folded into `auto` (in-project file edits are auto-allowed in auto mode). This matches Claude's actual design. `off` = extension inactive. `auto` = classifier gate. `dontAsk` = deny unless Tier 1/2.

### 8. Mode Toggle UX
**Decision:** `/auto-mode` slash command + `Ctrl+Shift+A` keyboard shortcut.
**Rationale:** Command for discoverability, shortcut for power users. Mode displayed in footer via `ctx.ui.setStatus()`.

### 9. Mode Persistence
**Decision:** Persist mode in session via `pi.appendEntry("auto-mode-state", { mode })`. Restore on `session_start`.
**Rationale:** Survives session restart and `/reload`. Per-session, not global — users may want different modes per project.

### 10. Default Mode Fallback Order
**Decision:** CLI flag (`--auto-mode=auto|dontAsk`) → session state (from `pi.appendEntry`) → `settings.json` (`autoMode.defaultMode`) → `off`.
**Rationale:** CLI flag highest priority for one-off overrides. Session state remembers per-session choice. Settings.json captures user preference. `off` is the safe default.

### 11. Tier 1 (Always Allow)
**Decision:** `read`, `grep`, `find`, `ls` — read-only tools, no state mutation.
**Rationale:** Matches Pi's inherently safe built-ins. These are never blocked, never classified, zero cost.

### 12. Tier 2 (Auto-Allow in `auto` Mode Only)
**Decision:** `write`, `edit` when target is within `ctx.cwd` (the `pwd` Pi was launched from).
**Rationale:** Matches Claude: "Routine coding (editing source files in your repo) doesn't pay classifier latency; in-project edits are reviewable via version control." Paths outside `ctx.cwd` hit the classifier.

### 13. Protected Paths (Never Auto-Approve)
**Decision:** Hardcoded, non-overrideable: `.git/`, `.env`, `.env.*`, `.pi/`, `node_modules/`, shell configs (`~/.bashrc`, `~/.zshrc`), `~/.ssh/`.
**Rationale:** Matches Claude exactly — even `bypassPermissions` mode won't skip `.git`, `.vscode`, etc. These are a safety floor. Users add extra protection via `autoMode.hardDeny` prose in the classifier prompt (or future Tier 3 `deny` rules).

### 14. Tier 3 (User-Configured Rules)
**Decision:** Skip for MVP. On roadmap.
**Rationale:** Deterministic rule engine (`Bash(npm run *)`, gitignore-style path patterns) is significant complexity. The classifier prompt's `hardDeny`/`allow` prose arrays give users full policy control via LLM interpretation. Tier 3 is an optimization we add later to save tokens on common patterns.

### 15. Tier 4 (Classifier)
**Decision:** Everything not Tier 1/2 goes to the classifier in `auto` mode. In `dontAsk`, it's silently denied.
**Rationale:** Shell commands, web fetches, external tools, out-of-project ops have "real downside potential" per Claude's design.

### 16. Prompt Customization Model
**Decision:** Full template override supported (via `autoMode.classifier.prompt` string), but most users customize slots.
**Rationale:** Power users can replace the entire prompt. Default users customize `environment`, `hardDeny`, `softDeny`, `allow` prose arrays which get injected into a default template. If `prompt` is absent, build from slots + default template.

### 17. Prompt Content (Default Template)
**Decision:** Write our own prompt, heavily inspired by Claude's structure.
**Rationale:** Claude's exact template is proprietary. We know the principles: evaluate real-world impact (not surface text), conservative on user intent, block rules first → allow exceptions → user intent → decision.

### 18. Classifier Transcript Context
**Decision:** Only user messages + pending tool call. Strip everything else.
**Rationale:** Matches Claude exactly. This is the primary prompt-injection defense — the classifier never sees tool results where hostile content enters context. It also prevents the agent from "talking the classifier into" a bad decision. System prompt, assistant text, extension custom messages, and tool results are all stripped.

### 19. Deny-and-Continue Pattern
**Decision:** Hybrid approach:
- Return `{ block: true, reason }` from `tool_call` handler (Pi handles generic block)
- Intercept resulting `tool_result` event to inject rich denial message with classifier reasoning + guidance
**Rationale:** Pi's built-in block behavior is too generic. We need the agent to see a structured explanation so it can retry with a safer approach. This matches Claude exactly.

### 20. Denial Thresholds
**Decision:** 3 consecutive denials or 20 total denials → pause and escalate to human prompt. Configurable in settings.
**Rationale:** Matches Claude. Prevents overeager agent from retrying forever. Makes false positives survivable. In `-p` mode, terminate process instead of pausing.

### 21. Threshold Tracking
**Decision:** Track in-memory only. Do not persist across sessions.
**Rationale:** Denial counts are a per-session safety backstop, not a long-term metric. Resetting on new session is correct.

### 22. Classifier Failure Handling
**Decision:** If classifier LLM call fails (timeout, error, rate limit) AND `ctx.hasUI` → prompt user. If no UI (`-p` mode) → fail closed (block the action).
**Rationale:** "Fail closed" is safe. Prompt fallback makes interactive mode usable even when classifier is flaky. Timeout: 2-3 seconds, configurable.

### 23. Non-Interactive Mode (`pi -p`)
**Decision:** `--auto-mode=auto|dontAsk` flag required for any auto mode in `-p`. Without it, mode is forced to `off`.
**Rationale:** Explicit opt-in prevents accidental autonomous execution in CI/headless. Matches Claude: headless mode terminates on threshold breach instead of pausing.

### 24. Extension File Structure
**Decision:** Multi-file TypeScript in `src/`:
```
src/
├── index.ts          # Entry point: wires events
├── config.ts         # Settings loading, defaults, schema validation
├── mode.ts           # Mode state machine, persistence, commands
├── tiers.ts          # Tier 1/2 evaluation, protected paths
├── classifier.ts     # LLM call, prompt building, timeout, parsing
├── decision.ts       # Decision engine: ties tiers + classifier
├── deny-continue.ts  # Tool result interception, thresholds
└── types.ts          # Shared types
```
**Rationale:** Each module is focused and testable. Pi's `jiti` loader handles TypeScript imports. Standard TS layout.

### 25. Distribution / Installation
**Decision:** Target `pi install .` (proper Pi package). Quick test via `pi -e .` (also works per user).
**Rationale:** `package.json` with `"pi": { "extensions": ["./src/index.ts"] }` is the supported mechanism. `pi install .` installs as a proper package with full features (reload, etc.). `pi -e .` for one-off testing.

### 26. UI Feedback
**Decision:**
- Footer: `auto-mode: off` / `auto-mode: auto` / `auto-mode: dontAsk`
- During classifier: `auto-mode: classifying...`
- On block: `ctx.ui.notify("Blocked: [reason]", "warning")`
- On mode switch: `ctx.ui.notify("Auto mode: [mode]", "info")`
**Rationale:** Subtle but informative. Block notifications are critical UX — users need to know auto mode caught something. Otherwise too noisy.

### 27. Configuration Schema (`autoMode` in `.pi/settings.json`)
**Decision:**
```json
{
  "autoMode": {
    "defaultMode": "off | auto | dontAsk",
    "classifier": {
      "model": "provider/id or null (defaults to active)",
      "prompt": "full template override string or null",
      "environment": ["$defaults", "Organization: Acme Corp", ...],
      "hardDeny": ["$defaults", "Never run DB migrations outside CLI", ...],
      "softDeny": ["$defaults", "Never send repo to third-party APIs", ...],
      "allow": ["$defaults", "Deploying to staging is allowed", ...]
    },
    "denyAndContinue": {
      "maxConsecutiveDenials": 3,
      "maxTotalDenials": 20
    }
  }
}
```
**Rationale:** Matches Claude's config shape. `classifier.prompt` overrides everything; absent `prompt` uses default template + slots. `$defaults` inheritance pattern for渐进式配置.

---

## Artifacts to Reference

- **Research:** `docs/research/original_spec/KEY_TAKEAWAYS.md` — consolidated research on Claude Auto Mode + Pi extension API
- **Engineering deep dive:** `docs/research/original_spec/claude_auto_mode_engineering.md` — Anthropic's blog post with full design rationale
- **Pi extensions API:** `docs/research/original_spec/pi_extensions.md` — full event reference, `ExtensionContext`, `ExtensionAPI`
- **Pi settings schema:** `docs/research/original_spec/pi_settings.md`
- **Permission examples:** `docs/research/original_spec/pi_permission_gate_example.ts`, `pi_protected_paths_example.ts`, `pi_confirm_destructive_example.ts`

---

## Suggested Skills for Next Session

- **`tdd`** — Implement using test-driven development (red-green-refactor). The decision engine and classifier have clear inputs/outputs perfect for unit tests.
- **`prototype`** — If any uncertainty remains on the UX (e.g., how deny-and-continue feels in practice), build a quick runnable prototype to test the flow.

---

## Open Implementation Questions

1. Exact TypeBox schema for the classifier tool — write and validate
2. Default classifier prompt template — draft from Claude's principles
3. `config.ts` settings reading — does Pi expose settings to extensions, or do we read `.pi/settings.json` ourselves via `node:fs`?
4. `pi-ai` `complete()` error handling — what exceptions does it throw? Need to wrap in try/catch for timeout/failure logic.
5. How does `pi.appendEntry()` state interact with `session_start` on reload? Test the restore flow.
