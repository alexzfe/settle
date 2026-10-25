-- Connections: an Agent's authorised link to an Account, made when the user clicks Allow on
-- Settle's own OAuth sign-in page (server/src/oauth.ts). Each holds a refresh token; its short
-- access tokens and its one-time authorisation codes hang off it. Every token and code is stored
-- as its SHA-256, never as given, so a copy of the database gives nobody a working Connection.

-- The clients that registered themselves (RFC 7591). A client that names itself by the URL of its
-- metadata document (CIMD) needs no row. Every client is public: none has a secret.
CREATE TABLE oauth_clients (
  id INTEGER PRIMARY KEY,
  -- Not a secret: the client sends it in the open on every request.
  client_id TEXT NOT NULL UNIQUE,
  client_name TEXT,
  -- A JSON array of the exact redirect URIs it registered.
  redirect_uris TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

-- One per Allow.
CREATE TABLE connections (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  -- The CIMD URL, or an oauth_clients.client_id.
  client_id TEXT NOT NULL,
  -- The host the Allow page named: the CIMD URL's host, or the host of a registered client's
  -- redirect URI.
  client_host TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  -- Null until its authorisation code is exchanged; a new one on every refresh.
  refresh_hash TEXT UNIQUE,
  -- 90 days after its last use: then the Connection has lapsed.
  refresh_expires_at TEXT
) STRICT;

CREATE INDEX connections_account ON connections (account_id);

CREATE TABLE access_tokens (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  connection_id INTEGER NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX access_tokens_connection ON access_tokens (connection_id);

CREATE TABLE authorization_codes (
  id INTEGER PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  connection_id INTEGER NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
  -- Exactly as /authorize was given it, which /token must repeat.
  redirect_uri TEXT NOT NULL,
  -- PKCE: the S256 challenge, base64url.
  code_challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
) STRICT;

CREATE INDEX authorization_codes_connection ON authorization_codes (connection_id);
