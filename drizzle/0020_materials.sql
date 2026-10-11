CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "materials_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "materials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "materials" ("code", "name", "position") VALUES
	('yg', '14K Yellow Gold', 0),
	('wg', '14K White Gold', 1),
	('vm', '18K Gold Vermeil', 2),
	('ss', 'Sterling Silver', 3)
ON CONFLICT ("code") DO NOTHING;
