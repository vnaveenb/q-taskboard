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
  project_id?: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigneeId: string | null;
  assignee_id?: string | null;
  createdById: string;
  created_by_id?: string;
  position: number;
  createdAt: string;
  created_at?: string;
  updatedAt: string;
  updated_at?: string;
  assignee?: ApiUser | null;
};

export type TaskComment = {
  id: string;
  taskId: string;
  task_id?: string;
  author: ApiUser;
  body: string;
  createdAt: string;
  created_at?: string;
};

export type ActivityAction =
  | "task_created"
  | "status_changed"
  | "assignee_changed"
  | "comment_added";

export type Activity = {
  id: string;
  projectId: string;
  project_id?: string;
  user: ApiUser;
  action: ActivityAction;
  entityType: string;
  entity_type?: string;
  entityId: string | null;
  entity_id?: string | null;
  details: Record<string, any>;
  createdAt: string;
  created_at?: string;
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
