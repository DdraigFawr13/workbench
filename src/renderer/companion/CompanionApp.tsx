import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronDown, ExternalLink, Loader2, Plus, RefreshCw } from 'lucide-react';
import { TASK_STATUS_COLUMNS, getTaskColumn, type TaskStatusColumn } from '../../shared/constants/task';
import type { TaskStatus } from '../../shared/types/task';
import { formatDateTime } from '../../shared/utils/format-date-time';
import { Button } from '../components/ui/button';
import { MarkdownContent } from '../components/ui/markdown-content';
import { cn } from '../lib/utils';
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
const REFRESH_MS = 5000;
const PROJECT_KEY = 'workbench.companion.project';

type View =
  | { kind: 'projects' }
  | { kind: 'board'; project: CompanionProject }
  | { kind: 'task'; project: CompanionProject; taskId: string }
  | { kind: 'create'; project: CompanionProject };

const columnOf = (task: TaskSummary): TaskStatusColumn => getTaskColumn(task.status as TaskStatus);

/** Run `load` now and every REFRESH_MS while the page is visible */
function useRefresh<T>(load: () => Promise<T>, onUnauthorized: () => void): { data: T | null; error: string | null; reload: () => void } {
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
    }, REFRESH_MS);
    document.addEventListener('visibilitychange', reload);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', reload);
    };
  }, [reload]);

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
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        {onBack && (
          <button type="button" onClick={onBack} aria-label={t('page.back')} className="-ml-2 rounded-lg p-2 hover:bg-accent">
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h1>
        {action}
      </header>
      <main className="flex-1 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">{children}</main>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl bg-segment-track px-4 py-3 text-sm text-foreground">{children}</div>;
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
        <label className="flex flex-col gap-1.5 text-sm">
          {t('page.pair.code')}
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoCapitalize="characters"
            autoComplete="one-time-code"
            spellCheck={false}
            className="h-12 rounded-lg border border-border bg-transparent px-3 font-mono text-lg tracking-widest uppercase"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          {t('page.pair.deviceName')}
          <input value={name} onChange={(event) => setName(event.target.value)} className="h-11 rounded-lg border border-border bg-transparent px-3" />
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
      <ul className="flex flex-col gap-2">
        {data?.map((project) => (
          <li key={project.id}>
            <button
              type="button"
              onClick={() => {
                opened.current = true;
                onOpen(project);
              }}
              className="w-full rounded-xl border border-border px-4 py-3 text-left text-sm font-medium hover:bg-accent"
            >
              {project.name}
            </button>
          </li>
        ))}
      </ul>
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
  const [column, setColumn] = useState<TaskStatusColumn | null>(null);

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
  const tasks = (data ?? []).filter((task) => columnOf(task) === shown).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  return (
    <Screen
      title={project.name}
      action={
        <>
          <button type="button" onClick={reload} aria-label={t('companion:page.refresh')} className="rounded-lg p-2 hover:bg-accent">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button type="button" onClick={onProjects} aria-label={t('companion:page.projects.switch')} className="rounded-lg p-2 hover:bg-accent">
            <ChevronDown className="h-4 w-4" />
          </button>
        </>
      }
    >
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {TASK_STATUS_COLUMNS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColumn(c)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1.5 text-sm',
              c === shown ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-accent'
            )}
          >
            {t(`tasks:columns.${c}`)} {counts[c]}
          </button>
        ))}
      </div>

      {error && <Notice>{error}</Notice>}
      {!data && !error && <Loading />}
      {data && tasks.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t('companion:page.board.empty')}</p>}

      <ul className="flex flex-col gap-2">
        {tasks.map((task) => (
          <li key={task.id}>
            <button type="button" onClick={() => onOpenTask(task.id)} className="w-full rounded-xl border border-border px-4 py-3 text-left hover:bg-accent">
              <div className="text-sm font-medium">{task.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {[statusText(t, task), formatDateTime(task.updatedAt)].filter(Boolean).join(' · ')}
              </div>
            </button>
          </li>
        ))}
      </ul>

      <Button size="lg" className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 gap-2 bg-background shadow-lg" onClick={onCreate}>
        <Plus className="h-4 w-4" />
        {t('companion:page.board.newTask')}
      </Button>
    </Screen>
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
  const { data: task, error, reload } = useRefresh(load, onUnauthorized);
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

  const actionButton = (action: string, label: string, args?: Record<string, unknown>, done?: string) => (
    <Button key={action + JSON.stringify(args ?? {})} variant="outline" size="lg" disabled={busy !== null} onClick={() => void run(action, args, done)}>
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

  return (
    <Screen title={task.title} onBack={onBack}>
      <div className="flex flex-col gap-5">
        <div className="text-sm text-muted-foreground">
          {[t(`tasks:columns.${column}`), statusText(t, task), task.worktree && t('companion:page.task.diff', task.worktree)].filter(Boolean).join(' · ')}
        </div>

        {/* Actions the board allows from this column */}
        <section className="flex flex-col gap-2">
          {actionError && <Notice>{actionError}</Notice>}
          {actionResult && <Notice>{actionResult}</Notice>}
          {running && actionButton('stop_task', t('companion:page.actions.stop'))}
          {!running && task.allowedMoves.includes('in_progress') && actionButton('start_task', inReview ? t('companion:page.actions.resume') : t('companion:page.actions.start'))}
          {task.status === 'error' && actionButton('retry_task', t('companion:page.actions.retry'))}
          {inReview && !task.prUrl && task.worktree && actionButton('create_pull_request', t('companion:page.actions.createPr'), {}, t('companion:page.actions.prCreated'))}
          {task.prUrl && task.prState !== 'merged' && task.prState !== 'closed' && actionButton('merge_pull_request', t('companion:page.actions.mergePr'), {}, t('companion:page.actions.merged'))}
          {task.prUrl && (
            <a href={task.prUrl} target="_blank" rel="noopener noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium hover:bg-accent">
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
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">{t('companion:page.task.requestChanges')}</h2>
            <textarea
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              rows={4}
              placeholder={t('companion:page.task.feedbackPlaceholder')}
              className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm"
            />
            <Button
              size="lg"
              disabled={busy !== null || !feedback.trim()}
              onClick={() => void run('request_changes', { feedback }, t('companion:page.actions.revising')).then(() => setFeedback(''))}
            >
              {busy === 'request_changes' ? <Loader2 className="h-4 w-4 animate-spin" /> : t('companion:page.actions.sendFeedback')}
            </Button>
          </section>
        )}

        {validation && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">{t('companion:page.task.validation', { status: t(`companion:page.validation.${validation.status}`) })}</h2>
            <p className="text-sm">{validation.summary}</p>
            <ul className="flex flex-col gap-1 text-sm">
              {validation.checks.map((check) => (
                <li key={check.name}>{t(check.passed ? 'companion:page.task.checkPassed' : 'companion:page.task.checkFailed', { name: check.name })}</li>
              ))}
              {validation.findings.filter((finding) => !finding.fixed).map((finding) => (
                <li key={finding.description}>{t('companion:page.task.finding', finding)}</li>
              ))}
            </ul>
          </section>
        )}

        {task.run?.summary && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">{t('companion:page.task.summary')}</h2>
            <MarkdownContent>{task.run.summary}</MarkdownContent>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">{t('companion:page.task.description')}</h2>
          <MarkdownContent>{task.description}</MarkdownContent>
        </section>

        {task.subtasks.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">{t('companion:page.task.steps')}</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {task.subtasks.map((subtask, index) => (
                <li key={index}>{t(`companion:page.subtask.${subtask.status}`, { title: subtask.title })}</li>
              ))}
            </ul>
          </section>
        )}

        {task.run?.triage && (
          <p className="text-xs text-muted-foreground">
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
  const { data, error } = useRefresh<LogEntry[]>(load, onUnauthorized);
  if (error) return <Notice>{error}</Notice>;
  if (!data) return <Loading />;
  if (data.length === 0) return <p className="text-sm text-muted-foreground">{t('page.task.noLogs')}</p>;
  return (
    <ol className="flex flex-col gap-2">
      {data.map((entry, index) => (
        <li key={index} className="rounded-lg bg-segment-track px-3 py-2 text-xs">
          <div className="text-muted-foreground">{[entry.step, entry.tool ?? entry.type, formatDateTime(entry.at)].join(' · ')}</div>
          <div className="mt-1 whitespace-pre-wrap break-words font-mono">{entry.content}</div>
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
        <label className="flex flex-col gap-1.5 text-sm">
          {t('page.create.description')}
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={8}
            placeholder={t('page.create.descriptionPlaceholder')}
            className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          {t('page.create.titleLabel')}
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('page.create.titlePlaceholder')}
            className="h-11 rounded-lg border border-border bg-transparent px-3"
          />
        </label>
        <label className="flex items-center gap-3 text-sm">
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
