export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

export type BoardRole = "owner" | "member";

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface Member extends User {
  role: BoardRole;
}

export interface Board {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  role: BoardRole;
  memberCount: number;
}

export interface BoardDetail extends Omit<Board, "memberCount"> {
  members: Member[];
}

export interface Task {
  id: string;
  boardId: string;
  title: string;
  status: TaskStatus;
  assigneeId: string | null;
  /** Calendar date, "YYYY-MM-DD" */
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  assignee: User | null;
}

export interface Session {
  user: User;
  accessToken: string;
}

export interface TaskFilters {
  status: TaskStatus | "all";
  /** "all" | "me" | "unassigned" | a user id */
  assignee: string;
  sort: "created" | "dueDate";
}

export const DEFAULT_FILTERS: TaskFilters = { status: "all", assignee: "all", sort: "created" };
