-- Enforce idempotent inbound messages: a given provider message id can only be
-- stored once per tenant. Prevents duplicate bot/workflow triggers when Meta
-- retries webhook deliveries. NULL ids (outgoing messages) are exempt because
-- Postgres allows multiple NULLs in a unique index.

-- 1) Remove any pre-existing duplicates, keeping the earliest row per id.
DELETE FROM "messages" m
USING "messages" dup
WHERE m."user_id" = dup."user_id"
  AND m."wa_message_id" = dup."wa_message_id"
  AND m."wa_message_id" IS NOT NULL
  AND m."id" > dup."id";

DELETE FROM "messages" m
USING "messages" dup
WHERE m."user_id" = dup."user_id"
  AND m."external_message_id" = dup."external_message_id"
  AND m."external_message_id" IS NOT NULL
  AND m."id" > dup."id";

-- 2) Replace the non-unique lookup indexes with unique constraints.
DROP INDEX IF EXISTS "messages_user_id_wa_message_id_idx";
DROP INDEX IF EXISTS "messages_user_id_external_message_id_idx";

CREATE UNIQUE INDEX "messages_user_id_wa_message_id_key"
  ON "messages" ("user_id", "wa_message_id");

CREATE UNIQUE INDEX "messages_user_id_external_message_id_key"
  ON "messages" ("user_id", "external_message_id");
