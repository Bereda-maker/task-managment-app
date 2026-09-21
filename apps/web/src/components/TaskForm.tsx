import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { TaskFormSchema, type TaskFormValues } from "../lib/schemas";
import { STATUS_LABELS, TASK_STATUSES, type Member } from "../lib/types";
import FormField from "./FormField";

type FormInput = z.input<typeof TaskFormSchema>;

interface Props {
  members: Member[];
  initial?: Partial<FormInput>;
  submitLabel: string;
  busy?: boolean;
  /** Prefix that keeps element ids unique when several forms are on screen. */
  idPrefix: string;
  onSubmit: (values: TaskFormValues) => Promise<unknown> | unknown;
  onCancel?: () => void;
  /** Reset to blank after a successful submit (used by the "add task" form). */
  resetOnSuccess?: boolean;
}

export default function TaskForm({ members, initial, submitLabel, busy, idPrefix, onSubmit, onCancel, resetOnSuccess }: Props) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormInput, unknown, TaskFormValues>({
    resolver: zodResolver(TaskFormSchema),
    defaultValues: { title: "", status: "todo", assigneeId: "", dueDate: "", ...initial },
  });

  const submit = handleSubmit(async (values) => {
    await onSubmit(values);
    if (resetOnSuccess) reset();
  });

  return (
    <form className="task-form" onSubmit={submit} noValidate>
      <FormField id={`${idPrefix}-title`} label="Title" error={errors.title?.message}>
        {(aria) => <input type="text" autoComplete="off" {...aria} {...register("title")} />}
      </FormField>

      <FormField id={`${idPrefix}-assignee`} label="Assignee" error={errors.assigneeId?.message}>
        {(aria) => (
          <select {...aria} {...register("assigneeId")}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </FormField>

      <FormField id={`${idPrefix}-due`} label="Due date" error={errors.dueDate?.message}>
        {(aria) => <input type="date" {...aria} {...register("dueDate")} />}
      </FormField>

      <FormField id={`${idPrefix}-status`} label="Status" error={errors.status?.message}>
        {(aria) => (
          <select {...aria} {...register("status")}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        )}
      </FormField>

      <div className="task-form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
