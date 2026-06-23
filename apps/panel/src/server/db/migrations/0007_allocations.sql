CREATE TABLE "allocation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"node_id" text NOT NULL,
	"server_id" text,
	"ip" text DEFAULT '0.0.0.0' NOT NULL,
	"port" integer NOT NULL,
	"protocol" text DEFAULT 'tcp' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_node_id_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."node"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_server_id_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocation_organization_id_idx" ON "allocation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "allocation_node_id_idx" ON "allocation" USING btree ("node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_node_port_proto_uidx" ON "allocation" USING btree ("node_id","port","protocol");