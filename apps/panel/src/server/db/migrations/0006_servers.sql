CREATE TABLE "server" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"node_id" text NOT NULL,
	"name" text NOT NULL,
	"template_id" text NOT NULL,
	"template_name" text NOT NULL,
	"template_version" integer DEFAULT 1 NOT NULL,
	"image_label" text NOT NULL,
	"image" text NOT NULL,
	"startup_command" text DEFAULT '' NOT NULL,
	"stop_signal" text,
	"state" text DEFAULT 'installing' NOT NULL,
	"port" integer,
	"cpu_limit_millicores" integer NOT NULL,
	"mem_limit_bytes" bigint NOT NULL,
	"disk_limit_bytes" bigint NOT NULL,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "server" ADD CONSTRAINT "server_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server" ADD CONSTRAINT "server_node_id_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."node"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "server_organization_id_idx" ON "server" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "server_node_id_idx" ON "server" USING btree ("node_id");