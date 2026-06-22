CREATE TABLE "node_credential" (
	"node_id" text PRIMARY KEY NOT NULL,
	"bootstrap_token_hash" text,
	"bootstrap_expires_at" timestamp,
	"node_key_hash" text,
	"node_key_ciphertext" text,
	"signing_secret_ciphertext" text,
	"activated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "node" ADD COLUMN "last_heartbeat_at" timestamp;--> statement-breakpoint
ALTER TABLE "node" ADD COLUMN "system_info" jsonb;--> statement-breakpoint
ALTER TABLE "node" ADD COLUMN "public_ip" text;--> statement-breakpoint
ALTER TABLE "node" ADD COLUMN "cert_fingerprint" text;--> statement-breakpoint
ALTER TABLE "node_credential" ADD CONSTRAINT "node_credential_node_id_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."node"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "node_credential_key_hash_idx" ON "node_credential" USING btree ("node_key_hash");--> statement-breakpoint
ALTER TABLE "node" DROP COLUMN "enrollment_token_hash";--> statement-breakpoint
ALTER TABLE "node" DROP COLUMN "enrollment_token_expires_at";