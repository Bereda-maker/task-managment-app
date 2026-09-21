import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { tasks } from "../db/schema";
import { notFound } from "../errors";
import { requireBoardMember } from "../lib/boardAccess";
import { assertAssigneeIsMember, loadTask } from "../lib/tasks";
import { UpdateTask, parseBody, requireUuid } from "../lib/validation";
import { authMiddleware } from "../middleware/auth";
import type { AppEnv } from "../types";

export const taskRoutes = new Hono<AppEnv>();

taskRoutes.use("*", authMiddleware);

/**
 * The shape every write endpoint follows, in this order:
 *   1. authenticate            (authMiddleware)
 *   2. look up the resource    (404 if missing)
 *   3. check the caller may touch it   (403 if not a board member)
 *   4. apply the change
 */
taskRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const taskId = requireUuid(c.req.param("id"), "Task");
  const body = await parseBody(c, UpdateTask);

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw notFound("Task not found");

  await requireBoardMember(task.boardId, userId);
  if (body.assigneeId) await assertAssigneeIsMember(task.boardId, body.assigneeId);

  // `body` only contains keys the client sent (unknown keys were stripped by Zod, so a client
  // can't move a task to another board by sending boardId).
  await db
    .update(tasks)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(tasks.id, taskId));

  return c.json(await loadTask(taskId));
});

taskRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const taskId = requireUuid(c.req.param("id"), "Task");

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw notFound("Task not found");

  await requireBoardMember(task.boardId, userId);
  await db.delete(tasks).where(eq(tasks.id, taskId));
  return c.body(null, 204);
});
