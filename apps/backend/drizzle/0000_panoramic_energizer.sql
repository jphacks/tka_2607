CREATE TABLE `issues` (
	`project_id` text NOT NULL,
	`id` text NOT NULL,
	`day` integer NOT NULL,
	`phase` text,
	`data` text NOT NULL,
	PRIMARY KEY(`project_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`project_title` text NOT NULL,
	`issue_title` text NOT NULL,
	`rule` text,
	`category` text NOT NULL,
	`stance` text NOT NULL,
	`chosen` text NOT NULL,
	`reason` text NOT NULL,
	`lesson` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`role` text NOT NULL,
	`name` text,
	`kind` text,
	`text` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_issue_idx` ON `messages` (`project_id`,`issue_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`background` text NOT NULL,
	`source` text NOT NULL,
	`findings` text NOT NULL,
	`features` text NOT NULL,
	`architecture` text NOT NULL,
	`flows` text NOT NULL,
	`dismissed` text NOT NULL,
	`uncovered_features` text NOT NULL,
	`assumed_users` integer,
	`sim_day` integer DEFAULT 0 NOT NULL,
	`analyzed_by` text
);
