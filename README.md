# pi-auto-mode
A Claude auto mode clone for [pi](pi.dev)

## Classifier output contract

The classifier decision path is strict: a valid classifier response must call the `auto_mode_classifier` tool. The tool arguments must include:

- `decision`: `allow` or `block`
- `reason`: string
- `confidence`: `high`, `medium`, or `low`
- `category`: `user_intent`, `security`, `data_loss`, `scope_creep`, `infrastructure`, `credential_access`, or `other`

Plain text JSON, fenced JSON, and reasoning/thinking-block JSON are not accepted as classifier decisions. Malformed or missing tool calls fail closed.
