-- Availability engine (v4 Release B — Phase 5)

CREATE TABLE "service_resources" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_resources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "resource_schedules" (
    "id" SERIAL NOT NULL,
    "resource_id" INTEGER NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "slot_minutes" INTEGER NOT NULL DEFAULT 30,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bookings" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "resource_id" INTEGER NOT NULL,
    "contact_id" INTEGER,
    "conversation_id" INTEGER,
    "workflow_execution_id" INTEGER,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'confirmed',
    "service_label" VARCHAR(120),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_resources_user_id_is_active_idx" ON "service_resources"("user_id", "is_active");

CREATE INDEX "resource_schedules_resource_id_is_active_idx" ON "resource_schedules"("resource_id", "is_active");

CREATE UNIQUE INDEX "resource_schedules_resource_id_day_of_week_key" ON "resource_schedules"("resource_id", "day_of_week");

CREATE INDEX "bookings_user_id_starts_at_idx" ON "bookings"("user_id", "starts_at");

CREATE INDEX "bookings_resource_id_starts_at_idx" ON "bookings"("resource_id", "starts_at");

CREATE INDEX "bookings_user_id_status_idx" ON "bookings"("user_id", "status");

ALTER TABLE "service_resources" ADD CONSTRAINT "service_resources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "resource_schedules" ADD CONSTRAINT "resource_schedules_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "service_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "service_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_workflow_execution_id_fkey" FOREIGN KEY ("workflow_execution_id") REFERENCES "workflow_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
