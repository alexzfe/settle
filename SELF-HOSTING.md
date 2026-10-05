# Self-hosting Settle

Settle runs as one container: the web app and the MCP endpoint your Claude Code session talks to,
on port 4380, with everything it stores in one volume. The image is
`ghcr.io/alexzfe/settle:latest`, for amd64 and arm64.

There are no accounts. One password, `SETTLE_PASSWORD`, is shared by everyone in the household.

## HTTPS is yours to provide

The container serves plain `http`. On the open internet that means the password crosses in the
clear, so don't run it that way. Either put it behind a reverse proxy that terminates HTTPS, or keep
it on a private network.

With [Caddy](https://caddyserver.com) on the same machine, this is the whole config, and Caddy
fetches the certificate itself:

```
settle.example.com {
    reverse_proxy 127.0.0.1:4380
}
```

In that case, change the port in `compose.yaml` to `"127.0.0.1:4380:4380"` so only Caddy can reach
it.

On a [Tailscale](https://tailscale.com) tailnet, `tailscale serve --bg 4380` gives the machine an
HTTPS address that only your devices can reach.

## Bring it up

Copy [`deploy/compose.yaml`](deploy/compose.yaml) to a folder on the server, and beside it a `.env`
file:

```sh
SETTLE_PUBLIC_ORIGIN=https://settle.example.com
SETTLE_PASSWORD='a long passphrase'
```

`SETTLE_PUBLIC_ORIGIN` is the exact origin your browser uses: scheme, host and port if it isn't the
default, with no path and no trailing slash. The server answers only requests addressed to it, and
it is the address written into the commands and links the app gives out. Keep the password in
single quotes if it contains a `$`.

```sh
docker compose up -d
```

Compose refuses to start if either value is missing, and so does the server.

## First run

1. Open the origin in a browser and log in with the password.
2. Create a Home. Its About page gives you a command that sets up a folder for that Home.
3. On the computer where you use [Claude Code](https://claude.com/claude-code), make an empty
   folder and run that command in it. It writes `.mcp.json`, which holds the Home's key, so don't
   commit that file or share it.
4. In the same folder, add the plugin and start Claude:

   ```sh
   claude plugin marketplace add alexzfe/settle
   claude plugin install settle@settle --scope project
   claude
   ```

## The Quick Guide on a phone

Each Purchase's Quick Guide has a QR code. It opens the guide on a phone without logging in, through
a link nobody can guess. Nothing else in the app is open without the password.

## Backups

The volume holds `settle.sqlite`, the database, and `uploads/` and `rendered/`, the floor plans you
uploaded and their pages as images. Stop the container before copying them, so the database is
consistent:

```sh
docker compose stop
docker run --rm -v settle_settle-data:/data -v "$PWD":/backup alpine \
  tar czf "/backup/settle-$(date +%F).tgz" -C /data .
docker compose start
```

Or, without stopping it, take a copy of the database with `sqlite3 settle.sqlite ".backup
settle-copy.sqlite"` from anywhere that can see the volume, and copy the two folders beside it.

## Upgrading

```sh
docker compose pull && docker compose up -d
```

The database is migrated when the server starts.

## Changing the password

Edit `.env` and run `docker compose up -d`. Everyone is logged out. The keys in each Home Folder's
`.mcp.json` keep working.

## Units

Lengths are shown and entered in metres and centimetres only; Claude converts from feet and inches
if you talk to it in those.
