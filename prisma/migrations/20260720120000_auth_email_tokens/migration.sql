-- Auth email tokens (verification + password reset)
CREATE TABLE IF NOT EXISTS "auth_email_tokens" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "type" VARCHAR(32) NOT NULL,
  "token_hash" VARCHAR(64) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "auth_email_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "auth_email_tokens_token_hash_key" ON "auth_email_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "auth_email_tokens_user_id_type_idx" ON "auth_email_tokens"("user_id", "type");

DO $$ BEGIN
  ALTER TABLE "auth_email_tokens"
    ADD CONSTRAINT "auth_email_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
