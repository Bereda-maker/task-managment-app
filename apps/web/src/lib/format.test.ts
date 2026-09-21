import { describe, expect, it } from "vitest";
import { formatDueDate, initials, isOverdue, todayString } from "./format";
import { TaskFormSchema, RegisterSchema, isRealDate } from "./schemas";

describe("dates", () => {
  it("todayString uses the local calendar date", () => {
    expect(todayString(new Date(2026, 2, 9, 23, 59))).toBe("2026-03-09");
  });

  it("isOverdue: past + not done only", () => {
    expect(isOverdue("2026-03-08", "todo", "2026-03-09")).toBe(true);
    expect(isOverdue("2026-03-08", "in_progress", "2026-03-09")).toBe(true);
    expect(isOverdue("2026-03-08", "done", "2026-03-09")).toBe(false); // finished work isn't late
    expect(isOverdue("2026-03-09", "todo", "2026-03-09")).toBe(false); // due today isn't overdue yet
    expect(isOverdue("2026-03-10", "todo", "2026-03-09")).toBe(false);
    expect(isOverdue(null, "todo", "2026-03-09")).toBe(false);
  });

  it("formatDueDate doesn't shift the day across timezones", () => {
    const now = new Date(2026, 5, 1);
    expect(formatDueDate("2026-03-09", now)).toBe(new Date(2026, 2, 9).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    expect(formatDueDate("2027-01-01", now)).toContain("2027");
  });

  it("initials", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("  grace ")).toBe("G");
    expect(initials("Mary Ann Evans")).toBe("ME");
  });
});

describe("client-side schemas mirror the API", () => {
  it("rejects dates that don't exist", () => {
    expect(isRealDate("2026-02-28")).toBe(true);
    expect(isRealDate("2026-02-31")).toBe(false);
    expect(isRealDate("2026-13-01")).toBe(false);
    expect(isRealDate("soon")).toBe(false);
  });

  it("task form: trims titles, allows blank due date/assignee, rejects bad dates", () => {
    const ok = TaskFormSchema.safeParse({ title: "  Hi  ", status: "todo", assigneeId: "", dueDate: "" });
    expect(ok.success && ok.data.title).toBe("Hi");
    expect(TaskFormSchema.safeParse({ title: "", status: "todo", assigneeId: "", dueDate: "" }).success).toBe(false);
    expect(TaskFormSchema.safeParse({ title: "x", status: "todo", assigneeId: "", dueDate: "2026-02-31" }).success).toBe(false);
  });

  it("register: normalises email and enforces password length", () => {
    const ok = RegisterSchema.safeParse({ name: "A", email: "  A@B.io ", password: "12345678" });
    expect(ok.success && ok.data.email).toBe("a@b.io");
    expect(RegisterSchema.safeParse({ name: "A", email: "a@b.io", password: "short" }).success).toBe(false);
  });
});
