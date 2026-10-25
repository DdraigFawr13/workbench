# Decisions

Decisions for this copy of Workbench, newest first. Each entry has a status, the decision and why.

## 2026-10-25: Read agent window status from the screen, as herdr does

- **Status:** Accepted
- **Decision:** Agent windows show whether their Claude Code session is working, needs input or finished, read in the renderer from each window's xterm (Claude Code's title and the screen text), with patterns adapted from herdr's Claude Code manifest (Apache License 2.0, https://github.com/herdrdev/herdr). herdr itself is not embedded. Hooks are not used. The feature lives in its own folders (`src/renderer/agent-status/`, `src/main/agent-status/`, `src/shared/utils/agent-window-status.ts`, `src/shared/types/agent-status.ts`, the `agentStatus` locale), with one-line registrations elsewhere, per the upstream-divergence decision below.
- **Why:** Morgan asked whether herdr could be added (2026-10-25) and approved the recommendation to copy its status feature rather than embed it: herdr is a separate terminal multiplexer that would duplicate the agent window grid, its Windows support is in beta, and its multi-agent support does not apply because Workbench runs Claude Code only. Hooks were rejected because Claude Code runs sessions in one shared daemon, so the window id a hook reports is unreliable (see `windowOf` in `src/main/live-agent/live-agent-relay.ts`); each xterm belongs to exactly one window. Cost: the screen patterns follow Claude Code's interface and need updating when it changes.

## 2026-10-25: Diverge from upstream for the phone companion

- **Status:** Accepted
- **Decision:** This repository carries features that upstream Workbench (Artyom Vancyan's) does not, starting with the phone companion. Upstream changes are taken in deliberately by merging its releases into `main`; nothing is offered back upstream. To keep those merges small, companion code lives in its own folders (`src/main/companion/`, `src/renderer/companion/`, `src/shared/types/companion.ts`, `src/shared/i18n/locales/en/companion.json`), and shared files change only by registration lines (IPC channels, handler and preload registration, the settings menu entry, the renderer build entry, the CLAUDE.md feature list).
- **Why:** Upstream does not accept pull requests, so features needed here must live in this copy. Changes spread across shared files would conflict with each upstream release; changes confined to new folders and single registration lines do not. Source: audit item 9 of the plan "Workbench mobile companion: plan" (https://claude.ai/artifact/LfWn5jyqq12XLdXEy1pJ9b).
