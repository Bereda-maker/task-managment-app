# Performance: the N+1 query

Showing a board means loading every task **with its assignee's name**.

## The naive version — 1 + N queries

```ts
const rows = await db.select().from(tasks).where(eq(tasks.boardId, boardId));   // 1 query
for (const task of rows) {
  const [assignee] = await db.select().from(users).where(eq(users.id, task.assigneeId)); // N more
}
```

## What the API does — 1 query

```ts
db.query.tasks.findMany({
  where: (t, { eq }) => eq(t.boardId, boardId),
  with: { assignee: { columns: { id: true, name: true, email: true } } },  // joined in SQL
});
```

(`apps/api/src/lib/tasks.ts`. `columns` also guarantees `passwordHash` never leaves the database.)

## Measured, not asserted

`bun run --filter @taskboard/api demo:n-plus-one [taskCount]` seeds a throwaway board, runs both versions, counts the SQL statements each sends (via the driver's debug hook) and cleans up. Output on a local Postgres:

```
Loading 50 tasks with each assignee's name
  naive  (loop + query per task):   51 queries     53.3 ms
  joined (Drizzle relational)   :    1 queries      5.1 ms
Same tasks and same assignee names? true

Loading 200 tasks with each assignee's name
  naive  (loop + query per task):  201 queries    127.5 ms
  joined (Drizzle relational)   :    1 queries     13.0 ms
```

The absolute milliseconds are tiny because the database is on localhost. Over a real network each of those extra queries pays a full round-trip, so the gap widens. The query **count** is the number to watch: it grows with the board for the naive version and stays at 1 for the joined one.

## Related choices

- Indexes on `tasks(board_id)`, `tasks(assignee_id)`, `board_members(user_id)` back the board, filter and membership lookups.
- The SPA polls every 10 s; `placeholderData: keepPreviousData` avoids blank lanes when a filter changes.
