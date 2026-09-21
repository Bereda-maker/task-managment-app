import { beforeEach, describe, expect, it } from "bun:test";
import { addMember, api, createBoard, createTask, json, registerUser, resetDb } from "./helpers";

beforeEach(resetDb);

describe("boards", () => {
  it("creates a board and makes the creator its owner-member", async () => {
    const alice = await registerUser("Alice");
    const res = await api("POST", "/boards", { token: alice.token, body: { name: "  Launch  " } });
    expect(res.status).toBe(201);
    const board = await json(res);
    expect(board).toMatchObject({ name: "Launch", ownerId: alice.id, role: "owner", memberCount: 1 });

    const detail = await json(await api("GET", `/boards/${board.id}`, { token: alice.token }));
    expect(detail.members).toEqual([{ id: alice.id, name: "Alice", email: alice.email, role: "owner" }]);
  });

  it("requires authentication and a board name", async () => {
    expect((await api("POST", "/boards", { body: { name: "x" } })).status).toBe(401);
    const alice = await registerUser();
    const res = await api("POST", "/boards", { token: alice.token, body: { name: "   " } });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("VALIDATION_ERROR");
  });

  it("lists only the boards the caller belongs to", async () => {
    const alice = await registerUser("Alice");
    const bob = await registerUser("Bob");
    const shared = await createBoard(alice, "Shared");
    await createBoard(alice, "Alice only");
    await createBoard(bob, "Bob only");
    await addMember(alice, shared.id, bob);

    const aliceBoards = (await json(await api("GET", "/boards", { token: alice.token }))).boards;
    expect(aliceBoards.map((b: any) => b.name)).toEqual(["Shared", "Alice only"]);

    const bobBoards = (await json(await api("GET", "/boards", { token: bob.token }))).boards;
    expect(bobBoards.map((b: any) => [b.name, b.role, b.memberCount])).toEqual([
      ["Shared", "member", 2],
      ["Bob only", "owner", 1],
    ]);
  });

  it("forbids non-members from reading a board (403) and 404s unknown or malformed ids", async () => {
    const alice = await registerUser();
    const mallory = await registerUser();
    const board = await createBoard(alice);

    expect((await api("GET", `/boards/${board.id}`, { token: mallory.token })).status).toBe(403);
    expect((await api("GET", `/boards/${board.id}/tasks`, { token: mallory.token })).status).toBe(403);
    expect((await api("GET", `/boards/${crypto.randomUUID()}`, { token: alice.token })).status).toBe(404);
    expect((await api("GET", "/boards/not-a-uuid", { token: alice.token })).status).toBe(404);
  });
});

describe("board membership", () => {
  it("lets the owner add a registered teammate by email, who can then see the board", async () => {
    const alice = await registerUser("Alice");
    const bob = await registerUser("Bob");
    const board = await createBoard(alice);

    const res = await api("POST", `/boards/${board.id}/members`, {
      token: alice.token,
      body: { email: bob.email.toUpperCase() },
    });
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({ id: bob.id, name: "Bob", role: "member" });

    expect((await api("GET", `/boards/${board.id}`, { token: bob.token })).status).toBe(200);
  });

  it("rejects unknown emails (404) and duplicates (409)", async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const board = await createBoard(alice);

    const unknown = await api("POST", `/boards/${board.id}/members`, { token: alice.token, body: { email: "ghost@example.com" } });
    expect(unknown.status).toBe(404);
    expect((await json(unknown)).code).toBe("USER_NOT_FOUND");

    await addMember(alice, board.id, bob);
    const dup = await api("POST", `/boards/${board.id}/members`, { token: alice.token, body: { email: bob.email } });
    expect(dup.status).toBe(409);
    expect((await json(dup)).code).toBe("ALREADY_MEMBER");
  });

  it("only the owner can add members or delete the board; members can't", async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const carol = await registerUser();
    const board = await createBoard(alice);
    await addMember(alice, board.id, bob);

    const add = await api("POST", `/boards/${board.id}/members`, { token: bob.token, body: { email: carol.email } });
    expect(add.status).toBe(403);
    expect((await api("DELETE", `/boards/${board.id}`, { token: bob.token })).status).toBe(403);
    expect((await api("GET", `/boards/${board.id}`, { token: bob.token })).status).toBe(200); // still exists

    expect((await api("DELETE", `/boards/${board.id}`, { token: alice.token })).status).toBe(204);
    expect((await api("GET", `/boards/${board.id}`, { token: alice.token })).status).toBe(404);
  });

  it("deleting a board cascades to its tasks and memberships", async () => {
    const alice = await registerUser();
    const board = await createBoard(alice);
    await createTask(alice, board.id, { title: "One" });
    await api("DELETE", `/boards/${board.id}`, { token: alice.token });

    const { sql } = await import("../src/db/client");
    expect((await sql`select 1 from tasks`).length).toBe(0);
    expect((await sql`select 1 from board_members`).length).toBe(0);
  });

  it("removing a member unassigns their tasks; members can leave; the owner can't", async () => {
    const alice = await registerUser("Alice");
    const bob = await registerUser("Bob");
    const board = await createBoard(alice);
    await addMember(alice, board.id, bob);
    const task = await createTask(alice, board.id, { title: "Bob's task", assigneeId: bob.id });
    expect(task.assignee?.name).toBe("Bob");

    // Bob leaves on his own
    expect((await api("DELETE", `/boards/${board.id}/members/${bob.id}`, { token: bob.token })).status).toBe(204);
    expect((await api("GET", `/boards/${board.id}`, { token: bob.token })).status).toBe(403);

    const tasks = (await json(await api("GET", `/boards/${board.id}/tasks`, { token: alice.token }))).tasks;
    expect(tasks[0].assigneeId).toBeNull();
    expect(tasks[0].assignee).toBeNull();

    const ownerLeaves = await api("DELETE", `/boards/${board.id}/members/${alice.id}`, { token: alice.token });
    expect(ownerLeaves.status).toBe(409);
    expect((await json(ownerLeaves)).code).toBe("OWNER_CANNOT_LEAVE");
  });

  it("a member can't remove somebody else", async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const carol = await registerUser();
    const board = await createBoard(alice);
    await addMember(alice, board.id, bob);
    await addMember(alice, board.id, carol);

    const res = await api("DELETE", `/boards/${board.id}/members/${carol.id}`, { token: bob.token });
    expect(res.status).toBe(403);
  });
});
