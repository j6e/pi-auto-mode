# ADR 0001: Auto Mode Configuration Model

Date: 2026-05-17

## Status

Accepted

## Context

Pi Auto Mode needs configuration for safety policy, classifier behavior, denial thresholds, and tool-tier behavior. The configuration must support both user-wide preferences and project-specific overrides without making autonomous behavior the default by accident.

Recent implementation added provider-compatibility controls for classifier tool choice, plus command-based editing through `/auto-mode config`.

## Decision

Use an `autoMode` block in Pi settings files:

- Global user settings: `~/.pi/agent/settings.json`
- Project settings: `<project>/.pi/settings.json`

Project settings override global settings. Missing or malformed fields fall back to safe defaults.

Supported configuration shape:

```json
{
  "autoMode": {
    "defaultMode": "off",
    "classifier": {
      "model": null,
      "prompt": null,
      "environment": ["$defaults"],
      "hardDeny": ["$defaults"],
      "softDeny": ["$defaults"],
      "allow": ["$defaults"],
      "timeoutMs": 3000,
      "toolMode": "force"
    },
    "denyAndContinue": {
      "maxConsecutiveDenials": 3,
      "maxTotalDenials": 20
    },
    "tools": {
      "alwaysAllow": ["read", "grep", "find", "ls"],
      "allowInProject": ["write", "edit"],
      "alwaysEvaluate": [],
      "alwaysBlock": []
    },
    "protectedPaths": [
      ".git/",
      ".env",
      ".env.",
      ".pi/",
      "node_modules/",
      "~/.bashrc",
      "~/.zshrc",
      "~/.ssh/"
    ]
  }
}
```

`classifier.toolMode` controls how strongly the classifier requests the named classification tool:

- `force`: force the `auto_mode_classifier` tool call; this is the default.
- `required`: require some tool call, without pinning the named tool.
- `auto`: expose the tool but omit `toolChoice`, relying on the prompt/provider.

The `/auto-mode config` command is the supported in-session editing path for project settings. It supports `get`, `set`, `add`, `remove`, `reset`, and `edit` operations.

`/auto-mode status` displays the effective resolved config. When `classifier.prompt` is `null`, status renders it as `"<built-in>"` to make clear that the built-in prompt template is active rather than no prompt being used.

## Rationale

- `off` remains the default to avoid accidental autonomous execution.
- Global + project scopes match Pi settings conventions and allow per-repo policy.
- `$defaults` lets users extend built-in classifier guidance without copying the whole policy.
- `toolMode` avoids provider-specific retry heuristics. Users can choose the strongest compatible tool-calling behavior for their model/provider.
- Tool-tier arrays provide deterministic policy for common cases before paying classifier latency.
- Safe fallbacks make malformed config non-fatal and conservative.

## Consequences

- Users may need to lower `classifier.toolMode` from `force` to `required` or `auto` for providers that reject forced tool calls.
- Project settings can customize policy, so users should review project-local `.pi/settings.json` before trusting a repository.
- Future config additions should preserve the same merge model: global first, project override second, invalid fields ignored in favor of safe defaults.
