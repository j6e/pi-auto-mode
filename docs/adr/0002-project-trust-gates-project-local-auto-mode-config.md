# ADR 0002: Project Trust Gates Project-Local Auto Mode Config

Project-local `autoMode` settings are honored only when Pi reports the project as trusted. This keeps Pi Auto Mode aligned with Pi's existing project trust model: untrusted project `.pi/settings.json` is not part of the effective settings, while trusted project settings may override global settings using normal Pi semantics.

When a project is untrusted, `/auto-mode config` may still write project-local auto-mode settings as a remediation path, but those settings are not reloaded into the effective config until project trust is active. Status and config reads report the active effective config, not ignored project-local settings.
