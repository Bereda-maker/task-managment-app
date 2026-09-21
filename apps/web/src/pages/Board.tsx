import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import FilterBar from "../components/FilterBar";
import MembersPanel from "../components/MembersPanel";
import TaskCard from "../components/TaskCard";
import TaskForm from "../components/TaskForm";
import { ApiError } from "../lib/api";
import { useBoard, useCreateTask, useDeleteBoard, useDeleteTask, useTasks, useUpdateTask } from "../lib/queries";
import { DEFAULT_FILTERS, STATUS_LABELS, TASK_STATUSES, type Task, type TaskFilters, type TaskStatus } from "../lib/types";

const EMPTY_HINT: Record<TaskStatus, string> = {
  todo: "Nothing waiting.",
  in_progress: "Nothing underway.",
  done: "Nothing finished yet.",
};

export default function BoardPage() {
  const { boardId = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_FILTERS);
  const board = useBoard(boardId);
  const tasks = useTasks(boardId, filters);
  const createTask = useCreateTask(boardId);
  const updateTask = useUpdateTask(boardId);
  const deleteTask = useDeleteTask(boardId);
  const deleteBoard = useDeleteBoard();

  const lanes = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], done: [] };
    for (const task of tasks.data ?? []) grouped[task.status].push(task);
    return grouped;
  }, [tasks.data]);

  if (board.isPending) return <p role="status">Loading board…</p>;

  if (board.isError || !board.data) {
    const status = board.error instanceof ApiError ? board.error.status : 0;
    return (
      <div className="empty">
        <h1>{status === 403 ? "You don't have access to this board" : "Couldn't open this board"}</h1>
        <p>
          <Link to="/">Back to your boards</Link>
        </p>
      </div>
    );
  }

  const b = board.data;
  const filtersActive = filters.status !== "all" || filters.assignee !== "all";

  // Mutations already toast their own failures (see lib/api.ts). Swallow ApiErrors here so a
  // rejected promise from a <select> handler doesn't become an "unhandled rejection".
  const safely = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
  };

  return (
    <div className="board-page">
      <p className="crumbs">
        <Link to="/">All boards</Link>
      </p>

      <header className="board-head">
        <h1>{b.name}</h1>
        {b.role === "owner" && (
          <button
            type="button"
            className="btn btn-quiet btn-danger"
            onClick={() =>
              void safely(async () => {
                if (!window.confirm(`Delete "${b.name}" and all of its tasks for everyone? This can't be undone.`)) return;
                await deleteBoard.mutateAsync(b.id);
                navigate("/", { replace: true });
              })
            }
          >
            Delete board
          </button>
        )}
      </header>

      <MembersPanel board={b} currentUserId={user?.id ?? ""} onLeft={() => navigate("/", { replace: true })} />

      <section aria-labelledby="add-task-heading" className="add-task">
        <h2 id="add-task-heading">Add a task</h2>
        <TaskForm
          idPrefix="new-task"
          members={b.members}
          submitLabel="Add task"
          busy={createTask.isPending}
          resetOnSuccess
          onSubmit={(v) =>
            safely(() =>
              createTask
                .mutateAsync({
                  title: v.title,
                  status: v.status,
                  assigneeId: v.assigneeId || null,
                  dueDate: v.dueDate || null,
                })
                .then(() => undefined),
            ).then(() => undefined)
          }
        />
      </section>

      <FilterBar filters={filters} members={b.members} currentUserId={user?.id ?? ""} onChange={setFilters} />

      <div className="lanes">
        {TASK_STATUSES.map((status) => {
          const items = lanes[status];
          return (
            <section key={status} className={`lane lane-${status}`} aria-labelledby={`lane-${status}`}>
              <header className="lane-head">
                <h3 id={`lane-${status}`}>{STATUS_LABELS[status]}</h3>
                <span className="lane-count" aria-label={`${items.length} ${items.length === 1 ? "task" : "tasks"}`}>
                  {items.length}
                </span>
              </header>

              {items.length === 0 ? (
                <p className="lane-empty">{filtersActive ? "No matching tasks." : EMPTY_HINT[status]}</p>
              ) : (
                <ul className="cards">
                  {items.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      members={b.members}
                      onChange={(id, patch) => safely(() => updateTask.mutateAsync({ id, patch }))}
                      onDelete={(t) => {
                        if (window.confirm(`Delete "${t.title}"?`)) void safely(() => deleteTask.mutateAsync(t.id));
                      }}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
