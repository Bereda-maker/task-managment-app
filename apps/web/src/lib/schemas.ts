/**
 * Client-side mirror of the API's Zod schemas (apps/api/src/lib/validation.ts), used through
 * React Hook Form's Zod resolver so people see errors instantly. The server re-validates
 * everything independently — this is a convenience, never a security boundary.
 */
import { z } from "zod";
import { TASK_STATUSES } from "./types";

export const isRealDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email is too long")
  .pipe(z.email("Enter a valid email address"));

const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .refine((v) => new TextEncoder().encode(v).length <= 72, "Password must be at most 72 bytes");

export const LoginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required"),
});

export const RegisterSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Name is too long"),
  email,
  password,
});

export const BoardSchema = z.object({
  name: z.string().trim().min(1, "Board name is required").max(80, "Board name is too long"),
});

export const AddMemberSchema = z.object({ email });

export const TaskFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
  status: z.enum(TASK_STATUSES),
  /** "" means unassigned (an empty <select> value) */
  assigneeId: z.string(),
  /** "" means no due date (an empty <input type="date"> value) */
  dueDate: z.string().refine((v) => v === "" || isRealDate(v), "Enter a valid date"),
});

export type LoginValues = z.output<typeof LoginSchema>;
export type RegisterValues = z.output<typeof RegisterSchema>;
export type TaskFormValues = z.output<typeof TaskFormSchema>;
