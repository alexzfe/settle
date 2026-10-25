# Self-hosting Settle

Settle runs as one container: the web app and the MCP endpoint your Claude Code session talks to,
on port 4380, with everything it stores in one volume. The image is
`ghcr.io/alexzfe/settle:latest`, for amd64 and arm64; each release is also tagged `vX.Y.Z`.

Everyone logs in with their own account, an email and a password, or Google if you turn it on.
Each account's Homes are its own: no other account can see them. The first account, the Admin,
invites the rest. Settle never sends email; the email is only what you log in with.

Whoever runs the server can read its database, and so can an HTTPS proxy in the middle, such as
Cloudflare. Tell the people you invite.

## HTTPS is yours to provide

The container serves plain `http`, and only to the machine it runs on. Put a reverse proxy that
terminates HTTPS in front of it. Settle refuses to start with an `http://` `SETTLE_PUBLIC_ORIGIN`
unless it is `localhost` or `127.x`, since passwords would cross the network in the clear.

With [Caddy](https://caddyserver.com) on the same machine, this is the whole config, and Caddy
fetches the certificate itself:

```
settle.example.com {
    reverse_proxy 127.0.0.1:4380
}
```

On a [Tailscale](https://tailscale.com) tailnet, `tailscale serve --bg 4380` gives the machine an
HTTPS address that only your devices can reach.

### Behind Cloudflare

With Cloudflare in front (a proxied DNS record, or a Cloudflare Tunnel):

- Set `SETTLE_TRUSTED_PROXY=cloudflare`, so the limits on wrong passwords count each visitor's IP
  from Cloudflare's `CF-Connecting-IP` header. Without it, every request seems to come from the
  proxy, and one person's wrong guesses would lock out everyone. Set it only when the server can be
  reached through Cloudflare alone, since anyone else could send that header.
- Turn Bot Fight Mode off for Settle's hostname. Claude Code's MCP calls and the Home Folder
  command are not browsers, and a challenge page breaks them.
- Turn on HSTS (SSL/TLS → Edge Certificates).

## Bring it up

Copy [`deploy/compose.yaml`](deploy/compose.yaml) to a folder on the server, and beside it a `.env`
file:

```sh
SETTLE_PUBLIC_ORIGIN=https://settle.example.com
```

`SETTLE_PUBLIC_ORIGIN` is the exact origin your browser uses: scheme, host and port if it isn't the
default, with no path and no trailing slash. The server answers only requests addressed to it, and
it is the address written into the commands and links the app gives out.

```sh
docker compose up -d
```

## First run

1. While there is no account, the server prints a setup link in its log at each start:

   ```sh
   docker compose logs settle | grep /setup/
   ```

   Open it, and enter your email and a password (12 characters or more). That makes you the Admin
   and logs you in. The link works once; only someone who can read the server's log has it.
2. Create a Home. Its About page gives you a command that sets up a folder for that Home.
3. On the computer where you use [Claude Code](https://claude.com/claude-code), make an empty
   folder and run that command in it. It writes `.mcp.json`, which holds the Home's key, so don't
   commit that file or share it. If you do, the About page's **New key** cancels it.
4. In the same folder, add the plugin and start Claude:

   ```sh
   claude plugin marketplace add alexzfe/settle
   claude plugin install settle@settle --scope project
   claude
   ```

## Inviting people, and forgotten passwords

On the Admin page, **Make an invite** gives a link that lets one person make an account, once,
within 7 days. Send it to them yourself. Waiting invites can be cancelled.

Someone who forgets their password asks you: **Reset link** beside their account gives a link that
sets a new one, once, within 24 hours, and logs them out everywhere.

The Admin page also disables an account (it is logged out at once and its Agent keys and Quick
Guide links stop, with nothing deleted) or deletes it with everything in it. It shows each
account's email and how many Homes it has, and nothing inside them.

Each person's Account page changes their email and password, logs them out everywhere, downloads
everything in their Homes as a `.zip`, and deletes their account.

## Sign in with Google (optional)

Off unless you turn it on. With it on, the login page offers **Log in with Google** next to the
password, and an invite link offers **Join with Google**. Google is asked only who someone is (the
`openid email profile` scopes); Settle keeps none of Google's tokens. Invites still decide who gets
in: a Google account with no invite gets no account. An account whose email matches the Google
account's verified email is linked to it at its first Google login, and can then use either. An
account made with Google has no password until it sets one on its Account page.

To turn it on, register Settle with Google, once, in [Google Cloud's
console](https://console.cloud.google.com). It's free, with no billing:

1. Create a project ([New project](https://console.cloud.google.com/projectcreate)), named Settle.
2. In **Google Auth Platform**, click **Get started**. App name Settle, your email as the support
   and contact email, and Audience **External**.
3. Under **Branding → Authorized domains**, add the domain your Settle is on (`example.com` for
   `settle.example.com`).
4. Under **Data Access**, add the scopes `openid`, `.../auth/userinfo.email` and
   `.../auth/userinfo.profile`, and no others. Leave **Audience** in **Testing**: with only these
   three scopes, nobody needs adding as a test user, there is no review, and sign-ins don't expire
   after 7 days. Another scope would bring all three back.
5. Under **Clients**, create a client of type **Web application**, with one authorized redirect
   URI: your `SETTLE_PUBLIC_ORIGIN` followed by `/auth/google/callback`, such as
   `https://settle.example.com/auth/google/callback`. Copy the client ID and secret. Google shows
   the secret only this once.
6. Add both to `.env` and restart:

   ```sh
   SETTLE_GOOGLE_CLIENT_ID=123-abc.apps.googleusercontent.com
   SETTLE_GOOGLE_CLIENT_SECRET=GOCSPX-...
   ```

   ```sh
   docker compose up -d
   ```

Google may take a few minutes to accept a new redirect URI. Settle refuses to start with only one of
the two set. To turn it off again, remove both. Accounts made with Google then log in with a reset
link from the Admin page, which sets a password.

## The Quick Guide on a phone

Each Purchase's Quick Guide has a QR code. It opens the guide on a phone without logging in, through
a link nobody can guess. **New link** beside it cancels a link that went to the wrong person.
Nothing else in the app is open without logging in.

## Backups

The volume holds `settle.sqlite`, the database; `uploads/`, the floor plans, the Listings'
pictures, and the Photos and Documents; and `rendered/`, the floor plans' pages as images.

`settle backup` writes all three as one `.tar.gz` to stdout, safe while the server runs:

```sh
docker compose exec -T settle node packages/server/dist/backup.js > "settle-$(date +%F).tgz"
```

To restore, unpack it into an empty volume before starting the server, owned by the container's
`node` user (uid 1000):

```sh
docker compose down
docker run --rm -i -v settle_settle-data:/data alpine \
  sh -c 'rm -rf /data/* && tar xzf - -C /data && chown -R 1000:1000 /data' < settle-2026-10-22.tgz
docker compose up -d
```

## Upgrading

```sh
docker compose pull && docker compose up -d
```

The database is migrated when the server starts.

### From a version with one shared password

Accounts replaced `SETTLE_PASSWORD`. On the first start of the new version there are Homes and no
accounts, so the log prints the setup link: open it, and the account you make owns every existing
Home. Until then, the Homes' Agent keys and Quick Guide links don't work; afterwards they work as
before. Remove `SETTLE_PASSWORD` from `.env`: while it is set, the log says it is ignored. Change
the port in `compose.yaml` to `"127.0.0.1:4380:4380"`, as above.

## Units

Lengths are shown and entered in metres and centimetres only; Claude converts from feet and inches
if you talk to it in those.
