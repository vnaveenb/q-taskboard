import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, getToken } from "@/lib/api-client";
import { triggerProjectExport } from "@/lib/airtable";
import { Header } from "@/components/Header";
import { StatusColumn } from "@/components/StatusColumn";
import { TaskDetail } from "@/components/TaskDetail";
import type {
  ApiProjectDetail,
  ApiTask,
  ApiUser,
  Activity,
  ExportResult,
  TaskStatus,
} from "@/types";
import { STATUS_ORDER } from "@/types";

export default function ProjectPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const [activeTask, setActiveTask] = useState<ApiTask | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newColumn, setNewColumn] = useState<TaskStatus>("todo");
  const [error, setError] = useState<string | null>(null);
  const [exportFeedback, setExportFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!getToken()) navigate("/login", { replace: true });
  }, [navigate]);

  const { data: meData } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<{ user: ApiUser }>("/api/users/me"),
  });

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ["project", id],
    queryFn: () => apiFetch<{ project: ApiProjectDetail }>(`/api/projects/${id}`),
  });

  // Part 3b: Query activity feed
  const { data: activityData, isLoading: activitiesLoading } = useQuery({
    queryKey: ["activities", id],
    queryFn: () => apiFetch<{ activities: Activity[] }>(`/api/projects/${id}/activities`),
    enabled: !!id,
  });

  const project = data?.project;
  const currentMembership = project?.memberships.find(
    (m) => m.user.id === meData?.user?.id
  );
  const currentRole = currentMembership?.role;
  const canEdit = currentRole === "admin" || currentRole === "member";

  const createTask = useMutation({
    mutationFn: (input: { title: string; status: TaskStatus }) =>
      apiFetch<{ task: ApiTask }>(`/api/projects/${id}/tasks`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      setNewTitle("");
      queryClient.invalidateQueries({ queryKey: ["project", id] });
      queryClient.invalidateQueries({ queryKey: ["activities", id] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "create failed"),
  });

  // Part 3c: Airtable Export Mutation
  const exportMutation = useMutation({
    mutationFn: () => triggerProjectExport(id!),
    onSuccess: (result: ExportResult) => {
      setExportFeedback({
        type: "success",
        message: `Successfully exported ${result.exported} of ${result.total} tasks to Airtable!${
          result.failed > 0 ? ` (${result.failed} failed)` : ""
        }`,
      });
    },
    onError: (err) => {
      setExportFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Airtable export failed",
      });
    },
  });

  const tasksByStatus: Record<TaskStatus, ApiTask[]> = {
    todo: [],
    in_progress: [],
    review: [],
    done: [],
  };
  if (project) {
    for (const t of project.tasks) {
      tasksByStatus[t.status].push(t);
    }
  }

  function renderActivityMessage(a: Activity) {
    const details = a.details || {};
    const title = details.task_title ? `"${details.task_title}"` : "task";
    switch (a.action) {
      case "task_created":
        return `created ${title}`;
      case "status_changed":
        return `moved ${title} from ${details.old_status} to ${details.new_status}`;
      case "assignee_changed":
        return `reassigned ${title} to ${details.new_assignee || "unassigned"}`;
      case "comment_added":
        return `commented on ${title}`;
      default:
        return a.action;
    }
  }

  return (
    <div className="min-h-screen pb-16">
      <Header />

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-2">
          <Link to="/dashboard" className="text-sm text-muted hover:text-white">
            ← all projects
          </Link>
          {currentRole && (
            <span className="text-xs uppercase tracking-wider px-2 py-0.5 rounded bg-surface border border-border text-muted">
              Role: {currentRole}
            </span>
          )}
        </div>

        {isLoading && <p className="text-muted text-sm mt-6">loading…</p>}
        {queryError && (
          <p className="text-sm text-red-400 mt-6">
            {queryError instanceof Error ? queryError.message : "failed to load"}
          </p>
        )}

        {project && (
          <>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mt-4 mb-8">
              <div>
                <h1 className="text-2xl font-semibold">{project.name}</h1>
                {project.description && (
                  <p className="text-sm text-muted mt-1 max-w-2xl">
                    {project.description}
                  </p>
                )}
                <p className="text-xs text-muted mt-2">
                  owner: {project.owner.name} · {project.memberships.length} members ·{" "}
                  {project.tasks.length} tasks
                </p>
              </div>

              {/* Part 3c: Airtable Export Trigger */}
              {canEdit && (
                <div className="flex flex-col items-end">
                  <button
                    onClick={() => {
                      setExportFeedback(null);
                      exportMutation.mutate();
                    }}
                    disabled={exportMutation.isPending}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-md px-4 py-2 transition disabled:opacity-50"
                  >
                    {exportMutation.isPending ? (
                      <>
                        <span className="animate-spin text-xs">⏳</span>
                        Exporting to Airtable…
                      </>
                    ) : (
                      <>
                        <span>📤</span> Export to Airtable
                      </>
                    )}
                  </button>
                  {exportFeedback && (
                    <p
                      className={`text-xs mt-2 ${
                        exportFeedback.type === "success"
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      {exportFeedback.message}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Task Creation Form (only for admin & member) */}
            {canEdit ? (
              <section className="bg-surface border border-border rounded-lg p-4 mb-6">
                <h2 className="text-sm font-medium mb-3">add a task</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newTitle.trim()) return;
                    setError(null);
                    createTask.mutate({ title: newTitle.trim(), status: newColumn });
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="task title"
                    className="flex-1 rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                  <select
                    value={newColumn}
                    onChange={(e) => setNewColumn(e.target.value as TaskStatus)}
                    className="rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={createTask.isPending}
                    className="bg-accent hover:bg-indigo-500 text-white text-sm font-medium rounded-md px-4 disabled:opacity-50"
                  >
                    add
                  </button>
                </form>
                {error && (
                  <p className="text-sm text-red-400 mt-2" role="alert">
                    {error}
                  </p>
                )}
              </section>
            ) : (
              <div className="bg-surface/60 border border-border rounded-lg p-3 mb-6 text-xs text-muted">
                You are viewing this project as a read-only viewer. Task creation and editing are disabled.
              </div>
            )}

            {/* Kanban Columns */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {STATUS_ORDER.map((s) => (
                <StatusColumn
                  key={s}
                  status={s}
                  tasks={tasksByStatus[s]}
                  onTaskClick={setActiveTask}
                />
              ))}
            </div>

            {/* Lower Grid: Members and Activity Feed */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-10">
              {/* Part 3b: Activity Feed (2 Cols) */}
              <section className="lg:col-span-2">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
                    Recent Activity
                  </h2>
                  <span className="text-xs text-muted">Most recent first</span>
                </div>
                <div className="bg-surface border border-border rounded-lg p-4">
                  {activitiesLoading ? (
                    <p className="text-xs text-muted">Loading activities…</p>
                  ) : !activityData?.activities || activityData.activities.length === 0 ? (
                    <p className="text-xs text-muted italic">No activity recorded yet.</p>
                  ) : (
                    <ul className="divide-y divide-border/60 max-h-96 overflow-y-auto pr-2 space-y-2">
                      {activityData.activities.map((a) => (
                        <li key={a.id} className="pt-2 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-white">
                              {a.user.name}{" "}
                              <span className="font-normal text-muted">
                                {renderActivityMessage(a)}
                              </span>
                            </span>
                            <span className="text-[11px] text-muted ml-2 shrink-0">
                              {new Date(a.createdAt).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}{" "}
                              · {new Date(a.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              {/* Members List (1 Col) */}
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
                  Project Members
                </h2>
                <ul className="bg-surface border border-border rounded-lg divide-y divide-border">
                  {project.memberships.map((m) => (
                    <li
                      key={m.id}
                      className="px-4 py-3 flex items-center justify-between text-sm"
                    >
                      <span className="font-medium">{m.user.name}</span>
                      <span className="text-xs text-muted">
                        {m.user.email} · <span className="text-accent">{m.role}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </>
        )}
      </main>

      {/* Task Details Modal */}
      {activeTask && project && (
        <TaskDetail
          task={activeTask}
          projectId={id!}
          members={project.memberships}
          currentUserRole={currentRole}
          onClose={() => setActiveTask(null)}
        />
      )}
    </div>
  );
}
