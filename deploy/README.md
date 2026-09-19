# Deploying Settle

Settle runs as one container on the homeserver and is reached at `https://settle.example.com` from
every device on the tailnet. Every push to `main` that passes lint, tests, and build is built into an
image, pushed to GitHub's registry, and started on the homeserver by
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml). The decisions behind this are in
[docs/handoff/hosting.md](../docs/handoff/hosting.md).

| File | What it is |
|---|---|
| [`../Dockerfile`](../Dockerfile) | The image: Node 26 slim, the built server, core, and web UI, running as `node` |
| [`compose.yaml`](compose.yaml) | The stack, copied to `/docker/settle/compose.yaml` by every deploy |
| [`.env.example`](.env.example) | The one variable the stack reads: which image tag runs |
| [`github-runner/compose.yaml`](github-runner/compose.yaml) | The self-hosted runner, copied by hand to `/docker/github-runner/` |

## How it fits the homeserver

- **The stack folder** is `/docker/settle`: `compose.yaml` (written by each deploy, so edit it here,
  not there), `.env` (written by each deploy: `SETTLE_IMAGE_TAG=sha-<commit>`), and `data/` (the
  database, uploads, and rendered pages; owned by uid 1000, the container's `node` user).
- **Nginx Proxy Manager** holds one proxy host: `settle.example.com` → `100.64.0.1`, port `4380`,
  scheme `http`, with the wildcard certificate and "Force SSL". Nothing in its Advanced tab is
  needed: the app's live updates are server-sent events (`/events`), and the server sends
  `X-Accel-Buffering: no` on that stream, which nginx honours, so they are not held back in its
  buffer. MCP answers are plain JSON. Websockets support is not needed.
  The app sees the `Host` header NPM passes through and accepts it because `SETTLE_PUBLIC_ORIGIN`
  names it.
- **Nightly config backup** (03:30) commits `/docker/settle/compose.yaml`, and a redacted
  `.env.example` generated from `.env`, into `homeserver-docker-configs`.
- **restic** (01:00) backs up all of `/docker`, and dumps every SQLite file it finds, so
  `data/settle.sqlite` is backed up with no extra work.
- **Watchtower** skips Settle (`com.centurylinklabs.watchtower.enable: "false"`): the image is
  private and pinned to a commit, and CI is what updates it. The runner stack keeps the default and is
  updated by Watchtower like everything else.
- **Gatus**: one endpoint check on `https://settle.example.com/health`, expecting status 200.

## Settings

Set in `compose.yaml`; the image already has the last three.

| Variable | Value in the container | Meaning |
|---|---|---|
| `SETTLE_PUBLIC_ORIGIN` | `https://settle.example.com` | The address the app is reached at: allowed through the host guard and written into the Home Folder command and the phone QR code |
| `SETTLE_HOST` | `0.0.0.0` | The address the server listens on; not loopback, so it requires `SETTLE_PUBLIC_ORIGIN` |
| `SETTLE_PORT` | `4380` | The port, inside and outside the container |
| `SETTLE_DATA_DIR` | `/data` | Where the database, `uploads/`, and `rendered/` live; bind-mounted from `./data` |
| `SETTLE_IMAGE_TAG` | from `.env`, e.g. `sha-1a2b3c4` | Which image the stack runs (Compose reads it, the app does not) |

## Secrets and variables

The workflow needs **no repository secrets and no variables**. Each job uses the automatic
`GITHUB_TOKEN`: `image` with `packages: write` to push, `deploy` with `packages: read` to pull.
The only credential is the runner's `ACCESS_TOKEN`, which lives on the homeserver in
`/docker/github-runner/.env` (below), never in GitHub.

GitHub creates the `homeserver` environment the first time the deploy job runs; it lists every
deploy with its commit and link.

## Rolling back

Every commit's image stays in the registry as `sha-<7-char commit>`
([package page](https://github.com/alexzfe/settle/pkgs/container/settle)).

```sh
cd /docker/settle
sed -i 's/^SETTLE_IMAGE_TAG=.*/SETTLE_IMAGE_TAG=sha-1a2b3c4/' .env
docker compose up -d
```

If that tag was never pulled on the box, `docker compose up -d` needs a login first:
`docker login ghcr.io -u alexzfe` with a classic token that has `read:packages`. The next push to
`main` deploys the new commit again; to hold a rollback, don't push until the fix is in.
Migrations only move forward, so rolling back past a commit that added one runs old code on a newer
database; restore `data/` from restic too if that matters.

## Running the image locally

```sh
docker build -t settle .
docker run --rm -p 4380:4380 -v "$PWD/.data:/data" \
  -e SETTLE_PUBLIC_ORIGIN=http://localhost:4380 settle
```

Then open `http://localhost:4380`. The `.data` folder must be writable by uid 1000 (it is if you are
the first user on the machine). To try the proxy's name without the proxy, send the header yourself:
`curl -H 'Host: settle.example.com' http://127.0.0.1:4380/health` against a container started with
`SETTLE_PUBLIC_ORIGIN=https://settle.example.com`.

## The self-hosted runner

The deploy job runs on the homeserver itself, on a GitHub Actions runner in its own stack. It dials
out to GitHub, so nothing on the box is opened to the outside. It has the host's Docker socket, which
makes it root on the box; that is why it is registered to this one repository and why outside pull
requests must wait for approval.

1. **Token.** GitHub → Settings → Developer settings → Fine-grained tokens → Generate. Repository
   access: only `alexzfe/settle`. Permissions: **Administration: Read and write** (this is what lets
   a runner register itself; Metadata: read comes with it). Pick an expiry and put a reminder in the
   calendar: when it expires the runner cannot re-register and deploys queue until it is replaced.
2. **Stack.** On the homeserver:

   ```sh
   mkdir -p /docker/github-runner /docker/settle
   cp deploy/github-runner/compose.yaml /docker/github-runner/compose.yaml   # from a checkout, or paste it
   printf 'ACCESS_TOKEN=%s\n' 'github_pat_...' > /docker/github-runner/.env
   chmod 600 /docker/github-runner/.env
   cd /docker/github-runner && docker compose up -d
   docker compose logs -f   # wait for "Listening for Jobs"
   ```

   `/docker/settle` must exist before the runner starts, so Docker bind-mounts the real folder.
3. **Check.** Repo → Settings → Actions → Runners shows `homeserver` as Idle, with the labels
   `self-hosted`, `Linux`, `X64`, `homeserver`.
4. **Guard.** Repo → Settings → Actions → General → "Approval for running fork pull request
   workflows from contributors": **Require approval for all external contributors**. The `deploy` job
   only runs on pushes to `main`, but a pull request can change the workflow it runs.

The runner is ephemeral: it takes one job, unregisters, and the restart policy starts a clean one.

### Deploying over SSH instead

If the runner goes, only the `deploy` job changes: run it on `ubuntu-latest`, join the tailnet with
`tailscale/github-action` (an OAuth client with a `tag:ci` tag), and run the same steps on the box with
`ssh`. Tailscale SSH answers port 22 on the tailnet, so it needs a Tailscale SSH ACL rule letting
`tag:ci` in as the deploying user, or sshd on another port with a deploy key in a repository secret.
The steps stay the same: log in to ghcr, write `compose.yaml` and `.env`, `docker compose pull`,
`docker compose up -d --remove-orphans`, poll `/health`, `docker compose ps`.

## What is done by hand, once

- Create the runner token and the runner stack, and set the fork approval guard (above).
- After the first image push: on the [package page](https://github.com/alexzfe/settle/pkgs/container/settle)
  → Package settings, check the visibility is **Private** and that `alexzfe/settle` is listed under
  "Manage Actions access" (the image's `org.opencontainers.image.source` label links them).
- Add the proxy host in Nginx Proxy Manager and the Gatus check.
- Copy the data once, with the desktop app and the `settle` container stopped: `~/.local/share/settle/` → `/docker/settle/data/`,
  then `chown -R 1000:1000 /docker/settle/data`.
- Re-point each Home Folder with the "Set up Home Folder" command from the hosted app.
