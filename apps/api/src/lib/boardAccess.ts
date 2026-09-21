import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { boardMembers, boards, type BoardRole } from "../db/schema";
import { forbidden, notFound } from "../errors";

export interface Membership {
  boardId: string;
  userId: string;
  role: BoardRole;
}

/**
 * Step 3 of every board/task endpoint: "is the caller actually allowed to touch this?"
 * Throws 404 if the board doesn't exist, 403 if it does but the caller isn't a member.
 */
export async function requireBoardMember(boardId: string, userId: string): Promise<Membership> {
  const [membership] = await db
    .select({ boardId: boardMembers.boardId, userId: boardMembers.userId, role: boardMembers.role })
    .from(boardMembers)
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)))
    .limit(1);

  if (membership) return membership;

  // Only on the failure path: tell "no such board" apart from "not yours".
  const [board] = await db.select({ id: boards.id }).from(boards).where(eq(boards.id, boardId)).limit(1);
  if (!board) throw notFound("Board not found");
  throw forbidden("You are not a member of this board");
}

export async function requireBoardOwner(boardId: string, userId: string): Promise<Membership> {
  const membership = await requireBoardMember(boardId, userId);
  if (membership.role !== "owner") throw forbidden("Only the board owner can do that");
  return membership;
}

export async function isBoardMember(boardId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: boardMembers.userId })
    .from(boardMembers)
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)))
    .limit(1);
  return Boolean(row);
}
