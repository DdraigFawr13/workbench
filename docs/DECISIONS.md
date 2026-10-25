# Decisions

Decisions for this copy of Workbench, newest first. Each entry has a status, the decision and why.

## 2026-10-25: Diverge from upstream for the phone companion

- **Status:** Accepted
- **Decision:** This repository carries features that upstream Workbench (Artyom Vancyan's) does not, starting with the phone companion. Upstream changes are taken in deliberately by merging its releases into `main`; nothing is offered back upstream. To keep those merges small, companion code lives in its own folders (`src/main/companion/`, `src/renderer/companion/`, `src/shared/types/companion.ts`, `src/shared/i18n/locales/en/companion.json`), and shared files change only by registration lines (IPC channels, handler and preload registration, the settings menu entry, the renderer build entry, the CLAUDE.md feature list).
- **Why:** Upstream does not accept pull requests, so features needed here must live in this copy. Changes spread across shared files would conflict with each upstream release; changes confined to new folders and single registration lines do not. Source: audit item 9 of the plan "Workbench mobile companion: plan" (https://claude.ai/artifact/LfWn5jyqq12XLdXEy1pJ9b).
