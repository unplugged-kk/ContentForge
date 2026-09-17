CREATE UNIQUE INDEX IF NOT EXISTS "connected_accounts_user_platform_uq" ON "connected_accounts" USING btree ("user_id", "platform");
