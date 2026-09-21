import { and, eq, sql } from "drizzle-orm";
import { db, type DB } from "../db/client";
import { boardMembers, type TaskStatus } from "../db/schema";
import { badRequest } from "../errors";

const assigneeColumns = { id: true, name: true, email: true } as const; // never passwordHash

/** One task with its assignee's public fields, in a single query. */
export async function loadTask(taskId: string) {
  return db.query.tasks.findFirst({
    where: (t, { eq }) => eq(t.id, taskId),
    with: { assignee: { columns: assigneeColumns } },
  });
}

export interface TaskFilters {
  status?: TaskStatus;
  assigneeId?: string | "unassigned";
  sort: "created" | "dueDate";
}

/**
 * All tasks on a board, each with its assignee's name.
 *
 * PERFORMANCE: this is a SINGLE round trip. Drizzle's relational query API joins the assignee
 * in SQL. The naive alternative — select tasks, then loop and fetch each assignee — costs
 * 1 + N queries. See docs/PERFORMANCE.md for the two side by side.
 */
export async function listBoardTasks(boardId: string, filters: TaskFilters, database: DB = db) {
  return database.query.tasks.findMany({
    where: (t, { and, eq, isNull }) =>
      and(
        eq(t.boardId, boardId),
        filters.status ? eq(t.status, filters.status) : undefined,
        filters.assigneeId === "unassigned"
          ? isNull(t.assigneeId)
          : filters.assigneeId
            ? eq(t.assigneeId, filters.assigneeId)
            : undefined,
      ),
    orderBy: (t, { asc }) =>
      filters.sort === "dueDate"
        ? [sql`${t.dueDate} asc nulls last`, asc(t.createdAt), asc(t.id)]
        : [asc(t.createdAt), asc(t.id)],
    with: { assignee: { columns: assigneeColumns } },
  });
}

/** Tasks may only be assigned to people who can actually see the board. */
export async function assertAssigneeIsMember(boardId: string, assigneeId: string) {
  const [row] = await db
    .select({ userId: boardMembers.userId })
    .from(boardMembers)
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, assigneeId)))
    .limit(1);
  if (!row) {
    throw badRequest("Assignee must be a member of this board", "ASSIGNEE_NOT_MEMBER");
  }
}
