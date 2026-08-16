#!/usr/bin/env bash
#
# Portable smoke test for dsh-loop-dock.
#
# Run this ON THE TARGET MACHINE with a built package tarball:
#
#   bash scripts/smoke-portable.sh /path/to/dsh-loop-dock-0.1.0.tgz
#
# It performs the same "clean computer" validation the repository uses:
#   1. creates a throwaway DSH_HOME (no existing profile/config pollution);
#   2. installs the tarball into a fresh `web` profile via `dsh plugin add`;
#   3. boots the DSH web server;
#   4. verifies the client bundle is served;
#   5. verifies the bundled patch enables `fake-driver`, then exercises the
#      `agentLoops` Remote RPC:
#      listDrivers -> setDefaultDriver('fake-driver') -> listDrivers again;
#   6. verifies the choice landed in the durable settings file.
#
# The fake driver is local and needs no API key, so this proves packaging,
# plugin loading, client wiring, and driver routing without a model account.
# Real-model and UI checks remain manual and are printed at the end.

set -euo pipefail

PKG_TGZ="${1:-}"
if [[ -z "$PKG_TGZ" || ! -f "$PKG_TGZ" ]]; then
  echo "usage: bash scripts/smoke-portable.sh /path/to/dsh-loop-dock-0.1.0.tgz" >&2
  exit 2
fi

for tool in dsh curl node; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "missing required tool: $tool" >&2
    exit 2
  fi
done

SMOKE_HOME="$(mktemp -d)"
SERVER_PID=""
cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$SMOKE_HOME"
}
trap cleanup EXIT

export DSH_HOME="$SMOKE_HOME"

echo "[1/6] installing tarball into a clean DSH web profile..."
dsh plugin --profile web add "$PKG_TGZ" >/dev/null

echo "[2/6] checking the composed profile..."
COMPOSED="$(dsh --profile web --dump-config | tr -d '\r')"
grep -q 'agent-loop-dock' <<<"$COMPOSED"
grep -q "id: agent-loop\$" <<<"$COMPOSED" || true
if grep -A4 "id: agent-loop\$" <<<"$COMPOSED" | grep -q 'disabled: true'; then
  echo "  official agent-loop row is disabled"
else
  echo "  official agent-loop row was not found; continuing" >&2
fi

echo "[3/6] checking the bundled patch enables fake-driver..."
grep -q 'fakeDriver: true' <<<"$COMPOSED"

dsh --profile web --port 0 >"$SMOKE_HOME/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if grep -q 'dsh web: http://' "$SMOKE_HOME/server.log" 2>/dev/null; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    cat "$SMOKE_HOME/server.log" >&2
    echo "server exited before boot" >&2
    exit 1
  fi
  sleep 1
done

if ! grep -q 'dsh web: http://' "$SMOKE_HOME/server.log"; then
  cat "$SMOKE_HOME/server.log" >&2
  echo "server did not boot in time" >&2
  exit 1
fi

PORT="$(grep -oE 'http://[^:]+:[0-9]+' "$SMOKE_HOME/server.log" | head -1 | awk -F: '{print $3}')"
BASE="http://127.0.0.1:$PORT"
echo "  server booted on $BASE"

rpc() {
  local endpoint="$1"
  local rpc_id="$2"
  local payload="$3"
  curl -fsS -X POST "$BASE/api/$endpoint" \
    -H 'content-type: application/json' \
    --data "{\"type\":\"client-request\",\"rpcId\":\"$rpc_id\",\"method\":\"$endpoint\",\"payload\":$payload}"
}

json_ok() {
  node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const frame = JSON.parse(input);
      const result = frame?.result;
      if (!result || result.ok !== true) process.exit(1);
      process.stdout.write(JSON.stringify(result.value));
    });
  '
}

echo "[4/6] checking the client bundle..."
curl -fsS "$BASE/plugins/dsh-loop-dock/client.js" | grep -q 'agentLoops/listDrivers'
echo "  client bundle is served"

echo "[5/6] exercising the agentLoops Remote RPC..."
LIST="$(rpc "agentLoops/listDrivers" "smoke-list-1" '{"args":{}}')"
VALUE="$(json_ok <<<"$LIST")"
node -e '
  const value = JSON.parse(process.argv[1]);
  if (!Array.isArray(value.drivers) || !value.drivers.includes("default") || !value.drivers.includes("fake-driver")) process.exit(1);
  if (value.current !== "default") process.exit(1);
' "$VALUE"
echo "  listDrivers -> default + fake-driver, current=default"

SET="$(rpc "agentLoops/setDefaultDriver" "smoke-set" '{"args":{"driver":"fake-driver"}}')"
json_ok <<<"$SET" >/dev/null
echo "  setDefaultDriver(fake-driver) -> ok"

LIST_AFTER="$(rpc "agentLoops/listDrivers" "smoke-list-2" '{"args":{}}')"
VALUE_AFTER="$(json_ok <<<"$LIST_AFTER")"
node -e '
  const value = JSON.parse(process.argv[1]);
  if (value.current !== "fake-driver") process.exit(1);
' "$VALUE_AFTER"
echo "  listDrivers after set -> current=fake-driver"

echo "[6/6] checking the persisted settings document..."
SETTINGS_FILE="$SMOKE_HOME/settings.yaml"
grep -q 'defaultDriver: fake-driver' "$SETTINGS_FILE"
echo "  settings.yaml contains agent-loops.defaultDriver=fake-driver"

echo
echo "PORTABLE SMOKE TEST PASSED"
echo
echo "Remaining manual checks on the target machine:"
echo "  1. Open $BASE in a browser; Settings -> General must show the Default driver row."
echo "  2. Switch the row to fake-driver, create a NEW session, send any message, and"
echo "     confirm the reply is: [FAKE-DRIVER] fake driver reply — generated locally, no model call."
echo "  3. Restart DSH, reopen the same session, send another message: the marker reply"
echo "     must persist (durable agentLoopDock binding), proving driver routing across restarts."
echo "  4. Switch back to default and run one real model turn with a configured DeepSeek API key."
echo "  5. To test a community preset, register its loop through"
echo "     ctx.agentLoopDock.register(...) and add a presetLoops mapping."
