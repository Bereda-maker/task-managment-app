import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import FormField from "../components/FormField";
import { ApiError } from "../lib/api";
import { useBoards, useCreateBoard } from "../lib/queries";
import { BoardSchema } from "../lib/schemas";

export default function BoardsPage() {
  const boards = useBoards();
  const createBoard = useCreateBoard();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<z.input<typeof BoardSchema>, unknown, z.output<typeof BoardSchema>>({
    resolver: zodResolver(BoardSchema),
    defaultValues: { name: "" },
  });

  const submit = handleSubmit(async ({ name }) => {
    try {
      const board = await createBoard.mutateAsync(name);
      reset();
      navigate(`/boards/${board.id}`);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
  });

  return (
    <div className="boards-page">
      <h1>Your boards</h1>

      {boards.isPending && <p role="status">Loading boards…</p>}
      {boards.isError && <p className="muted">Couldn't load your boards. Reload the page to try again.</p>}

      {boards.data && boards.data.length === 0 && (
        <p className="empty">You're not on any boards yet. Create one below, or ask a teammate to add you to theirs.</p>
      )}

      {boards.data && boards.data.length > 0 && (
        <ul className="board-list">
          {boards.data.map((b) => (
            <li key={b.id}>
              <Link to={`/boards/${b.id}`}>
                <span className="board-name">{b.name}</span>
                <span className="board-meta">
                  {b.memberCount} {b.memberCount === 1 ? "person" : "people"}
                  {b.role === "owner" ? " · you own this" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="new-board-heading" className="new-board">
        <h2 id="new-board-heading">Create a board</h2>
        <form onSubmit={submit} noValidate className="inline-form">
          <FormField id="board-name" label="Board name" error={errors.name?.message}>
            {(aria) => <input type="text" autoComplete="off" {...aria} {...register("name")} />}
          </FormField>
          <button type="submit" className="btn btn-primary" disabled={createBoard.isPending}>
            Create board
          </button>
        </form>
      </section>
    </div>
  );
}
