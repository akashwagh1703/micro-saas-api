-- user_workflow_states was in schema.prisma but never migrated on some production DBs.
-- Create the table when missing, then apply tenant scoping (user_id + phone_number).

CREATE TABLE IF NOT EXISTS "user_workflow_states" (
    "id" SERIAL NOT NULL,
    "phone_number" VARCHAR(20) NOT NULL,
    "workflow_id" INTEGER NOT NULL,
    "current_node_id" VARCHAR(100) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "last_message_sent_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_workflow_states_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "user_workflow_states" ADD COLUMN IF NOT EXISTS "user_id" INTEGER;

UPDATE "user_workflow_states" uws
SET "user_id" = w."user_id"
FROM "workflows" w
WHERE uws."workflow_id" = w."id"
  AND uws."user_id" IS NULL;

DELETE FROM "user_workflow_states" WHERE "user_id" IS NULL;

DROP INDEX IF EXISTS "user_workflow_states_phone_number_key";

ALTER TABLE "user_workflow_states" ALTER COLUMN "user_id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_workflow_states_user_id_fkey'
  ) THEN
    ALTER TABLE "user_workflow_states"
      ADD CONSTRAINT "user_workflow_states_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "user_workflow_states_user_id_phone_number_key"
  ON "user_workflow_states"("user_id", "phone_number");

CREATE INDEX IF NOT EXISTS "user_workflow_states_user_id_idx"
  ON "user_workflow_states"("user_id");

CREATE INDEX IF NOT EXISTS "user_workflow_states_phone_number_idx"
  ON "user_workflow_states"("phone_number");

CREATE INDEX IF NOT EXISTS "user_workflow_states_workflow_id_idx"
  ON "user_workflow_states"("workflow_id");
