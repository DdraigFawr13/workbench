import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronDown, ExternalLink, Loader2, Plus, RefreshCw } from 'lucide-react';
import { TASK_STATUS_COLUMNS, getTaskColumn, type TaskStatusColumn } from '../../shared/constants/task';
import type { TaskStatus } from '../../shared/types/task';
import { formatDateTime } from '../../shared/utils/format-date-time';
import { Button } from '../components/ui/button';
import { MarkdownContent } from '../components/ui/markdown-content';
import { cn } from '../lib/utils';
import { AgentStatusIndicator } from '../agent-status/AgentStatusIndicator';
import {
  api,
  forgetToken,
  getToken,
  pair,
  UnauthorizedError,
  type CompanionProject,
  type LogEntry,
  type TaskSummary,
} from './api';

/** How often an open screen refreshes while the page is visible */
const BOARD_REFRESH_MS = 5000;
/** A task's details run git commands for its worktree on the computer, so they refresh less often */
const TASK_REFRESH_MS = 10000;
const PROJECT_KEY = 'workbench.companion.project';

type View =
  | { kind: 'projects' }
  | { kind: 'board'; project: CompanionProject }
  | { kind: 'task'; project: CompanionProject; taskId: string }
  | { kind: 'create'; project: CompanionProject };

const columnOf = (task: TaskSummary): TaskStatusColumn => getTaskColumn(task.status as TaskStatus);

/** Run `load` now and every `intervalMs` while the page is visible */
function useRefresh<T>(load: () => Promise<T>, onUnauthorized: () => void, intervalMs = BOARD_REFRESH_MS): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(() => {
    loadRef.current().then(
      (result) => {
        setData(result);
        setError(null);
      },
      (err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized();
        else setError(err instanceof Error ? err.message : String(err));
      }
    );
  }, [onUnauthorized]);

  useEffect(() => {
    reload();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, intervalMs);
    document.addEventListener('visibilitychange', reload);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', reload);
    };
  }, [reload, intervalMs]);

  return { data, error, reload };
}

export function CompanionApp() {
  const [paired, setPaired] = useState(() => getToken() !== null);
  const [view, setView] = useState<View>({ kind: 'projects' });

  const signOut = useCallback(() => {
    forgetToken();
    setPaired(false);
  }, []);

  if (!paired) return <PairScreen onPaired={() => setPaired(true)} />;

  switch (view.kind) {
    case 'projects':
      return <ProjectsScreen onOpen={(project) => setView({ kind: 'board', project })} onUnauthorized={signOut} />;
    case 'board':
      return (
        <BoardScreen
          project={view.project}
          onProjects={() => setView({ kind: 'projects' })}
          onOpenTask={(taskId) => setView({ kind: 'task', project: view.project, taskId })}
          onCreate={() => setView({ kind: 'create', project: view.project })}
          onUnauthorized={signOut}
        />
      );
    case 'task':
      return <TaskScreen project={view.project} taskId={view.taskId} onBack={() => setView({ kind: 'board', project: view.project })} onUnauthorized={signOut} />;
    case 'create':
      return (
        <CreateScreen
          project={view.project}
          onDone={(taskId) => setView(taskId ? { kind: 'task', project: view.project, taskId } : { kind: 'board', project: view.project })}
        />
      );
  }
}

// =============================================================================
// Layout
// =============================================================================

function Screen({ title, onBack, action, children }: { title: string; onBack?: () => void; action?: React.ReactNode; children: React.ReactNode }) {
  const { t } = useTranslation('companion');
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        {onBack && (
          <button type="button" onClick={onBack} aria-label={t('page.back')} className="-ml-2 p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        {/* herdr's top bar: the app's name in the accent colour, then where the user is */}
        <span aria-hidden="true" className="text-sm text-primary">workbench</span>
        <span aria-hidden="true" className="text-sm text-muted-foreground">/</span>
        <h1 className="min-w-0 flex-1 truncate text-sm">{title}</h1>
        {action}
      </header>
      <main className="flex-1 px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">{children}</main>
    </div>
  );
}

/** A bordered pane with its title in muted lower case, as herdr draws its panes */
function Pane({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn('border border-border bg-card', className)}>
      {title && <h2 className="border-b border-border px-3 py-1.5 text-xs lowercase text-[var(--pane-title)]">{title}</h2>}
      {children}
    </section>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="border border-border border-l-2 border-l-primary bg-card px-3 py-2 text-sm text-foreground">{children}</div>;
}

function Loading() {
  return (
    <div className="flex justify-center py-10">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

// =============================================================================
// Pairing
// =============================================================================

function PairScreen({ onPaired }: { onPaired: () => void }) {
  const { t } = useTranslation('companion');
  const [code, setCode] = useState('');
  const [name, setName] = useState(() => (/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android phone' : 'Phone'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await pair(code, name);
      onPaired();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('page.pair.title')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t('page.pair.instructions')}</p>
        <p className="text-sm text-muted-foreground">{t('page.pair.homeScreen')}</p>
        <label className="flex flex-col gap-1.5 text-xs lowercase text-[var(--pane-title)]">
          {t('page.pair.code')}
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoCapitalize="characters"
            autoComplete="one-time-code"
            spellCheck={false}
            className="h-12 border px-3 text-lg tracking-widest text-foreground uppercase"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs lowercase text-[var(--pane-title)]">
          {t('page.pair.deviceName')}
          <input value={name} onChange={(event) => setName(event.target.value)} className="h-11 border px-3 text-sm normal-case text-foreground" />
        </label>
        {error && <Notice>{error}</Notice>}
        <Button type="submit" size="lg" disabled={busy || code.trim().length < 8}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('page.pair.submit')}
        </Button>
      </form>
    </Screen>
  );
}

// =============================================================================
// Projects and board
// =============================================================================

function ProjectsScreen({ onOpen, onUnauthorized }: { onOpen: (project: CompanionProject) => void; onUnauthorized: () => void }) {
  const { t } = useTranslation('companion');
  const { data, error } = useRefresh(api.projects, onUnauthorized);
  const opened = useRef(false);

  // Return to the last project, or open the only one
  useEffect(() => {
    if (!data || opened.current) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem(PROJECT_KEY);
    } catch {
      last = null;
    }
    const target = data.find((project) => project.id === last) ?? (data.length === 1 ? data[0] : undefined);
    if (target) {
      opened.current = true;
      onOpen(target);
    }
  }, [data, onOpen]);

  return (
    <Screen title={t('page.projects.title')}>
      {error && <Notice>{error}</Notice>}
      {!data && !error && <Loading />}
      {data?.length === 0 && <Notice>{t('page.projects.none')}</Notice>}
      {data && data.length > 0 && (
        <Pane title={t('page.projects.title')}>
          <ul className="flex flex-col divide-y divide-border">
            {data.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  onClick={() => {
                    opened.current = true;
                    onOpen(project);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-3 text-left text-sm hover:bg-accent"
                >
                  <span aria-hidden="true" className="text-primary">›</span>
                  {project.name}
                </button>
              </li>
            ))}
          </ul>
        </Pane>
      )}
    </Screen>
  );
}

function BoardScreen({
  project,
  onProjects,
  onOpenTask,
  onCreate,
  onUnauthorized,
}: {
  project: CompanionProject;
  onProjects: () => void;
  onOpenTask: (taskId: string) => void;
  onCreate: () => void;
  onUnauthorized: () => void;
}) {
  const { t } = useTranslation(['companion', 'tasks']);
  const load = useCallback(() => api.tasks(project.id), [project.id]);
  const { data, error, reload } = useRefresh(load, onUnauthorized);
  const loadAgents = useCallback(() => api.agents(project.id), [project.id]);
  const { data: agents, reload: reloadAgents } = useRefresh(loadAgents, onUnauthorized);
  const shownAgents = (agents ?? []).filter((agent) => agent.status !== 'idle');
  const [column, setColumn] = useState<TaskStatusColumn | null>(null);
  const shownChip = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(PROJECT_KEY, project.id);
    } catch {
      // Storage blocked: the project list opens next time
    }
  }, [project.id]);

  const counts = useMemo(() => {
    const result = Object.fromEntries(TASK_STATUS_COLUMNS.map((c) => [c, 0])) as Record<TaskStatusColumn, number>;
    for (const task of data ?? []) result[columnOf(task)] += 1;
    return result;
  }, [data]);

  // Open on the column that most likely needs the user: Human Review, then In Progress
  const shown: TaskStatusColumn = column ?? (counts.human_review > 0 ? 'human_review' : counts.in_progress > 0 ? 'in_progress' : 'backlog');
  // The column bar scrolls sideways; keep the shown column (Human Review is fifth) in view
  useEffect(() => {
    shownChip.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [shown]);

  const tasks = (data ?? []).filter((task) => columnOf(task) === shown).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  return (
    <Screen
      title={project.name}
      action={
        <>
          <button type="button" onClick={() => { reload(); reloadAgents(); }} aria-label={t('companion:page.refresh')} className="p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button type="button" onClick={onProjects} aria-label={t('companion:page.projects.switch')} className="-mr-2 p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
            <ChevronDown className="h-4 w-4" />
          </button>
        </>
      }
    >
      {shownAgents.length > 0 && (
        <Pane title={t('companion:page.agents.title')} className="mb-3">
          {/* herdr's agent list: the window's title, then its state */}
          <ul className="flex flex-col divide-y divide-border">
            {shownAgents.map((agent) => (
              <li key={agent.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{agent.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(agent.since)}</div>
                </div>
                <AgentStatusIndicator status={agent.status} />
              </li>
            ))}
          </ul>
        </Pane>
      )}

      <section className="border border-border bg-card" aria-label={t(`tasks:columns.${shown}`)}>
        {/* The board's columns as herdr's tab bar: the shown one in the accent colour, underlined */}
        <div className="flex overflow-x-auto border-b border-border">
          {TASK_STATUS_COLUMNS.map((c) => (
            <button
              key={c}
              ref={c === shown ? shownChip : undefined}
              type="button"
              onClick={() => setColumn(c)}
              aria-pressed={c === shown}
              className={cn(
                'shrink-0 border-b-2 px-3 py-2 text-xs lowercase',
                c === shown ? 'border-primary bg-accent text-primary' : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {t(`tasks:columns.${c}`)} <span className={c === shown ? 'text-primary' : 'text-[var(--pane-title)]'}>{counts[c]}</span>
            </button>
          ))}
        </div>

        {error && <div className="p-3"><Notice>{error}</Notice></div>}
        {!data && !error && <Loading />}
        {data && tasks.length === 0 && <p className="px-3 py-6 text-center text-xs lowercase text-muted-foreground">{t('companion:page.board.empty')}</p>}

        <ul className="flex flex-col divide-y divide-border">
          {tasks.map((task) => (
            <li key={task.id}>
              <button type="button" onClick={() => onOpenTask(task.id)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-accent">
                <TaskDot task={task} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{task.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {[statusText(t, task), formatDateTime(task.updatedAt)].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {/* Room for the New task button, so it never covers the last task */}
      <div className="h-20" />

      <Button size="lg" className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 gap-2 bg-card" onClick={onCreate}>
        <Plus className="h-4 w-4" />
        {t('companion:page.board.newTask')}
      </Button>
    </Screen>
  );
}

/**
 * A task's state as a herdr dot: yellow while Claude Code works on it, red when it failed, teal
 * while it waits for the user's review, green when done, hollow while it waits to start
 */
function TaskDot({ task }: { task: TaskSummary }) {
  const column = columnOf(task);
  const dot =
    task.status === 'error' ? 'text-destructive'
      : column === 'in_progress' || column === 'ai_review' ? 'text-warning animate-pulse'
        : column === 'human_review' ? 'text-info'
          : column === 'done' ? 'text-success'
            : 'text-muted-foreground';
  const hollow = column === 'backlog' || column === 'queue';
  return (
    <span aria-hidden="true" className={cn('mt-0.5 text-xs leading-5', dot)}>
      {hollow ? '○' : '●'}
    </span>
  );
}

/** Status words beyond the column: PR, failure, why it waits for review */
function statusText(t: (key: string) => string, task: TaskSummary): string {
  if (task.prUrl) return t(`companion:page.pr.${task.prState ?? 'open'}`);
  if (task.status === 'error') return t('tasks:columns.error');
  if (task.reviewReason) return t(`companion:page.reviewReason.${task.reviewReason}`);
  return '';
}

// =============================================================================
// Task
// =============================================================================

function TaskScreen({ project, taskId, onBack, onUnauthorized }: { project: CompanionProject; taskId: string; onBack: () => void; onUnauthorized: () => void }) {
  const { t } = useTranslation(['companion', 'tasks']);
  const load = useCallback(() => api.task(project.id, taskId), [project.id, taskId]);
  const { data: task, error, reload } = useRefresh(load, onUnauthorized, TASK_REFRESH_MS);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [showLogs, setShowLogs] = useState(false);

  const run = async (action: string, args: Record<string, unknown> = {}, done?: string) => {
    setBusy(action);
    setActionError(null);
    setActionResult(null);
    try {
      await api.action(project.id, action, { taskId, ...args });
      if (done) setActionResult(done);
      reload();
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized();
      else setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const prActionRunning = task?.phoneAction?.state === 'running';

  const actionButton = (action: string, label: string, args?: Record<string, unknown>, done?: string) => (
    <Button key={action + JSON.stringify(args ?? {})} variant="outline" size="lg" disabled={busy !== null || prActionRunning} onClick={() => void run(action, args, done)}>
      {busy === action ? <Loader2 className="h-4 w-4 animate-spin" /> : label}
    </Button>
  );

  if (!task) {
    return (
      <Screen title={t('companion:page.task.title')} onBack={onBack}>
        {error ? <Notice>{error}</Notice> : <Loading />}
      </Screen>
    );
  }

  const column = columnOf(task);
  const running = task.status === 'in_progress' || task.status === 'ai_review';
  const inReview = column === 'human_review';
  const validation = task.run?.validation;
  const phoneAction = task.phoneAction;

  return (
    <Screen title={task.title} onBack={onBack}>
      <div className="flex flex-col gap-3">
        {/* herdr's status line: the task's dot and column, then what else is known */}
        <div className="flex items-start gap-2 border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <TaskDot task={task} />
          <span className="leading-5">
            {[t(`tasks:columns.${column}`), statusText(t, task), task.worktree && t('companion:page.task.diff', task.worktree)].filter(Boolean).join(' · ')}
          </span>
        </div>

        {/* Actions the board allows from this column */}
        <section className="flex flex-col gap-2">
          {actionError && <Notice>{actionError}</Notice>}
          {actionResult && !phoneAction && <Notice>{actionResult}</Notice>}
          {phoneAction && (
            <Notice>
              {prActionRunning ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t(`companion:page.actions.running.${phoneAction.action}`)}
                </span>
              ) : (
                t(`companion:page.actions.failed.${phoneAction.action}`, { error: phoneAction.error })
              )}
            </Notice>
          )}
          {running && actionButton('stop_task', t('companion:page.actions.stop'))}
          {!running && task.allowedMoves.includes('in_progress') && actionButton('start_task', inReview ? t('companion:page.actions.resume') : t('companion:page.actions.start'))}
          {task.status === 'error' && actionButton('retry_task', t('companion:page.actions.retry'))}
          {inReview && !task.prUrl && task.worktree && !prActionRunning && actionButton('create_pull_request', t('companion:page.actions.createPr'), {}, t('companion:page.actions.prCreated'))}
          {task.prUrl && task.prState !== 'merged' && task.prState !== 'closed' && !prActionRunning && actionButton('merge_pull_request', t('companion:page.actions.mergePr'), {}, t('companion:page.actions.merged'))}
          {task.prUrl && (
            <a href={task.prUrl} target="_blank" rel="noopener noreferrer" className="flex h-12 items-center justify-center gap-2 border border-border text-sm lowercase hover:bg-accent">
              {t('companion:page.actions.openPr')}
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          {task.allowedMoves.filter((move) => move !== 'in_progress').map((move) =>
            actionButton('move_task', t('companion:page.actions.moveTo', { column: t(`tasks:columns.${move}`) }), {
              to: move,
              // A task moved to Done from the phone keeps its worktree; delete it on the desktop
              ...(move === 'done' ? { worktree: 'keep' } : {}),
            })
          )}
        </section>

        {inReview && task.status !== 'pr_created' && (
          <Pane title={t('companion:page.task.requestChanges')}>
            <div className="flex flex-col gap-2 p-3">
              <textarea
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                rows={4}
                placeholder={t('companion:page.task.feedbackPlaceholder')}
                className="border px-3 py-2 text-sm"
              />
              <Button
                size="lg"
                disabled={busy !== null || prActionRunning || !feedback.trim()}
                onClick={() => void run('request_changes', { feedback }, t('companion:page.actions.revising')).then(() => setFeedback(''))}
              >
                {busy === 'request_changes' ? <Loader2 className="h-4 w-4 animate-spin" /> : t('companion:page.actions.sendFeedback')}
              </Button>
            </div>
          </Pane>
        )}

        {validation && (
          <Pane title={t('companion:page.task.validation', { status: t(`companion:page.validation.${validation.status}`) })}>
            <div className="flex flex-col gap-2 p-3">
              <p className="text-sm">{validation.summary}</p>
              <ul className="flex flex-col gap-1 text-sm">
                {validation.checks.map((check) => (
                  <li key={check.name}>{t(check.passed ? 'companion:page.task.checkPassed' : 'companion:page.task.checkFailed', { name: check.name })}</li>
                ))}
                {validation.findings.filter((finding) => !finding.fixed).map((finding) => (
                  <li key={finding.description}>{t('companion:page.task.finding', finding)}</li>
                ))}
              </ul>
            </div>
          </Pane>
        )}

        {task.run?.summary && (
          <Pane title={t('companion:page.task.summary')}>
            <div className="p-3">
              <MarkdownContent>{task.run.summary}</MarkdownContent>
            </div>
          </Pane>
        )}

        <Pane title={t('companion:page.task.description')}>
          <div className="p-3">
            <MarkdownContent>{task.description}</MarkdownContent>
          </div>
        </Pane>

        {task.subtasks.length > 0 && (
          <Pane title={t('companion:page.task.steps')}>
            <ul className="flex flex-col divide-y divide-border text-sm">
              {task.subtasks.map((subtask, index) => (
                <li key={index} className="px-3 py-2">{t(`companion:page.subtask.${subtask.status}`, { title: subtask.title })}</li>
              ))}
            </ul>
          </Pane>
        )}

        {task.run?.triage && (
          <p className="px-1 text-xs text-[var(--pane-title)]">
            {t('companion:page.task.triage', {
              model: task.run.triage.model,
              effort: task.run.triage.effort,
              cost: (task.run.totalCostUsd ?? 0).toFixed(2),
            })}
          </p>
        )}

        <section className="flex flex-col gap-2">
          <Button variant="outline" onClick={() => setShowLogs((value) => !value)}>
            {showLogs ? t('companion:page.task.hideLogs') : t('companion:page.task.showLogs')}
          </Button>
          {showLogs && <TaskLogs project={project} taskId={taskId} onUnauthorized={onUnauthorized} />}
        </section>
      </div>
    </Screen>
  );
}

function TaskLogs({ project, taskId, onUnauthorized }: { project: CompanionProject; taskId: string; onUnauthorized: () => void }) {
  const { t } = useTranslation('companion');
  const load = useCallback(() => api.logs(project.id, taskId), [project.id, taskId]);
  const { data, error } = useRefresh<LogEntry[]>(load, onUnauthorized, TASK_REFRESH_MS);
  if (error) return <Notice>{error}</Notice>;
  if (!data) return <Loading />;
  if (data.length === 0) return <p className="text-xs lowercase text-muted-foreground">{t('page.task.noLogs')}</p>;
  return (
    <ol className="flex flex-col divide-y divide-border border border-border bg-card">
      {data.map((entry, index) => (
        <li key={index} className="px-3 py-2 text-xs">
          <div className="text-[var(--pane-title)]">{[entry.step, entry.tool ?? entry.type, formatDateTime(entry.at)].join(' · ')}</div>
          <div className="mt-1 whitespace-pre-wrap break-words">{entry.content}</div>
        </li>
      ))}
    </ol>
  );
}

// =============================================================================
// New task
// =============================================================================

function CreateScreen({ project, onDone }: { project: CompanionProject; onDone: (taskId?: string) => void }) {
  const { t } = useTranslation('companion');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [start, setStart] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.action<{ id: string }>(project.id, 'create_task', { title, description, start });
      onDone(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Screen title={t('page.create.title')} onBack={() => onDone()}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-xs lowercase text-[var(--pane-title)]">
          {t('page.create.description')}
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={8}
            placeholder={t('page.create.descriptionPlaceholder')}
            className="border px-3 py-2 text-sm normal-case text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs lowercase text-[var(--pane-title)]">
          {t('page.create.titleLabel')}
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('page.create.titlePlaceholder')}
            className="h-11 border px-3 text-sm normal-case text-foreground"
          />
        </label>
        <label className="flex items-center gap-3 text-sm lowercase">
          <input type="checkbox" checked={start} onChange={(event) => setStart(event.target.checked)} className="h-5 w-5" />
          {t('page.create.start')}
        </label>
        {error && <Notice>{error}</Notice>}
        <Button type="submit" size="lg" disabled={busy || !description.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('page.create.submit')}
        </Button>
      </form>
    </Screen>
  );
}
