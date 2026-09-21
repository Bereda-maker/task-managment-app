import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { alice, apiError, bob, boardDetail, makeTask, mockApi, renderApp, respond, session } from "../test/utils";

/** A tiny in-memory "server" so PATCH results are reflected by later GETs. */
function boardServer(initial = [makeTask(), makeTask({ id: "t2", title: "Ship v1", status: "in_progress", assigneeId: alice.id, assignee: alice }), makeTask({ id: "t3", title: "Kickoff", status: "done", assignee: null, assigneeId: null })]) {
  let tasks = [...initial];
  return mockApi({
    "POST /auth/refresh": () => respond(session),
    "GET /boards/b1": () => respond(boardDetail),
    "GET /boards/b1/tasks": () => respond({ tasks }),
    "PATCH /tasks/t1": ({ body }) => {
      tasks = tasks.map((t) => (t.id === "t1" ? { ...t, ...body } : t));
      return respond(tasks.find((t) => t.id === "t1"));
    },
    "DELETE /tasks/t1": () => {
      tasks = tasks.filter((t) => t.id !== "t1");
      return respond(null, 204);
    },
    "POST /boards/b1/tasks": ({ body }) => {
      const created = makeTask({ id: "t9", ...body, assignee: null });
      tasks = [...tasks, created];
      return respond(created, 201);
    },
  });
}

const lane = (name: string) => screen.getByRole("region", { name });

describe("Board page", () => {
  it("shows tasks in the lane matching their status, with assignees and counts", async () => {
    boardServer();
    renderApp("/boards/b1");

    expect(await screen.findByRole("heading", { name: "Launch plan" })).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Write docs" });

    expect(within(lane("To do")).getByRole("heading", { name: "Write docs" })).toBeInTheDocument();
    expect(within(lane("In progress")).getByRole("heading", { name: "Ship v1" })).toBeInTheDocument();
    expect(within(lane("Done")).getByRole("heading", { name: "Kickoff" })).toBeInTheDocument();
    expect(within(lane("To do")).getByText("Bob Brown")).toBeInTheDocument();
    expect(within(lane("To do")).getByLabelText("1 task")).toBeInTheDocument();
  });

  it("moves a task to another status via its <select> — no reload, PATCH sent, card changes lane", async () => {
    const user = userEvent.setup();
    const { callsTo } = boardServer();
    renderApp("/boards/b1");

    const picker = await screen.findByRole("combobox", { name: /Status of Write docs/ });
    await user.selectOptions(picker, "done");

    // The card jumps to the Done lane…
    await waitFor(() => expect(within(lane("Done")).getByRole("heading", { name: "Write docs" })).toBeInTheDocument());
    expect(within(lane("To do")).queryByRole("heading", { name: "Write docs" })).not.toBeInTheDocument();

    // …because the client sent exactly one PATCH with just the changed field.
    expect(callsTo("PATCH /tasks/t1")).toHaveLength(1);
    expect(callsTo("PATCH /tasks/t1")[0]!.body).toEqual({ status: "done" });
    expect(callsTo("PATCH /tasks/t1")[0]!.auth).toBe("Bearer token-1");
  });

  it("rolls the card back and shows an error toast when the server rejects the change", async () => {
    const user = userEvent.setup();
    const server = boardServer();
    // Override the PATCH handler to fail.
    const original = server.fetchMock.getMockImplementation()!;
    server.fetchMock.mockImplementation(async (input, init) =>
      init?.method === "PATCH" ? apiError(403, "FORBIDDEN", "You are not a member of this board") : original(input, init),
    );
    renderApp("/boards/b1");

    await user.selectOptions(await screen.findByRole("combobox", { name: /Status of Write docs/ }), "done");

    expect(await screen.findByRole("alert")).toHaveTextContent("You are not a member of this board");
    await waitFor(() => expect(within(lane("To do")).getByRole("heading", { name: "Write docs" })).toBeInTheDocument());
    expect(within(lane("Done")).queryByRole("heading", { name: "Write docs" })).not.toBeInTheDocument();
  });

  it("flags overdue tasks with text, not just colour", async () => {
    boardServer([makeTask({ dueDate: "2020-01-01" })]);
    renderApp("/boards/b1");
    expect(await screen.findByText(/Overdue/)).toBeInTheDocument();
  });

  it("filters by assignee on the server (?assignee=me)", async () => {
    const user = userEvent.setup();
    const { calls } = boardServer();
    renderApp("/boards/b1");
    await screen.findByRole("heading", { name: "Write docs" });

    const filters = within(screen.getByRole("group", { name: "Filter tasks" }));
    await user.selectOptions(filters.getByLabelText("Assignee"), "me");

    await waitFor(() => expect(calls.some((c) => c.path === "/boards/b1/tasks" && c.search === "?assignee=me")).toBe(true));
  });

  it("filters by status on the server (?status=done)", async () => {
    const user = userEvent.setup();
    const { calls } = boardServer();
    renderApp("/boards/b1");
    await screen.findByRole("heading", { name: "Write docs" });

    const filters = within(screen.getByRole("group", { name: "Filter tasks" }));
    await user.selectOptions(filters.getByLabelText("Status"), "done");

    await waitFor(() => expect(calls.some((c) => c.search === "?status=done")).toBe(true));
  });

  it("validates the new-task form instantly and sends nothing while it's invalid", async () => {
    const user = userEvent.setup();
    const { callsTo } = boardServer();
    renderApp("/boards/b1");
    await screen.findByRole("heading", { name: "Write docs" });

    await user.click(screen.getByRole("button", { name: "Add task" }));

    expect(await screen.findByText("Title is required")).toBeInTheDocument();
    expect(callsTo("POST /boards/b1/tasks")).toHaveLength(0);
  });

  it("creates a task with an assignee and due date, then clears the form", async () => {
    const user = userEvent.setup();
    const { callsTo } = boardServer();
    renderApp("/boards/b1");
    await screen.findByRole("heading", { name: "Write docs" });

    const form = screen.getByRole("region", { name: "Add a task" });
    await user.type(within(form).getByLabelText("Title"), "Draft press release");
    await user.selectOptions(within(form).getByLabelText("Assignee"), "Bob Brown");
    await user.type(within(form).getByLabelText("Due date"), "2026-12-31");
    await user.click(within(form).getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(callsTo("POST /boards/b1/tasks")).toHaveLength(1));
    expect(callsTo("POST /boards/b1/tasks")[0]!.body).toEqual({
      title: "Draft press release",
      status: "todo",
      assigneeId: bob.id,
      dueDate: "2026-12-31",
    });
    await waitFor(() => expect(within(form).getByLabelText("Title")).toHaveValue(""));
  });

  it("edits a task in place", async () => {
    const user = userEvent.setup();
    const { callsTo } = boardServer();
    renderApp("/boards/b1");

    await user.click(await screen.findByRole("button", { name: /Edit Write docs/ }));
    const title = screen.getByLabelText("Title", { selector: "#edit-t1-title" });
    await user.clear(title);
    await user.type(title, "Write better docs");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(callsTo("PATCH /tasks/t1")).toHaveLength(1));
    expect(callsTo("PATCH /tasks/t1")[0]!.body).toMatchObject({ title: "Write better docs", assigneeId: bob.id, dueDate: null });
  });

  it("deletes a task after confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { callsTo } = boardServer();
    renderApp("/boards/b1");

    await user.click(await screen.findByRole("button", { name: /Delete Write docs/ }));

    await waitFor(() => expect(callsTo("DELETE /tasks/t1")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Write docs" })).not.toBeInTheDocument());
  });

  it("does nothing if the delete confirmation is declined", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { callsTo } = boardServer();
    renderApp("/boards/b1");

    await user.click(await screen.findByRole("button", { name: /Delete Write docs/ }));
    expect(callsTo("DELETE /tasks/t1")).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Write docs" })).toBeInTheDocument();
  });

  it("explains when you can't open a board (403)", async () => {
    mockApi({
      "POST /auth/refresh": () => respond(session),
      "GET /boards/b1": () => apiError(403, "FORBIDDEN", "You are not a member of this board"),
      "GET /boards/b1/tasks": () => apiError(403, "FORBIDDEN", "You are not a member of this board"),
    });
    renderApp("/boards/b1");
    expect(await screen.findByRole("heading", { name: /don't have access/i })).toBeInTheDocument();
  });

  it("only shows owner controls (delete board, add teammate) to the owner", async () => {
    mockApi({
      "POST /auth/refresh": () => respond({ user: bob, accessToken: "t" }),
      "GET /boards/b1": () => respond({ ...boardDetail, role: "member" }),
      "GET /boards/b1/tasks": () => respond({ tasks: [] }),
    });
    renderApp("/boards/b1");
    await screen.findByRole("heading", { name: "Launch plan" });

    expect(screen.queryByRole("button", { name: "Delete board" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add teammate" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Leave board/ })).toBeInTheDocument();
  });
});
