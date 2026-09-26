ALTER TABLE "discovery_settings" ADD COLUMN "user_id" integer;--> statement-breakpoint
DO $$
DECLARE
  settings_count integer;
  user_count integer;
  sole_user integer;
BEGIN
  SELECT count(*) INTO settings_count FROM "discovery_settings";

  -- Fresh install (or a database whose settings row was never created):
  -- there is nothing to attribute, so the column/index go in unattributed.
  IF settings_count = 0 THEN
    RETURN;
  END IF;

  -- Pre-migration this table was a global singleton (row id 1). More than one
  -- row means the data is not the expected shape; abort rather than guess.
  IF settings_count <> 1 THEN
    RAISE EXCEPTION 'discovery_settings ownership backfill aborted: expected the singleton settings row, found % row(s).', settings_count;
  END IF;

  -- Fail closed: attribution needs exactly one owner. Zero owners (orphan) or
  -- several owners must abort rather than assign arbitrarily.
  SELECT count(*) INTO user_count FROM "users";
  IF user_count <> 1 THEN
    RAISE EXCEPTION 'discovery_settings ownership backfill aborted: expected exactly one user to attribute the existing settings row, found %. Refusing to assign arbitrarily, orphan, or delete.', user_count;
  END IF;

  SELECT id INTO sole_user FROM "users";
  UPDATE "discovery_settings" SET "user_id" = sole_user WHERE "user_id" IS NULL;

  IF EXISTS (SELECT 1 FROM "discovery_settings" WHERE "user_id" IS NULL) THEN
    RAISE EXCEPTION 'discovery_settings ownership backfill aborted: settings row remains unattributed.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "discovery_settings" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_settings_user_id_uq" ON "discovery_settings" USING btree ("user_id");
