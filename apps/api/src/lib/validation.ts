import type { Context } from "hono";
import { z } from "zod";
import { TASK_STATUSES } from "../db/schema";
import { badRequest, notFound } from "../errors";

// ---------- Primitives (mirrored by apps/web/src/lib/schemas.ts) ----------

const isRealDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** A calendar date as "YYYY-MM-DD" that actually exists (rejects 2026-02-31). */
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine(isRealDate, "That date doesn't exist");

// bcrypt only uses the first 72 BYTES of a password; refuse longer ones rather than
// silently truncating them.
const MAX_PASSWORD_BYTES = 72;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email is too long")
  .pipe(z.email("Enter a valid email address"));

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .refine(
    (v) => new TextEncoder().encode(v).length <= MAX_PASSWORD_BYTES,
    `Password must be at most ${MAX_PASSWORD_BYTES} bytes`,
  );

// ---------- Auth ----------

export const RegisterBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Name is too long"),
  email: emailSchema,
  password: passwordSchema,
});

export const LoginBody = z.object({
  email: emailSchema,
  // Don't re-apply strength rules on login — just make sure something was sent.
  password: z.string().min(1, "Password is required").max(200),
});

// ---------- Boards ----------

export const CreateBoard = z.object({
  name: z.string().trim().min(1, "Board name is required").max(80, "Board name is too long"),
});

export const AddMember = z.object({ email: emailSchema });

// ---------- Tasks ----------

const title = z.string().trim().min(1, "Title is required").max(200, "Title is too long");
const status = z.enum(TASK_STATUSES);

// NOTE: defaults live ONLY on the create schema. In Zod 4 a `.default()` inside a partial
// would fire on every PATCH and silently reset fields — so UpdateTask is spelled out.
export const CreateTask = z.object({
  title,
  status: status.default("todo"),
  assigneeId: z.uuid().nullable().optional(),
  dueDate: dateString.nullable().optional(),
});

export const UpdateTask = z
  .object({
    title: title.optional(),
    status: status.optional(),
    assigneeId: z.uuid().nullable().optional(),
    dueDate: dateString.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");

export const TaskQuery = z.object({
  status: status.optional(),
  // "me" and "unassigned" are conveniences; otherwise a specific user's id.
  assignee: z.union([z.literal("me"), z.literal("unassigned"), z.uuid()]).optional(),
  sort: z.enum(["created", "dueDate"]).default("created"),
});

// ---------- Helpers ----------

/** Parses a JSON body with a Zod schema. Malformed JSON and schema failures both become 400s. */
export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("Request body must be valid JSON", "INVALID_JSON");
  }
  return schema.parse(raw);
}

export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  return schema.parse(c.req.query());
}

/** A malformed id can never match a row, so treat it as "not found" rather than a DB error. */
export function requireUuid(value: string | undefined, what = "Resource"): string {
  if (!value || !z.uuid().safeParse(value).success) throw notFound(`${what} not found`);
  return value;
}
