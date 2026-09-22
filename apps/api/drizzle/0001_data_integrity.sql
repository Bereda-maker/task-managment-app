CREATE UNIQUE INDEX "board_members_one_owner_idx" ON "board_members" USING btree ("board_id") WHERE "board_members"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "refresh_tokens_expires_idx" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "board_members" ADD CONSTRAINT "board_members_role_valid" CHECK ("board_members"."role" in ('owner', 'member'));--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_name_length" CHECK (char_length(btrim("boards"."name")) between 1 and 80);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_valid" CHECK ("tasks"."status" in ('todo', 'in_progress', 'done'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_title_length" CHECK (char_length(btrim("tasks"."title")) between 1 and 200);