CREATE TABLE "appealTokens" (
	"tokenHash" text PRIMARY KEY,
	"recordId" uuid,
	"teacherDingtalkId" text NOT NULL,
	"expiresAt" bigint NOT NULL,
	"consumedAt" bigint,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dingtalkContacts" (
	"userId" text PRIMARY KEY,
	"unionId" text,
	"name" text NOT NULL,
	"mobile" text,
	"title" text,
	"avatarUrl" text,
	"deptIds" jsonb,
	"deptNames" jsonb,
	"syncedAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notificationLogs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"campusId" uuid NOT NULL,
	"recipientUserId" uuid,
	"recipientPlatformId" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"recordId" uuid,
	"week" text,
	"title" text,
	"dedupeKey" text,
	"providerTaskId" text,
	"error" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"sentAt" bigint,
	CONSTRAINT "notification_logs_kind_check" CHECK (kind IN ('notice')),
	CONSTRAINT "notification_logs_status_check" CHECK (status IN ('pending', 'sent', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE INDEX "appeal_tokens_record_idx" ON "appealTokens" ("recordId");--> statement-breakpoint
CREATE INDEX "appeal_tokens_expires_idx" ON "appealTokens" ("expiresAt");--> statement-breakpoint
CREATE INDEX "dingtalk_contacts_name_idx" ON "dingtalkContacts" ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_logs_dedupe_uidx" ON "notificationLogs" ("dedupeKey");--> statement-breakpoint
CREATE INDEX "notification_logs_campus_idx" ON "notificationLogs" ("campusId");--> statement-breakpoint
CREATE INDEX "notification_logs_status_idx" ON "notificationLogs" ("status");--> statement-breakpoint
CREATE INDEX "notification_logs_record_idx" ON "notificationLogs" ("recordId");