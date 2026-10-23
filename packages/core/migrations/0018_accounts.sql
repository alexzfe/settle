-- Accounts: who owns which Homes, each with its Logins, and the one-time links that make an
-- Account (setup, invite) or set its password (reset). Every token is stored as its SHA-256, never
-- as given, so a copy of the database logs nobody in. Existing Homes have no Account until the
-- first one is made through the setup link, which claims them.

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  -- As the person typed it; unique whatever its case.
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  -- scrypt$<N>$<r>$<p>$<salt>$<hash>, salt and hash in base64: the parameters travel with the
  -- hash, so they can be raised later without locking anyone out.
  password_hash TEXT NOT NULL,
  admin INTEGER NOT NULL DEFAULT 0 CHECK (admin IN (0, 1)),
  disabled_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

-- Only one Admin.
CREATE UNIQUE INDEX accounts_one_admin ON accounts (admin) WHERE admin = 1;

ALTER TABLE homes ADD COLUMN account_id INTEGER REFERENCES accounts (id);

CREATE INDEX homes_account ON homes (account_id);

-- One browser's signed-in state for an Account.
CREATE TABLE logins (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
) STRICT;

CREATE INDEX logins_account ON logins (account_id);

-- The one-time links: setup (makes the Admin and claims every unclaimed Home), invite (makes an
-- Account), and reset (sets an Account's password).
CREATE TABLE account_links (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('setup', 'invite', 'reset')),
  token_hash TEXT NOT NULL UNIQUE,
  -- The Account a reset link sets the password of; null for setup and invite.
  account_id INTEGER REFERENCES accounts (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  -- The Admin who made it; null for a setup link, which the server makes.
  made_by INTEGER REFERENCES accounts (id) ON DELETE SET NULL,
  CHECK ((kind = 'reset') = (account_id IS NOT NULL))
) STRICT;
