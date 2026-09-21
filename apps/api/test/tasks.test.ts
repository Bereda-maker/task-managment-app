import { beforeEach, describe, expect, it } from "bun:test";
import { addMember, api, createBoard, createTask, json, registerUser, resetDb } from "./helpers";

beforeEach(resetDb);

async function setup() {
  const alice = await registerUser("Alice");
  const bob = await registerUser("Bob");
  const board = await createBoard(alice);
  await addMember(alice, board.id, bob);
  return { alice, bob, board };
}

describe("creating tasks", () => {
  it("creates a task with defaults and includes the assignee's name", async () => {
    const { alice, bob, board } = await setup();

    const plain = await createTask(alice, board.id, { title: "  Write spec  " });
    expect(plain).toMatchObject({ title: "Write spec", status: "todo", assigneeId: null, dueDate: null, assignee: null });

    const full = await createTask(alice, board.id, {
      title: "Ship it",
      status: "in_progress",
      assigneeId: bob.id,
      dueDate: "2026-12-31",
    });
    expect(full).toMatchObject({ status: "in_progress", dueDate: "2026-12-31" });
    expect(full.assignee).toEqual({ id: bob.id, name: "Bob", email: bob.email });
  });

  it("validates title, status and dates", async () => {
    const { alice, board } = await setup();
    const post = (body: unknown) => api("POST", `/boards/${board.id}/tasks`, { token: alice.token, body });

    expect((await post({ title: "" })).status).toBe(400);
    expect((await post({ title: "x", status: "blocked" })).status).toBe(400);
    expect((await post({ title: "x", dueDate: "2026-02-31" })).status).toBe(400); // not a real day
    expect((await post({ title: "x", dueDate: "tomorrow" })).status).toBe(400);
    expect((await post({ title: "x".repeat(201) })).status).toBe(400);
  });

  it("only assigns to board members (400 ASSIGNEE_NOT_MEMBER)", async () => {
    const { alice, board } = await setup();
    const outsider = await registerUser("Outsider");
    const res = await api("POST", `/boards/${board.id}/tasks`, {
      token: alice.token,
      body: { title: "x", assigneeId: outsider.id },
    });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("ASSIGNEE_NOT_MEMBER");
  });

  it("forbids non-members from creating tasks", async () => {
    const { board } = await setup();
    const mallory = await registerUser();
    const res = await api("POST", `/boards/${board.id}/tasks`, { token: mallory.token, body: { title: "sneaky" } });
    expect(res.status).toBe(403);
  });
});

describe("listing and filtering", () => {
  async function seeded() {
    const ctx = await setup();
    const { alice, bob, board } = ctx;
    await createTask(alice, board.id, { title: "A1", status: "todo", assigneeId: alice.id, dueDate: "2026-11-01" });
    await createTask(alice, board.id, { title: "B1", status: "in_progress", assigneeId: bob.id });
    await createTask(alice, board.id, { title: "B2", status: "done", assigneeId: bob.id, dueDate: "2026-10-01" });
    await createTask(alice, board.id, { title: "Nobody", status: "todo" });
    return ctx;
  }
  const titles = async (res: Response) => (await json(res)).tasks.map((t: any) => t.title);

  it("returns every task with assignee names, oldest first", async () => {
    const { alice, board } = await seeded();
    const res = await api("GET", `/boards/${board.id}/tasks`, { token: alice.token });
    expect(await titles(res)).toEqual(["A1", "B1", "B2", "Nobody"]);
    const tasks = (await json(await api("GET", `/boards/${board.id}/tasks`, { token: alice.token }))).tasks;
    expect(tasks.map((t: any) => t.assignee?.name ?? null)).toEqual(["Alice", "Bob", "Bob", null]);
    expect(tasks[0].assignee.passwordHash).toBeUndefined();
  });

  it("filters by status", async () => {
    const { alice, board } = await seeded();
    const res = await api("GET", `/boards/${board.id}/tasks?status=todo`, { token: alice.token });
    expect(await titles(res)).toEqual(["A1", "Nobody"]);
  });

  it("filters by assignee: me, unassigned, or a specific user", async () => {
    const { alice, bob, board } = await seeded();
    const get = (q: string, as = bob) => api("GET", `/boards/${board.id}/tasks?${q}`, { token: as.token });

    expect(await titles(await get("assignee=me"))).toEqual(["B1", "B2"]); // Bob's own view
    expect(await titles(await get("assignee=me", alice))).toEqual(["A1"]);
    expect(await titles(await get("assignee=unassigned"))).toEqual(["Nobody"]);
    expect(await titles(await get(`assignee=${alice.id}`))).toEqual(["A1"]);
  });

  it("combines filters", async () => {
    const { bob, board } = await seeded();
    const res = await api("GET", `/boards/${board.id}/tasks?assignee=me&status=done`, { token: bob.token });
    expect(await titles(res)).toEqual(["B2"]);
  });

  it("sorts by due date with undated tasks last", async () => {
    const { alice, board } = await seeded();
    const res = await api("GET", `/boards/${board.id}/tasks?sort=dueDate`, { token: alice.token });
    expect(await titles(res)).toEqual(["B2", "A1", "B1", "Nobody"]);
  });

  it("rejects invalid filter values with 400", async () => {
    const { alice, board } = await seeded();
    expect((await api("GET", `/boards/${board.id}/tasks?status=bogus`, { token: alice.token })).status).toBe(400);
    expect((await api("GET", `/boards/${board.id}/tasks?assignee=bogus`, { token: alice.token })).status).toBe(400);
  });

  it("never leaks tasks from a board the caller isn't on", async () => {
    const { board } = await seeded();
    const mallory = await registerUser();
    expect((await api("GET", `/boards/${board.id}/tasks`, { token: mallory.token })).status).toBe(403);
  });
});

describe("PATCH /tasks/:id", () => {
  it("moves a task between statuses", async () => {
    const { alice, board } = await setup();
    const task = await createTask(alice, board.id, { title: "Move me" });

    const res = await api("PATCH", `/tasks/${task.id}`, { token: alice.token, body: { status: "done" } });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ id: task.id, title: "Move me", status: "done" });
  });

  it("lets any board member edit any task, and updates only the fields sent", async () => {
    const { alice, bob, board } = await setup();
    const task = await createTask(alice, board.id, { title: "Keep", status: "in_progress", dueDate: "2026-12-01" });

    const res = await api("PATCH", `/tasks/${task.id}`, { token: bob.token, body: { assigneeId: bob.id } });
    const updated = await json(res);
    expect(updated).toMatchObject({ title: "Keep", status: "in_progress", dueDate: "2026-12-01", assigneeId: bob.id });
    expect(updated.assignee.name).toBe("Bob");
  });

  it("can clear the assignee and due date with null", async () => {
    const { alice, board } = await setup();
    const task = await createTask(alice, board.id, { title: "T", assigneeId: alice.id, dueDate: "2026-12-01" });
    const res = await api("PATCH", `/tasks/${task.id}`, { token: alice.token, body: { assigneeId: null, dueDate: null } });
    expect(await json(res)).toMatchObject({ assigneeId: null, dueDate: null, assignee: null });
  });

  it("returns 401 without a token, 404 for unknown tasks, 403 for non-members", async () => {
    const { alice, board } = await setup();
    const mallory = await registerUser();
    const task = await createTask(alice, board.id, { title: "T" });

    expect((await api("PATCH", `/tasks/${task.id}`, { body: { status: "done" } })).status).toBe(401);
    expect((await api("PATCH", `/tasks/${crypto.randomUUID()}`, { token: alice.token, body: { status: "done" } })).status).toBe(404);
    expect((await api("PATCH", "/tasks/not-a-uuid", { token: alice.token, body: { status: "done" } })).status).toBe(404);

    const forbidden = await api("PATCH", `/tasks/${task.id}`, { token: mallory.token, body: { status: "done" } });
    expect(forbidden.status).toBe(403);
    // …and the write really didn't happen
    const still = await json(await api("GET", `/boards/${board.id}/tasks`, { token: alice.token }));
    expect(still.tasks[0].status).toBe("todo");
  });

  it("validates the body and rejects empty updates", async () => {
    const { alice, board } = await setup();
    const task = await createTask(alice, board.id, { title: "T" });
    const patch = (body: unknown) => api("PATCH", `/tasks/${task.id}`, { token: alice.token, body });

    expect((await patch({})).status).toBe(400);
    expect((await patch({ status: "nope" })).status).toBe(400);
    expect((await patch({ title: "" })).status).toBe(400);
  });

  it("ignores attempts to change protected fields like boardId or id (mass assignment)", async () => {
    const { alice, board } = await setup();
    const other = await createBoard(alice, "Other");
    const task = await createTask(alice, board.id, { title: "T" });

    const res = await api("PATCH", `/tasks/${task.id}`, {
      token: alice.token,
      body: { title: "Renamed", boardId: other.id, id: crypto.randomUUID() },
    });
    expect(res.status).toBe(200);
    const updated = await json(res);
    expect(updated.id).toBe(task.id);
    expect(updated.boardId).toBe(board.id);
    expect(updated.title).toBe("Renamed");
  });

  it("won't assign to someone outside the board", async () => {
    const { alice, board } = await setup();
    const outsider = await registerUser();
    const task = await createTask(alice, board.id, { title: "T" });
    const res = await api("PATCH", `/tasks/${task.id}`, { token: alice.token, body: { assigneeId: outsider.id } });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("ASSIGNEE_NOT_MEMBER");
  });

  it("survives several people editing the same task at once on the real database", async () => {
    const { alice, bob, board } = await setup();
    const task = await createTask(alice, board.id, { title: "Contested" });

    const results = await Promise.all([
      api("PATCH", `/tasks/${task.id}`, { token: alice.token, body: { status: "in_progress" } }),
      api("PATCH", `/tasks/${task.id}`, { token: bob.token, body: { assigneeId: bob.id } }),
      api("PATCH", `/tasks/${task.id}`, { token: alice.token, body: { dueDate: "2026-12-24" } }),
      api("PATCH", `/tasks/${task.id}`, { token: bob.token, body: { title: "Contested (renamed)" } }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);

    // Different fields don't clobber each other: every change is present.
    const final = (await json(await api("GET", `/boards/${board.id}/tasks`, { token: alice.token }))).tasks[0];
    expect(final).toMatchObject({
      title: "Contested (renamed)",
      status: "in_progress",
      assigneeId: bob.id,
      dueDate: "2026-12-24",
    });
  });
});

describe("DELETE /tasks/:id", () => {
  it("deletes a task for any board member; 403 for outsiders; 404 afterwards", async () => {
    const { alice, bob, board } = await setup();
    const mallory = await registerUser();
    const task = await createTask(alice, board.id, { title: "Doomed" });

    expect((await api("DELETE", `/tasks/${task.id}`, { token: mallory.token })).status).toBe(403);
    expect((await api("DELETE", `/tasks/${task.id}`, { token: bob.token })).status).toBe(204);
    expect((await api("DELETE", `/tasks/${task.id}`, { token: bob.token })).status).toBe(404);
  });
});
