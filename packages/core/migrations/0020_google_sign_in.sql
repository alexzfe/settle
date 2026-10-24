-- Sign in with Google (server/src/google.ts): an Account may be linked to one Google account, by
-- Google's permanent user id (`sub`), which stays the same when the Gmail address changes. Nothing
-- else from Google is kept: no token, no name, no picture.
ALTER TABLE accounts ADD COLUMN google_sub TEXT;

CREATE UNIQUE INDEX accounts_google_sub ON accounts (google_sub);

-- An Account made through an invite with Google has no password: its password_hash is ''. The
-- column stays NOT NULL because SQLite cannot drop that without rebuilding the table, and the
-- tables that point at accounts would lose their rows to ON DELETE CASCADE if it were dropped.
