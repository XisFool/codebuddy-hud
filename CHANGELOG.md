# Changelog

## v0.2.0 - 2026-09-08

Major feature update aligning with CodeBuddy Code v2.146.0 output limits and robust session management.

- **3-Line Layout Alignment**: Aligns with host's strict 3-line statusLine output ceiling by merging recent tool activities and completed counts into Line 3.
- **Session Baseline Handoff**: Resolves `/clear` session resets across transcript file transitions via cwd-scoped handoff state, preventing ghost line-diff and duration leakage.
- **Windows Path & Platform Hardening**: Standardizes Windows path case-normalization (`toLowerCase()`) to eliminate handoff hash fragmentation and cross-drive discrepancies.
- **Transcript Effort Reliability**: Implements bounded head-scan fallback and session effort state caching to prevent `/effort ultracode` from escaping the sliding window in 1MB+ transcripts.
- **Visual & Theme Enhancements**: Distinct gold styling for `ultracode`, vivid magenta for `bypassPermissions`, and accurate effort icon indicators (`● max` vs `⚡ ultracode`).
- **Codebase & Docs Streamlining**: Eliminates orphaned proxy modules and historical audit logs, streamlining the distribution manifest and test coverage.

## v0.1.0 - 2026-09-04

Initial stable release.

- Adds a four-line CodeBuddy Code statusLine HUD with terminal-safe ANSI output.
- Supports themes, context and token usage, cache-hit rate, Git diff, Credits, task state, and recent tool activity.
- Provides cross-platform setup, uninstall, diagnostics, and isolated-install verification.
- Uses immutable GitHub Release tags for stable installation and update discovery.
