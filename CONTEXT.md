# Pi Auto Mode

Pi Auto Mode is a permission-gating extension that decides whether coding-agent tool calls should run automatically, be blocked, or fall back to human approval.

## Language

**Active Session Branch**:
The path of session entries from the current leaf back to the root; it is the conversation history the user is currently continuing from.
_Avoid_: entire session file, all entries, abandoned branches

**Classifier Transcript**:
The permission-classifier view of the active conversation, reduced to user-authored intent plus the pending tool call.
_Avoid_: full transcript, raw session entries, assistant rationale

**Auto Mode State**:
The persisted per-session permission mode selected for Pi Auto Mode.
_Avoid_: global default, settings default, permission rule

**Project Trust**:
Pi's decision that project-local settings and resources may be loaded for the current project context.
_Avoid_: repository safety, sandbox, permission approval

**Project-Local Auto Mode Config**:
The `autoMode` settings read from a trusted project's `.pi/settings.json`.
_Avoid_: untrusted repo policy, global auto-mode config, session state

**Session Context Adapter**:
The single permission-critical interface for reading active-branch conversation context and auto-mode state from a Pi session.
_Avoid_: raw session scan, ad hoc session parsing
