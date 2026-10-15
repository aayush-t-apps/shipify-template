-- #if OPTION_D1
-- The app's first tables (D1, AGENTS.md "Storage"). A migration only adds: a new table, a column
-- that may be empty or has a default, an index. Dropping or renaming waits for a later release, as
-- a rollback runs the old code on the new tables. Applied before each deploy, before `make dev`,
-- and in the unit tests.
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- #endif
