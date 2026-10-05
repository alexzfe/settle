-- Each Home gets a token: the bearer key its Home Folder's .mcp.json sends, which opens that
-- Home's MCP endpoint and its Home Folder script, and nothing else. New Homes get one when they
-- are created; existing ones get a random one here. SQLite can't add a NOT NULL column without a
-- default, so the column is nullable and the unique index keeps two Homes from sharing one.
ALTER TABLE homes ADD COLUMN token TEXT;

UPDATE homes SET token = lower(hex(randomblob(18)));

CREATE UNIQUE INDEX homes_token ON homes (token);
