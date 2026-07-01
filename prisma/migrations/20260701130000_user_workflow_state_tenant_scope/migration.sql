-- Scope user workflow state per tenant (user_id + phone_number)
ALTER TABLE "user_workflow_states" ADD COLUMN IF NOT EXISTS "user_id" INTEGER;

UPDATE "user_workflow_states" uws
SET "user_id" = w."user_id"
FROM "workflows" w
WHERE uws."workflow_id" = w."id"
  AND uws."user_id" IS NULL;

DELETE FROM "user_workflow_states" WHERE "user_id" IS NULL;

DROP INDEX IF EXISTS "user_workflow_states_phone_number_key";

ALTER TABLE "user_workflow_states" ALTER COLUMN "user_id" SET NOT NULL;

ALTER TABLE "user_workflow_states"
  ADD CONSTRAINT "user_workflow_states_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "user_workflow_states_user_id_phone_number_key"
  ON "user_workflow_states"("user_id", "phone_number");

CREATE INDEX IF NOT EXISTS "user_workflow_states_user_id_idx"
  ON "user_workflow_states"("user_id");
