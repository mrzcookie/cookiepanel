CREATE TABLE "billing_customer" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"polar_customer_id" text,
	"billing_contact_user_id" text,
	"card_brand" text,
	"card_last4" text,
	"card_exp_month" integer,
	"card_exp_year" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_entitlement" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"status" text DEFAULT 'none' NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"polar_subscription_id" text,
	"polar_product_id" text,
	"unit_price_cents" integer,
	"current_period_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"trial_ends_at" timestamp,
	"grace_ends_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_entitlement_org_key_uq" UNIQUE("organization_id","key")
);
--> statement-breakpoint
ALTER TABLE "billing_customer" ADD CONSTRAINT "billing_customer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_customer" ADD CONSTRAINT "billing_customer_billing_contact_user_id_user_id_fk" FOREIGN KEY ("billing_contact_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_entitlement" ADD CONSTRAINT "org_entitlement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_entitlement_org_idx" ON "org_entitlement" USING btree ("organization_id");