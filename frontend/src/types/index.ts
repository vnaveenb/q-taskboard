export type Role = "admin" | "member" | "viewer";
export type TaskStatus = "todo" | "in_progress" | "review" | "done";

export type ApiUser = {
  id: string;
  email: string;
  name: string;
};

export type ApiTask = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigneeId: string | null;
  createdById: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  assignee?: ApiUser | null;
};

export type TaskComment = {
  id: string;
  taskId: string;
  author: ApiUser;
  body: string;
  createdAt: string;
};

export type ActivityAction =
  | "task_created"
  | "status_changed"
  | "assignee_changed"
  | "comment_added";

export type Activity = {
  id: string;
  projectId: string;
  user: ApiUser;
  action: ActivityAction;
  entityType: string;
  entityId: string | null;
  details: Record<string, any>;
  createdAt: string;
};

export type ExportResult = {
  ok: boolean;
  exported: number;
  failed: number;
  total: number;
  errors?: Array<{ task_id: string; title: string; error: string }>;
};

export type ApiProjectMember = {
  id: string;
  role: Role;
  user: ApiUser;
};

export type ApiProjectDetail = {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  owner: ApiUser;
  memberships: ApiProjectMember[];
  tasks: ApiTask[];
  createdAt: string;
  updatedAt: string;
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  review: "In review",
  done: "Done",
};

export const STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "review", "done"];
