import { STATUS_LABELS, TASK_STATUSES, type Member, type TaskFilters, type TaskStatus } from "../lib/types";

interface Props {
  filters: TaskFilters;
  members: Member[];
  currentUserId: string;
  onChange: (next: TaskFilters) => void;
}

export default function FilterBar({ filters, members, currentUserId, onChange }: Props) {
  const others = members.filter((m) => m.id !== currentUserId);
  return (
    <div className="filters" role="group" aria-label="Filter tasks">
      <label>
        Assignee
        <select value={filters.assignee} onChange={(e) => onChange({ ...filters, assignee: e.target.value })}>
          <option value="all">Everyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          {others.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Status
        <select value={filters.status} onChange={(e) => onChange({ ...filters, status: e.target.value as TaskStatus | "all" })}>
          <option value="all">All statuses</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      <label>
        Order
        <select value={filters.sort} onChange={(e) => onChange({ ...filters, sort: e.target.value as TaskFilters["sort"] })}>
          <option value="created">Oldest first</option>
          <option value="dueDate">Due date</option>
        </select>
      </label>
    </div>
  );
}
