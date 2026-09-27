#!/usr/bin/env bash
# Live smoke suite: runs plugin/evals-live against a real server on a dedicated port, with a
# throwaway data dir holding only the fixture Homes, so no write can reach the user's Homes on 4380.
# Extra arguments go to `claude plugin eval`, e.g. `pnpm plugin:eval:live --case home-intake-opens-live`.
set -euo pipefail

cd "$(dirname "$0")/.."

# plugin/test-support/live-server/.mcp.json names this port, and this Home slug unless a case's
# EVAL_SETTLE_HOME names another.
PORT=4390
HOME_SLUG=fixture-home
BASE="http://127.0.0.1:${PORT}"
DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/settle-live-XXXXXX")"
SERVER_LOG="${DATA_DIR}/server.log"
SERVER_PID=""

stop_server() {
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    # setsid made the server its own process group, so this stops pnpm and node together.
    kill -TERM -- "-${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
  rm -rf "${DATA_DIR}"
}
trap stop_server EXIT

fail() {
  echo "$1" >&2
  [[ -f "${SERVER_LOG}" ]] && sed 's/^/  server: /' "${SERVER_LOG}" >&2
  exit 1
}

if curl -s -o /dev/null "${BASE}/health"; then
  fail "Port ${PORT} is already in use. Stop whatever is running there first."
fi

echo "Building the server..."
pnpm --filter "@settle/server..." build >/dev/null

echo "Starting the server on ${PORT} (data in ${DATA_DIR})..."
SETTLE_PORT="${PORT}" SETTLE_DATA_DIR="${DATA_DIR}" setsid pnpm --filter @settle/server start \
  >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 50); do
  curl -sf -o /dev/null "${BASE}/health" && break
  kill -0 "${SERVER_PID}" 2>/dev/null || fail "The server exited during startup."
  sleep 0.2
done
curl -sf -o /dev/null "${BASE}/health" || fail "The server did not answer ${BASE}/health."

echo "Creating the fixture Home..."
response="$(curl -sS -X POST "${BASE}/api/create_home" -H "Content-Type: application/json" \
  -d '{"name":"Fixture Home","country":"GB","city":"London"}')"
slug="$(node -e '
  try { process.stdout.write(JSON.parse(require("node:fs").readFileSync(0, "utf8")).home?.slug ?? ""); }
  catch { }' <<<"${response}")"
[[ "${slug}" == "${HOME_SLUG}" ]] ||
  fail "create_home should have made the Home ${HOME_SLUG}; it answered: ${response}"

# The Blueprint the view_images case reads: the fixture one-page A3 ground floor, uploaded the way
# the web UI does. Its page stays unmapped, so the Agent names the Level from the page itself.
BLUEPRINT_FILE=packages/core/fixture/blueprint-a3.pdf
BLUEPRINT_SLUG=ground-floor-plan
echo "Uploading the fixture Blueprint..."
response="$(curl -sS -X POST "${BASE}/api/upload_blueprint" -F "home=${HOME_SLUG}" \
  -F "label=Ground floor plan" -F "file=@${BLUEPRINT_FILE};type=application/pdf")"
blueprint="$(node -e '
  try {
    const { blueprint } = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    process.stdout.write(`${blueprint?.slug ?? ""} ${blueprint?.pageCount ?? ""}`);
  } catch { }' <<<"${response}")"
[[ "${blueprint}" == "${BLUEPRINT_SLUG} 1" ]] ||
  fail "upload_blueprint should have made the one-page Blueprint ${BLUEPRINT_SLUG}; it answered: ${response}"

# The Color case's Home: a second Home with a Settled Design Direction, which the case picks with
# EVAL_SETTLE_HOME. A Settled Direction on the fixture Home would change what the Design Direction case
# sees, since that case saves the Home's first Direction.
COLOR_HOME_SLUG=fixture-flat
echo "Creating ${COLOR_HOME_SLUG} with a Settled Design Direction..."
response="$(curl -sS -X POST "${BASE}/api/create_home" -H "Content-Type: application/json" \
  -d '{"name":"Fixture Flat","country":"GB","city":"London"}')"
slug="$(node -e '
  try { process.stdout.write(JSON.parse(require("node:fs").readFileSync(0, "utf8")).home?.slug ?? ""); }
  catch { }' <<<"${response}")"
[[ "${slug}" == "${COLOR_HOME_SLUG}" ]] ||
  fail "create_home should have made the Home ${COLOR_HOME_SLUG}; it answered: ${response}"
node scripts/seed-live-direction.mjs "${BASE}/mcp/homes/${COLOR_HOME_SLUG}" ||
  fail "Seeding the Design Direction of ${COLOR_HOME_SLUG} failed."

# The Purchase case's Home: a third Home with a Settled Design Direction and a Settled Palette, which
# the case picks with EVAL_SETTLE_HOME. A Settled Palette on Fixture Flat would change what the Color
# case sees, since that case saves the Home's first Palette.
PURCHASE_HOME_SLUG=fixture-loft
echo "Creating ${PURCHASE_HOME_SLUG} with a Settled Design Direction and Palette..."
response="$(curl -sS -X POST "${BASE}/api/create_home" -H "Content-Type: application/json" \
  -d '{"name":"Fixture Loft","country":"GB","city":"London"}')"
slug="$(node -e '
  try { process.stdout.write(JSON.parse(require("node:fs").readFileSync(0, "utf8")).home?.slug ?? ""); }
  catch { }' <<<"${response}")"
[[ "${slug}" == "${PURCHASE_HOME_SLUG}" ]] ||
  fail "create_home should have made the Home ${PURCHASE_HOME_SLUG}; it answered: ${response}"
node scripts/seed-live-palette.mjs "${BASE}/mcp/homes/${PURCHASE_HOME_SLUG}" ||
  fail "Seeding the Design Direction and Palette of ${PURCHASE_HOME_SLUG} failed."

status=0
claude plugin eval ./plugin --eval-dir evals-live --mocks off \
  --allow-tools "mcp__plugin_live-server_settle__*" \
  --trust-plugin --ablation none --no-publish --runs 1 --max-cost-usd 4 \
  --model claude-sonnet-5 "$@" || status=$?
exit "${status}"
