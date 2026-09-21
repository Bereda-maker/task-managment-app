/** Today as "YYYY-MM-DD" in the user's local timezone. */
export function todayString(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** A task is overdue when its due date has passed and it isn't done. ISO dates compare correctly as strings. */
export function isOverdue(dueDate: string | null, status: string, today: string = todayString()): boolean {
  return dueDate !== null && status !== "done" && dueDate < today;
}

/** "2026-03-09" -> "Mar 9" (adds the year when it isn't the current one). */
export function formatDueDate(dueDate: string, now: Date = new Date()): string {
  const [y, m, d] = dueDate.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d); // local date; avoids the UTC off-by-one of new Date("YYYY-MM-DD")
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(y !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1]![0] : "";
  return (first + last).toUpperCase();
}
