CREATE TABLE "node" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"fqdn" text NOT NULL,
	"daemon_port" integer DEFAULT 8443 NOT NULL,
	"managed" boolean DEFAULT false NOT NULL,
	"cap_cpu_cores" integer,
	"cap_mem_bytes" bigint,
	"cap_disk_bytes" bigint,
	"enrollment_token_hash" text,
	"enrollment_token_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "node" ADD CONSTRAINT "node_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "node_organization_id_idx" ON "node" USING btree ("organization_id");