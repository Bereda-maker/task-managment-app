import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Board, BoardDetail, Member, Task, TaskFilters, TaskStatus } from "./types";

/** "Everyone is looking at the same up-to-date board": refetch on an interval. (The advanced
 * challenge replaces this with live updates.) */
export const POLL_INTERVAL_MS = 10_000;

export const keys = {
  boards: ["boards"] as const,
  board: (id: string) => ["board", id] as const,
  tasks: (boardId: string) => ["tasks", boardId] as const,
  tasksFiltered: (boardId: string, filters: TaskFilters) => ["tasks", boardId, filters] as const,
};

interface TasksResponse {
  tasks: Task[];
}

export function taskQueryString(filters: TaskFilters): string {
  const params = new URLSearchParams();
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.assignee !== "all") params.set("assignee", filters.assignee);
  if (filters.sort !== "created") params.set("sort", filters.sort);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// ---------- Reads ----------

export const useBoards = () =>
  useQuery({ queryKey: keys.boards, queryFn: () => api<{ boards: Board[] }>("/boards").then((r) => r.boards) });

export const useBoard = (boardId: string) =>
  useQuery({
    queryKey: keys.board(boardId),
    queryFn: () => api<BoardDetail>(`/boards/${boardId}`),
    refetchInterval: POLL_INTERVAL_MS,
    enabled: Boolean(boardId),
  });

export const useTasks = (boardId: string, filters: TaskFilters) =>
  useQuery({
    queryKey: keys.tasksFiltered(boardId, filters),
    queryFn: () => api<TasksResponse>(`/boards/${boardId}/tasks${taskQueryString(filters)}`).then((r) => r.tasks),
    refetchInterval: POLL_INTERVAL_MS,
    placeholderData: keepPreviousData, // no flash of empty lanes when a filter changes
    enabled: Boolean(boardId),
  });

// ---------- Writes ----------

export function useCreateBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api<Board>("/boards", { method: "POST", body: { name } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.boards }),
  });
}

export function useDeleteBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (boardId: string) => api(`/boards/${boardId}`, { method: "DELETE" }),
    onSuccess: (_d, boardId) => {
      qc.removeQueries({ queryKey: keys.board(boardId) });
      qc.removeQueries({ queryKey: keys.tasks(boardId) });
      return qc.invalidateQueries({ queryKey: keys.boards });
    },
  });
}

export function useAddMember(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => api<Member>(`/boards/${boardId}/members`, { method: "POST", body: { email } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.board(boardId) }),
  });
}

export function useRemoveMember(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api(`/boards/${boardId}/members/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.board(boardId) });
      qc.invalidateQueries({ queryKey: keys.tasks(boardId) }); // their tasks just became unassigned
      qc.invalidateQueries({ queryKey: keys.boards });
    },
  });
}

export interface NewTask {
  title: string;
  status: TaskStatus;
  assigneeId: string | null;
  dueDate: string | null;
}

export function useCreateTask(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (task: NewTask) => api<Task>(`/boards/${boardId}/tasks`, { method: "POST", body: task }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tasks(boardId) }),
  });
}

export type TaskPatch = Partial<NewTask>;

/**
 * Moving a task between statuses happens WITHOUT a page reload and without waiting on the
 * network: the card jumps lanes immediately (optimistic update), and rolls back if the server
 * says no. Either way the list is re-synced from the server afterwards.
 */
export function useUpdateTask(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) =>
      api<Task>(`/tasks/${id}`, { method: "PATCH", body: patch }),

    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: keys.tasks(boardId) });
      const snapshots = qc.getQueriesData<Task[]>({ queryKey: keys.tasks(boardId) });
      const members = qc.getQueryData<BoardDetail>(keys.board(boardId))?.members ?? [];

      qc.setQueriesData<Task[]>({ queryKey: keys.tasks(boardId) }, (old) =>
        old?.map((task) => {
          if (task.id !== id) return task;
          const next: Task = { ...task, ...patch };
          if (patch.assigneeId !== undefined) {
            const m = members.find((x) => x.id === patch.assigneeId);
            next.assignee = m ? { id: m.id, name: m.name, email: m.email } : null;
          }
          return next;
        }),
      );
      return { snapshots };
    },

    onError: (_err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
    },

    onSettled: () => qc.invalidateQueries({ queryKey: keys.tasks(boardId) }),
  });
}

export function useDeleteTask(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api(`/tasks/${taskId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tasks(boardId) }),
  });
}
