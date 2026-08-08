CREATE TABLE `guest_session_creations` (
	`nonce` text PRIMARY KEY NOT NULL,
	`client_key_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_guest_session_creations_created` ON `guest_session_creations` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_guest_session_creations_client` ON `guest_session_creations` (`client_key_hash`,`created_at`);--> statement-breakpoint
CREATE TABLE `maintenance_leases` (
	`key` text PRIMARY KEY NOT NULL,
	`run_after` integer NOT NULL,
	`claim_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `match_results` (
	`match_id` text PRIMARY KEY NOT NULL,
	`winner_id` text NOT NULL,
	`loser_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`applied` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`applied_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_results_claim_id_unique` ON `match_results` (`claim_id`);--> statement-breakpoint
CREATE TABLE `schema_migrations` (
	`id` text PRIMARY KEY NOT NULL,
	`applied_at` integer NOT NULL
);
--> statement-breakpoint
DROP TRIGGER IF EXISTS `trg_record_match_result`;
--> statement-breakpoint
UPDATE `matches`
SET `status` = 'abandoned', `winner_id` = NULL,
	`finished_at` = COALESCE(`finished_at`, CAST(strftime('%s', 'now') AS integer) * 1000),
	`updated_at` = CAST(strftime('%s', 'now') AS integer) * 1000
WHERE `disk_count` NOT IN (6, 9, 12, 15)
	AND `status` IN ('countdown', 'playing');
--> statement-breakpoint
UPDATE `invites`
SET `status` = 'expired',
	`responded_at` = CAST(strftime('%s', 'now') AS integer) * 1000
WHERE `disk_count` NOT IN (6, 9, 12, 15) AND `status` = 'pending';
--> statement-breakpoint
UPDATE `players`
SET `active_match_id` = NULL, `status` = 'online'
WHERE `active_match_id` IN (
	SELECT `id` FROM `matches` WHERE `disk_count` NOT IN (6, 9, 12, 15)
);
--> statement-breakpoint
DELETE FROM `active_slots`
WHERE `game_id` IN (
	SELECT `id` FROM `matches` WHERE `disk_count` NOT IN (6, 9, 12, 15)
	UNION
	SELECT `id` FROM `invites` WHERE `disk_count` NOT IN (6, 9, 12, 15)
);
--> statement-breakpoint
INSERT OR IGNORE INTO `schema_migrations` (`id`, `applied_at`)
VALUES (
	'0001_bolt_sort_state_and_result_ledger',
	CAST(strftime('%s', 'now') AS integer) * 1000
);
