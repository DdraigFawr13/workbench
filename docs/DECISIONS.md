# Decisions

Decisions for this copy of Workbench, newest first. Each entry has a status, the decision and why.

## 2026-10-25: Phone notifications through Web Push with the web-push package

- **Status:** Accepted
- **Decision:** The phone companion sends notifications with Web Push, through the `web-push` npm package (bundled into the main process). A paired phone switches them on from the board's bell button; the server keeps its VAPID key pair and each phone's subscription in `companion.json`. A phone is notified when a task becomes ready for review, fails its checks, fails, is paused by a rate limit or has its pull request merged, and when an agent window needs input or finishes a turn out of view. Moves made by hand, stopped runs and tasks restored at startup notify nothing. Push works only on the https address from `tailscale serve`; on iPhone it also needs iOS 16.4 or later and the page added to the home screen.
- **Why:** Morgan chose the `web-push` package over a hand-written implementation of the push encryption and over no notifications (2026-10-25), as recommended: it is the standard library for the protocol, and hand-written encryption is more work and more prone to error. Notifications are phase 2 of the plan (audit item 5): knowing when a task needs Morgan is the main value of a phone companion. Payloads are encrypted for the phone (RFC 8291), so the push service (Apple, Google, Mozilla) cannot read them.

## 2026-10-25: Read agent window status from the screen, as herdr does

- **Status:** Accepted
- **Decision:** Agent windows show whether their Claude Code session is working, needs input or finished, read in the renderer from each window's xterm (Claude Code's title and the screen text), with patterns adapted from herdr's Claude Code manifest (Apache License 2.0, https://github.com/herdrdev/herdr). herdr itself is not embedded. Hooks are not used. The feature lives in its own folders (`src/renderer/agent-status/`, `src/main/agent-status/`, `src/shared/utils/agent-window-status.ts`, `src/shared/types/agent-status.ts`, the `agentStatus` locale), with one-line registrations elsewhere, per the upstream-divergence decision below.
- **Why:** Morgan asked whether herdr could be added (2026-10-25) and approved the recommendation to copy its status feature rather than embed it: herdr is a separate terminal multiplexer that would duplicate the agent window grid, its Windows support is in beta, and its multi-agent support does not apply because Workbench runs Claude Code only. Hooks were rejected because Claude Code runs sessions in one shared daemon, so the window id a hook reports is unreliable (see `windowOf` in `src/main/live-agent/live-agent-relay.ts`); each xterm belongs to exactly one window. Cost: the screen patterns follow Claude Code's interface and need updating when it changes.

## 2026-10-25: Diverge from upstream for the phone companion

- **Status:** Accepted
- **Decision:** This repository carries features that upstream Workbench (Artyom Vancyan's) does not, starting with the phone companion. Upstream changes are taken in deliberately by merging its releases into `main`; nothing is offered back upstream. To keep those merges small, companion code lives in its own folders (`src/main/companion/`, `src/renderer/companion/`, `src/shared/types/companion.ts`, `src/shared/i18n/locales/en/companion.json`), and shared files change only by registration lines (IPC channels, handler and preload registration, the settings menu entry, the renderer build entry, the CLAUDE.md feature list).
- **Why:** Upstream does not accept pull requests, so features needed here must live in this copy. Changes spread across shared files would conflict with each upstream release; changes confined to new folders and single registration lines do not. Source: audit item 9 of the plan "Workbench mobile companion: plan" (https://claude.ai/artifact/LfWn5jyqq12XLdXEy1pJ9b).
