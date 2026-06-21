CREATE TABLE "template" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'Other' NOT NULL,
	"icon_url" text,
	"origin" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_name" text,
	"startup_command" text DEFAULT '' NOT NULL,
	"stop_type" text DEFAULT 'command' NOT NULL,
	"stop_value" text DEFAULT 'stop' NOT NULL,
	"done_markers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"install_script" text DEFAULT '' NOT NULL,
	"install_container_image" text DEFAULT '' NOT NULL,
	"install_entrypoint" text DEFAULT 'bash' NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_image" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"label" text NOT NULL,
	"image" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_variable" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"env_variable" text NOT NULL,
	"default_value" text,
	"type" text DEFAULT 'text' NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"access" text DEFAULT 'editable' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_image" ADD CONSTRAINT "template_image_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_variable" ADD CONSTRAINT "template_variable_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "template_organization_id_idx" ON "template" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "template_status_idx" ON "template" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "template_org_slug_uidx" ON "template" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "template_official_slug_uidx" ON "template" USING btree ("slug") WHERE "template"."organization_id" is null;--> statement-breakpoint
CREATE INDEX "template_image_template_id_idx" ON "template_image" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "template_variable_template_id_idx" ON "template_variable" USING btree ("template_id");