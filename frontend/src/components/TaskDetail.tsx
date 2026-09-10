import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ApiTask, ApiProjectMember, TaskStatus, TaskComment, Role } from "@/types";
import { STATUS_LABELS, STATUS_ORDER } from "@/types";

type Props = {
  task: ApiTask;
  projectId: string;
  members: ApiProjectMember[];
  currentUserRole?: Role;
  onClose: () => void;
};

export function TaskDetail({ task, projectId, members, currentUserRole, onClose }: Props) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [assigneeId, setAssigneeId] = useState<string>(task.assigneeId ?? "");
  const [newComment, setNewComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);

  const isViewer = currentUserRole === "viewer";

  // Part 3a: Fetch comments chronologically
  const { data: commentsData, isLoading: commentsLoading } = useQuery({
    queryKey: ["comments", task.id],
    queryFn: () => apiFetch<{ comments: TaskComment[] }>(`/api/tasks/${task.id}/comments`),
  });

  const comments = commentsData?.comments || [];

  const updateTask = useMutation({
    mutationFn: (input: Partial<ApiTask>) =>
      apiFetch<{ task: ApiTask }>(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["activities", projectId] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "save failed"),
  });

  const deleteTask = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>(`/api/tasks/${task.id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["activities", projectId] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "delete failed"),
  });

  // Part 3a: Post comment mutation (append-only)
  const postComment = useMutation({
    mutationFn: (body: string) =>
      apiFetch<{ comment: TaskComment }>(`/api/tasks/${task.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      setNewComment("");
      setCommentError(null);
      queryClient.invalidateQueries({ queryKey: ["comments", task.id] });
      queryClient.invalidateQueries({ queryKey: ["activities", projectId] });
    },
    onError: (err) => setCommentError(err instanceof Error ? err.message : "failed to post comment"),
  });

  function onSave() {
    setError(null);
    updateTask.mutate({
      title,
      description,
      status,
      assigneeId: assigneeId || null,
    });
  }

  function handleCommentSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;
    setCommentError(null);
    postComment.mutate(newComment.trim());
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center px-4 z-50 overflow-y-auto py-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-surface border border-border rounded-lg p-6 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <h2 className="text-lg font-semibold">edit task</h2>
          <button onClick={onClose} className="text-muted hover:text-white">
            ✕
          </button>
        </div>

        <div className="overflow-y-auto flex-1 pr-1 space-y-4">
          <label className="block">
            <span className="text-xs text-muted">title</span>
            <input
              type="text"
              value={title}
              disabled={isViewer}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-60"
            />
          </label>

          <label className="block">
            <span className="text-xs text-muted">description</span>
            <textarea
              value={description}
              disabled={isViewer}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1 block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-60"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-muted">status</span>
              <select
                value={status}
                disabled={isViewer}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                className="mt-1 block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-60"
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs text-muted">assignee</span>
              <select
                value={assigneeId}
                disabled={isViewer}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="mt-1 block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-60"
              >
                <option value="">unassigned</option>
                {members.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          {/* Part 3a: Comments Section */}
          <div className="border-t border-border pt-4 mt-6">
            <h3 className="text-sm font-semibold mb-3">Comments ({comments.length})</h3>

            {commentsLoading ? (
              <p className="text-xs text-muted">Loading comments…</p>
            ) : comments.length === 0 ? (
              <p className="text-xs text-muted italic">No comments yet. Start the conversation!</p>
            ) : (
              <div className="space-y-3 mb-4 max-h-48 overflow-y-auto pr-1">
                {comments.map((c) => (
                  <div key={c.id} className="bg-bg rounded p-3 text-xs border border-border">
                    <div className="flex items-center justify-between text-muted mb-1">
                      <span className="font-semibold text-white">{c.author.name}</span>
                      <span>{new Date(c.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                  </div>
                ))}
              </div>
            )}

            {isViewer ? (
              <p className="text-xs text-muted italic bg-surface/50 border border-border rounded p-2">
                Viewers can read comments but cannot post.
              </p>
            ) : (
              <form onSubmit={handleCommentSubmit} className="mt-3">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Write a comment..."
                  rows={2}
                  className="w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                />
                {commentError && (
                  <p className="text-xs text-red-400 mt-1" role="alert">
                    {commentError}
                  </p>
                )}
                <div className="flex justify-end mt-2">
                  <button
                    type="submit"
                    disabled={postComment.isPending || !newComment.trim()}
                    className="bg-accent hover:bg-indigo-500 text-white text-xs font-medium rounded px-3 py-1.5 disabled:opacity-50"
                  >
                    {postComment.isPending ? "Posting…" : "Post Comment"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Modal Action Buttons */}
        <div className="flex items-center justify-between gap-3 pt-4 border-t border-border mt-4 flex-shrink-0">
          {!isViewer ? (
            <button
              onClick={() => deleteTask.mutate()}
              disabled={deleteTask.isPending}
              className="text-sm text-red-400 hover:text-red-300 disabled:opacity-50"
            >
              delete task
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-sm px-4 py-2 rounded-md border border-border hover:border-muted"
            >
              close
            </button>
            {!isViewer && (
              <button
                onClick={onSave}
                disabled={updateTask.isPending}
                className="text-sm px-4 py-2 rounded-md bg-accent text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {updateTask.isPending ? "saving…" : "save"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
