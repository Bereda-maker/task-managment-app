import { and, asc, count, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { config } from "../config";
import { db } from "../db/client";
import { boardMembers, boards, tasks, users } from "../db/schema";
import { conflict, forbidden, notFound } from "../errors";
import { requireBoardMember, requireBoardOwner } from "../lib/boardAccess";
import { assertAssigneeIsMember, listBoardTasks, loadTask } from "../lib/tasks";
import {
  AddMember,
  CreateBoard,
  CreateTask,
  TaskQuery,
  parseBody,
  parseQuery,
  requireUuid,
} from "../lib/validation";
import { authMiddleware } from "../middleware/auth";
import type { AppEnv } from "../types";

export const boardRoutes = new Hono<AppEnv>();

// Every board endpoint requires a logged-in user. Applied at the router level so a new
// route can't accidentally ship without it.
boardRoutes.use("*", authMiddleware);

/** Boards the caller belongs to (owned or shared with them). */
boardRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const rows = await db
    .select({
      id: boards.id,
      name: boards.name,
      ownerId: boards.ownerId,
      createdAt: boards.createdAt,
      role: boardMembers.role,
      memberCount: sql<number>`(select count(*)::int from board_members bm where bm.board_id = ${boards.id})`,
    })
    .from(boardMembers)
    .innerJoin(boards, eq(boards.id, boardMembers.boardId))
    .where(eq(boardMembers.userId, userId))
    .orderBy(asc(boards.createdAt), asc(boards.id));
  return c.json({ boards: rows });
});

boardRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await parseBody(c, CreateBoard);

  const board = await db.transaction(async (tx) => {
    const [created] = await tx.insert(boards).values({ name: body.name, ownerId: userId }).returning();
    await tx.insert(boardMembers).values({ boardId: created!.id, userId, role: "owner" });
    return created!;
  });

  return c.json({ ...board, role: "owner" as const, memberCount: 1 }, 201);
});

/** Board details plus its member list (used to populate the assignee dropdown). */
boardRoutes.get("/:id", async (c) => {
  const userId = c.get("userId");
  const boardId = requireUuid(c.req.param("id"), "Board");
  const membership = await requireBoardMember(boardId, userId);

  const [board] = await db.select().from(boards).where(eq(boards.id, boardId)).limit(1);
  if (!board) throw notFound("Board not found");

  const members = await db
    .select({ id: users.id, name: users.name, email: users.email, role: boardMembers.role })
    .from(boardMembers)
    .innerJoin(users, eq(users.id, boardMembers.userId))
    .where(eq(boardMembers.boardId, boardId))
    .orderBy(asc(boardMembers.createdAt), asc(users.name));

  return c.json({ ...board, role: membership.role, members });
});

/** Only the owner can delete a board (tasks and memberships cascade). */
boardRoutes.delete("/:id", async (c) => {
  const boardId = requireUuid(c.req.param("id"), "Board");
  await requireBoardOwner(boardId, c.get("userId"));
  await db.delete(boards).where(eq(boards.id, boardId));
  return c.body(null, 204);
});

// ---------- Membership ----------

/** Owner invites a registered teammate by email. */
boardRoutes.post("/:id/members", async (c) => {
  const boardId = requireUuid(c.req.param("id"), "Board");
  const body = await parseBody(c, AddMember);
  await requireBoardOwner(boardId, c.get("userId"));

  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.email, body.email))
    .limit(1);
  if (!user) {
    throw notFound("No registered user with that email. Ask them to sign up first.", "USER_NOT_FOUND");
  }

  const inserted = await db
    .insert(boardMembers)
    .values({ boardId, userId: user.id, role: "member" })
    .onConflictDoNothing()
    .returning({ userId: boardMembers.userId });
  if (inserted.length === 0) throw conflict("That person is already on this board", "ALREADY_MEMBER");

  return c.json({ ...user, role: "member" as const }, 201);
});

/** Owner removes a teammate, or any non-owner member leaves. Their tasks become unassigned. */
boardRoutes.delete("/:id/members/:userId", async (c) => {
  const callerId = c.get("userId");
  const boardId = requireUuid(c.req.param("id"), "Board");
  const targetId = requireUuid(c.req.param("userId"), "Member");

  const caller = await requireBoardMember(boardId, callerId);
  if (targetId !== callerId && caller.role !== "owner") {
    throw forbidden("Only the board owner can remove other members");
  }

  const [target] = await db
    .select({ role: boardMembers.role })
    .from(boardMembers)
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, targetId)))
    .limit(1);
  if (!target) throw notFound("Member not found");
  if (target.role === "owner") {
    throw conflict("The owner can't leave their own board. Delete the board instead.", "OWNER_CANNOT_LEAVE");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({ assigneeId: null, updatedAt: new Date() })
      .where(and(eq(tasks.boardId, boardId), eq(tasks.assigneeId, targetId)));
    await tx
      .delete(boardMembers)
      .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, targetId)));
  });
  return c.body(null, 204);
});

// ---------- Tasks on a board ----------

/** ?status=todo|in_progress|done  &assignee=me|unassigned|<userId>  &sort=created|dueDate */
boardRoutes.get("/:id/tasks", async (c) => {
  const userId = c.get("userId");
  const boardId = requireUuid(c.req.param("id"), "Board");
  const query = parseQuery(c, TaskQuery);
  await requireBoardMember(boardId, userId);

  const list = await listBoardTasks(boardId, {
    status: query.status,
    assigneeId: query.assignee === "me" ? userId : query.assignee,
    sort: query.sort,
  });
  return c.json({ tasks: list });
});

boardRoutes.post("/:id/tasks", async (c) => {
  const userId = c.get("userId");
  const boardId = requireUuid(c.req.param("id"), "Board");
  const body = await parseBody(c, CreateTask);
  await requireBoardMember(boardId, userId);
  if (body.assigneeId) await assertAssigneeIsMember(boardId, body.assigneeId);

  // The board endpoint returns every task, so the number per board is bounded (soft limit:
  // two simultaneous creates at the boundary can overshoot by a task or two, which is fine).
  const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(tasks).where(eq(tasks.boardId, boardId));
  if (total >= config.MAX_TASKS_PER_BOARD) {
    throw conflict(
      `This board has reached its limit of ${config.MAX_TASKS_PER_BOARD} tasks. Delete finished tasks or start a new board.`,
      "TASK_LIMIT_REACHED",
    );
  }

  const [created] = await db
    .insert(tasks)
    .values({
      boardId,
      title: body.title,
      status: body.status,
      assigneeId: body.assigneeId ?? null,
      dueDate: body.dueDate ?? null,
    })
    .returning({ id: tasks.id });

  return c.json(await loadTask(created!.id), 201);
});
