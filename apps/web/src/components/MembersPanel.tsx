import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AddMemberSchema } from "../lib/schemas";
import { ApiError } from "../lib/api";
import { useAddMember, useRemoveMember } from "../lib/queries";
import { initials } from "../lib/format";
import type { BoardDetail } from "../lib/types";
import FormField from "./FormField";

interface Props {
  board: BoardDetail;
  currentUserId: string;
  onLeft: () => void;
}

export default function MembersPanel({ board, currentUserId, onLeft }: Props) {
  const isOwner = board.role === "owner";
  const add = useAddMember(board.id);
  const remove = useRemoveMember(board.id);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<z.input<typeof AddMemberSchema>, unknown, z.output<typeof AddMemberSchema>>({
    resolver: zodResolver(AddMemberSchema),
    defaultValues: { email: "" },
  });

  const submit = handleSubmit(async ({ email }) => {
    try {
      await add.mutateAsync(email);
      reset();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e; // already toasted by the fetch wrapper
    }
  });

  return (
    <details className="team">
      <summary>
        Team <span className="count">{board.members.length}</span>
      </summary>

      <ul className="member-list">
        {board.members.map((m) => (
          <li key={m.id}>
            <span className="avatar" aria-hidden="true">
              {initials(m.name)}
            </span>
            <span className="member-name">
              {m.name}
              {m.id === currentUserId && <span className="muted"> (you)</span>}
              <span className="member-email">{m.email}</span>
            </span>
            <span className="member-role">{m.role === "owner" ? "Owner" : "Member"}</span>

            {m.role !== "owner" && (isOwner || m.id === currentUserId) && (
              <button
                type="button"
                className="btn btn-quiet btn-small btn-danger"
                disabled={remove.isPending}
                onClick={async () => {
                  const leaving = m.id === currentUserId;
                  const ok = window.confirm(
                    leaving
                      ? `Leave "${board.name}"? Your tasks here will become unassigned.`
                      : `Remove ${m.name} from "${board.name}"? Their tasks will become unassigned.`,
                  );
                  if (!ok) return;
                  try {
                    await remove.mutateAsync(m.id);
                    if (leaving) onLeft();
                  } catch (e) {
                    if (!(e instanceof ApiError)) throw e;
                  }
                }}
              >
                {m.id === currentUserId ? "Leave board" : "Remove"}{" "}
                <span className="visually-hidden">{m.name}</span>
              </button>
            )}
          </li>
        ))}
      </ul>

      {isOwner ? (
        <form className="add-member" onSubmit={submit} noValidate>
          <FormField
            id="member-email"
            label="Add a teammate by email"
            hint="They need to have registered first."
            error={errors.email?.message}
          >
            {(aria) => <input type="email" autoComplete="off" {...aria} {...register("email")} />}
          </FormField>
          <button type="submit" className="btn btn-primary" disabled={add.isPending}>
            Add teammate
          </button>
        </form>
      ) : (
        <p className="muted small">Only the board owner can add or remove teammates.</p>
      )}
    </details>
  );
}
