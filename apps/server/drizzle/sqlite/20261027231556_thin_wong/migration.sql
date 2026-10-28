CREATE TABLE `appealTokens` (
	`tokenHash` text PRIMARY KEY,
	`recordId` text,
	`teacherDingtalkId` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`consumedAt` integer,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dingtalkContacts` (
	`userId` text PRIMARY KEY,
	`unionId` text,
	`name` text NOT NULL,
	`mobile` text,
	`title` text,
	`avatarUrl` text,
	`deptIds` text,
	`deptNames` text,
	`syncedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notificationLogs` (
	`id` text PRIMARY KEY,
	`campusId` text NOT NULL,
	`recipientUserId` text,
	`recipientPlatformId` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`recordId` text,
	`week` text,
	`title` text,
	`dedupeKey` text,
	`providerTaskId` text,
	`error` text,
	`createdAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`sentAt` integer,
	CONSTRAINT "notification_logs_kind_check" CHECK(kind IN ('notice')),
	CONSTRAINT "notification_logs_status_check" CHECK(status IN ('pending', 'sent', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE INDEX `appeal_tokens_record_idx` ON `appealTokens` (`recordId`);--> statement-breakpoint
CREATE INDEX `appeal_tokens_expires_idx` ON `appealTokens` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `dingtalk_contacts_name_idx` ON `dingtalkContacts` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_logs_dedupe_uidx` ON `notificationLogs` (`dedupeKey`);--> statement-breakpoint
CREATE INDEX `notification_logs_campus_idx` ON `notificationLogs` (`campusId`);--> statement-breakpoint
CREATE INDEX `notification_logs_status_idx` ON `notificationLogs` (`status`);--> statement-breakpoint
CREATE INDEX `notification_logs_record_idx` ON `notificationLogs` (`recordId`);