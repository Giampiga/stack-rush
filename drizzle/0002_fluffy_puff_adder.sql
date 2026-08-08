ALTER TABLE `invites` ADD `game_mode` text DEFAULT 'sort' NOT NULL;--> statement-breakpoint
ALTER TABLE `matches` ADD `game_mode` text DEFAULT 'sort' NOT NULL;