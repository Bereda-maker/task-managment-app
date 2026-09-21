/**
 * Makes the N+1 cost VISIBLE rather than asserted.
 *
 *   DATABASE_URL=postgres://... bun scripts/n-plus-one.ts [taskCount]
 *
 * Seeds a throwaway board, loads its tasks-with-assignee-names two ways while counting the
 * SQL statements each one sends, then deletes everything it created.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { boardMembers, boards, tasks, users } from "../src/db/schema";
import { listBoardTasks } from "../src/lib/tasks";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const TASK_COUNT = Number(process.argv[2] ?? 50);

let queries = 0;
const client = postgres(url, { debug: () => void queries++, onnotice: () => {} });
const db = drizzle(client, { schema });

const stamp = Date.now();
const people = await db
  .insert(users)
  .values(["Ada", "Grace", "Linus", "Margaret", "Dennis"].map((n) => ({ name: n, email: `${n.toLowerCase()}-${stamp}@demo.local`, passwordHash: "x" })))
  .returning();

try {
  const [board] = await db.insert(boards).values({ name: "N+1 demo", ownerId: people[0]!.id }).returning();
  await db.insert(boardMembers).values(people.map((p, i) => ({ boardId: board!.id, userId: p.id, role: i === 0 ? ("owner" as const) : ("member" as const) })));
  await db.insert(tasks).values(
    Array.from({ length: TASK_COUNT }, (_, i) => ({ boardId: board!.id, title: `Task ${i + 1}`, assigneeId: people[i % people.length]!.id })),
  );

  // ---- Naive: one query for the tasks, then one MORE per task for its assignee ----
  queries = 0;
  let t0 = performance.now();
  const rows = await db.select().from(tasks).where(eq(tasks.boardId, board!.id));
  const naive = [];
  for (const task of rows) {
    const [assignee] = task.assigneeId
      ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, task.assigneeId))
      : [];
    naive.push({ ...task, assignee: assignee ?? null });
  }
  const naiveMs = performance.now() - t0;
  const naiveQueries = queries;

  // ---- What the API actually does: one relational query, assignee joined in SQL ----
  queries = 0;
  t0 = performance.now();
  const joined = await listBoardTasks(board!.id, { sort: "created" }, db);
  const joinedMs = performance.now() - t0;
  const joinedQueries = queries;

  console.log(`\nLoading ${TASK_COUNT} tasks with each assignee's name\n`);
  console.log(`  naive  (loop + query per task): ${String(naiveQueries).padStart(4)} queries  ${naiveMs.toFixed(1).padStart(7)} ms`);
  console.log(`  joined (Drizzle relational)   : ${String(joinedQueries).padStart(4)} queries  ${joinedMs.toFixed(1).padStart(7)} ms\n`);
  // Compare by task id: the naive query has no ORDER BY, so row order is not comparable.
  const byId = (list: { id: string; assignee: { name: string } | null }[]) =>
    JSON.stringify(list.map((t) => [t.id, t.assignee?.name ?? null]).sort());
  console.log(`Same tasks and same assignee names? ${byId(naive) === byId(joined)}\n`);
} finally {
  // Cascades remove the board, memberships and tasks.
  for (const p of people) await db.delete(users).where(eq(users.id, p.id));
  await client.end();
}
