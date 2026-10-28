CREATE TABLE "oidc_identity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_sub" text NOT NULL,
	"raw_profile" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passwords" (
	"user_id" text PRIMARY KEY,
	"password_hash" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"token_hash" text PRIMARY KEY,
	"family_id" text NOT NULL,
	"sid" text NOT NULL,
	"sub" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"used_at" bigint,
	"profile" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"username" text,
	"nickname" text,
	"avatar_url" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" integer NOT NULL,
	"transports" text,
	"display_name" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"code" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dutyAreas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"campusId" uuid NOT NULL,
	"name" text NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dutyCheckins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"campusId" uuid NOT NULL,
	"scheduleId" uuid NOT NULL,
	"dutyDate" text NOT NULL,
	"teacherId" uuid NOT NULL,
	"locationName" text NOT NULL,
	"timeSlotName" text,
	"situation" text,
	"photos" jsonb NOT NULL,
	"checkedInAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dutyInspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"campusId" uuid NOT NULL,
	"inspectorId" uuid NOT NULL,
	"inspectDate" text NOT NULL,
	"areaId" uuid NOT NULL,
	"items" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dutyLocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"campusId" uuid NOT NULL,
	"areaId" uuid NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dutySchedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"campusId" uuid NOT NULL,
	"kind" text DEFAULT 'teaching' NOT NULL,
	"areaId" uuid NOT NULL,
	"timeSlotId" uuid,
	"locationId" uuid,
	"dateStart" text NOT NULL,
	"dateEnd" text NOT NULL,
	"weekday" integer NOT NULL,
	"weekParity" text DEFAULT 'everyweek' NOT NULL,
	"countersign" integer DEFAULT 0 NOT NULL,
	"assigneeIds" jsonb NOT NULL,
	"note" text,
	CONSTRAINT "duty_schedules_kind_check" CHECK (kind IN ('teaching')),
	CONSTRAINT "duty_schedules_parity_check" CHECK (weekParity IN ('everyweek', 'odd', 'even'))
);
--> statement-breakpoint
CREATE TABLE "dutySwaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"campusId" uuid NOT NULL,
	"type" text NOT NULL,
	"applicantId" uuid NOT NULL,
	"applicantScheduleId" uuid NOT NULL,
	"applicantDate" text NOT NULL,
	"targetId" uuid NOT NULL,
	"targetScheduleId" uuid,
	"targetDate" text,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewerId" uuid,
	"reviewComment" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewedAt" bigint,
	CONSTRAINT "duty_swaps_type_check" CHECK (type IN ('swap', 'proxy')),
	CONSTRAINT "duty_swaps_status_check" CHECK (status IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "dutyTimeSlots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"campusId" uuid NOT NULL,
	"areaId" uuid NOT NULL,
	"name" text NOT NULL,
	"startMinute" integer,
	"endMinute" integer,
	"priority" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"campusId" uuid NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "userProfiles" (
	"userId" uuid PRIMARY KEY,
	"campusId" uuid NOT NULL,
	"displayName" text NOT NULL,
	"role" text NOT NULL,
	"canInspect" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_profiles_role_check" CHECK (role IN ('admin', 'teacher', 'student'))
);
--> statement-breakpoint
CREATE INDEX "oidc_links_user_idx" ON "oidc_identity_links" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_links_provider_sub_uidx" ON "oidc_identity_links" ("provider","provider_sub");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_sub_idx" ON "refresh_tokens" ("sub");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uidx" ON "users" ("username");--> statement-breakpoint
CREATE INDEX "webauthn_creds_user_idx" ON "webauthn_credentials" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campuses_code_uidx" ON "campuses" ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "duty_areas_campus_name_uidx" ON "dutyAreas" ("campusId","name");--> statement-breakpoint
CREATE INDEX "duty_areas_campus_idx" ON "dutyAreas" ("campusId");--> statement-breakpoint
CREATE UNIQUE INDEX "duty_checkins_uniq" ON "dutyCheckins" ("scheduleId","dutyDate","teacherId");--> statement-breakpoint
CREATE INDEX "duty_checkins_campus_date_idx" ON "dutyCheckins" ("campusId","dutyDate");--> statement-breakpoint
CREATE INDEX "duty_checkins_teacher_idx" ON "dutyCheckins" ("teacherId");--> statement-breakpoint
CREATE INDEX "duty_inspections_campus_date_idx" ON "dutyInspections" ("campusId","inspectDate");--> statement-breakpoint
CREATE UNIQUE INDEX "duty_locations_campus_area_name_uidx" ON "dutyLocations" ("campusId","areaId","name");--> statement-breakpoint
CREATE INDEX "duty_locations_campus_idx" ON "dutyLocations" ("campusId");--> statement-breakpoint
CREATE INDEX "duty_locations_area_idx" ON "dutyLocations" ("areaId");--> statement-breakpoint
CREATE INDEX "duty_schedules_campus_kind_idx" ON "dutySchedules" ("campusId","kind");--> statement-breakpoint
CREATE INDEX "duty_schedules_area_idx" ON "dutySchedules" ("areaId");--> statement-breakpoint
CREATE INDEX "duty_swaps_campus_status_idx" ON "dutySwaps" ("campusId","status");--> statement-breakpoint
CREATE INDEX "duty_swaps_applicant_idx" ON "dutySwaps" ("applicantId");--> statement-breakpoint
CREATE INDEX "duty_timeslots_campus_idx" ON "dutyTimeSlots" ("campusId");--> statement-breakpoint
CREATE INDEX "duty_timeslots_area_idx" ON "dutyTimeSlots" ("areaId");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_campus_key_uidx" ON "settings" ("campusId","key");--> statement-breakpoint
CREATE INDEX "settings_campus_idx" ON "settings" ("campusId");--> statement-breakpoint
CREATE INDEX "user_profiles_campus_idx" ON "userProfiles" ("campusId");