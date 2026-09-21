import { useState } from "react";
import { formatDueDate, initials, isOverdue } from "../lib/format";
import { STATUS_LABELS, TASK_STATUSES, type Member, type Task, type TaskStatus } from "../lib/types";
import type { TaskPatch } from "../lib/queries";
import TaskForm from "./TaskForm";

interface Props {
  task: Task;
  members: Member[];
  onChange: (id: string, patch: TaskPatch) => Promise<unknown> | unknown;
  onDelete: (task: Task) => void;
}

export default function TaskCard({ task, members, onChange, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const overdue = isOverdue(task.dueDate, task.status);

  if (editing) {
    return (
      <li className="card card-editing">
        <TaskForm
          idPrefix={`edit-${task.id}`}
          members={members}
          submitLabel="Save changes"
          initial={{
            title: task.title,
            status: task.status,
            assigneeId: task.assigneeId ?? "",
            dueDate: task.dueDate ?? "",
          }}
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            await onChange(task.id, {
              title: v.title,
              status: v.status,
              assigneeId: v.assigneeId || null,
              dueDate: v.dueDate || null,
            });
            setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className={`card${overdue ? " card-overdue" : ""}`}>
      <h4 className="card-title">{task.title}</h4>

      <div className="card-meta">
        {task.assignee ? (
          <span className="assignee">
            <span className="avatar" aria-hidden="true">
              {initials(task.assignee.name)}
            </span>
            <span>{task.assignee.name}</span>
          </span>
        ) : (
          <span className="muted">Unassigned</span>
        )}

        {task.dueDate && (
          <span className={`due${overdue ? " due-overdue" : ""}`}>
            {overdue && <strong>Overdue · </strong>}
            <time dateTime={task.dueDate}>{formatDueDate(task.dueDate)}</time>
          </span>
        )}
      </div>

      <div className="card-actions">
        {/* A real, labeled <select> — keyboard and screen-reader friendly with no extra work. */}
        <label className="status-picker">
          <span className="visually-hidden">Status of {task.title}</span>
          <select
            value={task.status}
            onChange={(e) => void onChange(task.id, { status: e.target.value as TaskStatus })}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-quiet btn-small" onClick={() => setEditing(true)}>
          Edit{" "}
          <span className="visually-hidden">{task.title}</span>
        </button>
        <button type="button" className="btn btn-quiet btn-small btn-danger" onClick={() => onDelete(task)}>
          Delete{" "}
          <span className="visually-hidden">{task.title}</span>
        </button>
      </div>
    </li>
  );
}
