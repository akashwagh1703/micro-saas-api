-- Interactive message tables were in schema.prisma but never migrated on some production DBs.
-- Required for appointment booking pick_options / list_resources / list_slots nodes.

CREATE TABLE IF NOT EXISTS "interactive_message_types" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "max_options" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "interactive_message_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "interactive_message_types_name_key"
  ON "interactive_message_types"("name");

INSERT INTO "interactive_message_types" ("name", "description", "max_options")
VALUES
  ('QUICK_REPLY', 'Up to 3 quick reply buttons for instant responses', 3),
  ('LIST_MESSAGE', 'Dropdown-style list with up to 10 options', 10),
  ('FLOW_BUTTON', 'Single action button for external links or flows', 1)
ON CONFLICT ("name") DO NOTHING;

CREATE TABLE IF NOT EXISTS "interactive_message_templates" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "message_type_id" INTEGER NOT NULL,
    "header_text" VARCHAR(1000),
    "body_text" TEXT NOT NULL,
    "footer_text" VARCHAR(1000),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "interactive_message_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "interactive_message_templates_user_id_idx"
  ON "interactive_message_templates"("user_id");

CREATE INDEX IF NOT EXISTS "interactive_message_templates_message_type_id_idx"
  ON "interactive_message_templates"("message_type_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interactive_message_templates_user_id_fkey'
  ) THEN
    ALTER TABLE "interactive_message_templates"
      ADD CONSTRAINT "interactive_message_templates_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interactive_message_templates_message_type_id_fkey'
  ) THEN
    ALTER TABLE "interactive_message_templates"
      ADD CONSTRAINT "interactive_message_templates_message_type_id_fkey"
      FOREIGN KEY ("message_type_id") REFERENCES "interactive_message_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "interactive_message_options" (
    "id" SERIAL NOT NULL,
    "template_id" INTEGER NOT NULL,
    "option_text" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "next_node_id" VARCHAR(100),
    "display_order" INTEGER NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "interactive_message_options_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "interactive_message_options_template_id_idx"
  ON "interactive_message_options"("template_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interactive_message_options_template_id_fkey'
  ) THEN
    ALTER TABLE "interactive_message_options"
      ADD CONSTRAINT "interactive_message_options_template_id_fkey"
      FOREIGN KEY ("template_id") REFERENCES "interactive_message_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "workflow_nodes" (
    "id" SERIAL NOT NULL,
    "workflow_id" INTEGER NOT NULL,
    "node_id" VARCHAR(100) NOT NULL,
    "node_type" VARCHAR(50) NOT NULL,
    "message_type" VARCHAR(20) NOT NULL DEFAULT 'TEXT',
    "interactive_template_id" INTEGER,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workflow_nodes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_nodes_workflow_id_node_id_key"
  ON "workflow_nodes"("workflow_id", "node_id");

CREATE INDEX IF NOT EXISTS "workflow_nodes_workflow_id_idx"
  ON "workflow_nodes"("workflow_id");

CREATE INDEX IF NOT EXISTS "workflow_nodes_interactive_template_id_idx"
  ON "workflow_nodes"("interactive_template_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workflow_nodes_workflow_id_fkey'
  ) THEN
    ALTER TABLE "workflow_nodes"
      ADD CONSTRAINT "workflow_nodes_workflow_id_fkey"
      FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workflow_nodes_interactive_template_id_fkey'
  ) THEN
    ALTER TABLE "workflow_nodes"
      ADD CONSTRAINT "workflow_nodes_interactive_template_id_fkey"
      FOREIGN KEY ("interactive_template_id") REFERENCES "interactive_message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "button_click_analytics" (
    "id" SERIAL NOT NULL,
    "template_id" INTEGER NOT NULL,
    "option_id" INTEGER NOT NULL,
    "phone_number" VARCHAR(20) NOT NULL,
    "workflow_id" INTEGER NOT NULL,
    "clicked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "response_time_ms" INTEGER,
    CONSTRAINT "button_click_analytics_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "button_click_analytics_template_id_idx"
  ON "button_click_analytics"("template_id");

CREATE INDEX IF NOT EXISTS "button_click_analytics_option_id_idx"
  ON "button_click_analytics"("option_id");

CREATE INDEX IF NOT EXISTS "button_click_analytics_clicked_at_idx"
  ON "button_click_analytics"("clicked_at");
