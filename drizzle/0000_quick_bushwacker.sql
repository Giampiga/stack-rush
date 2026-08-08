CREATE TABLE `active_slots` (
	`player_id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_active_slots_game` ON `active_slots` (`game_id`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`from_player_id` text NOT NULL,
	`to_player_id` text NOT NULL,
	`disk_count` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`responded_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_invites_incoming` ON `invites` (`to_player_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_invites_outgoing` ON `invites` (`from_player_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`player_one_id` text NOT NULL,
	`player_two_id` text NOT NULL,
	`disk_count` integer NOT NULL,
	`status` text DEFAULT 'countdown' NOT NULL,
	`starts_at` integer NOT NULL,
	`winner_id` text,
	`player_one_state` text NOT NULL,
	`player_two_state` text NOT NULL,
	`player_one_moves` integer DEFAULT 0 NOT NULL,
	`player_two_moves` integer DEFAULT 0 NOT NULL,
	`player_one_rematch` integer DEFAULT 0 NOT NULL,
	`player_two_rematch` integer DEFAULT 0 NOT NULL,
	`rematch_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_matches_player_one` ON `matches` (`player_one_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_matches_player_two` ON `matches` (`player_two_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`name` text NOT NULL,
	`hue` integer NOT NULL,
	`status` text DEFAULT 'online' NOT NULL,
	`active_match_id` text,
	`wins` integer DEFAULT 0 NOT NULL,
	`races` integer DEFAULT 0 NOT NULL,
	`last_seen` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_players_presence` ON `players` (`active_match_id`,`last_seen`);
