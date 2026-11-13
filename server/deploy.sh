#!/usr/bin/env bash
# Sunucu kodunu (server/ + src/lib/) droplet'e kurar ve servisi yeniden başlatır. Sır taşımaz.
# Kullanım (repo kökünden):  server/deploy.sh            (varsayılan: root@162.243.88.42, anahtar ~/.ssh/do_flow)
# Ortam: FLOW_SSH_HOST, FLOW_SSH_KEY ile geçersiz kılınabilir.
set -euo pipefail
HOST="${FLOW_SSH_HOST:-root@162.243.88.42}"
KEY="${FLOW_SSH_KEY:-$HOME/.ssh/do_flow}"
SSHOPT=(-i "$KEY" -o StrictHostKeyChecking=accept-new -o BatchMode=yes)
cd "$(dirname "$0")/.."

STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/server" "$STAGE/src"
cp -R server/app server/fixtures "$STAGE/server/"
cp server/package.json "$STAGE/server/package.json"
cp server/package.json "$STAGE/package.json"        # kökte "type": "module" → src/lib/*.ts de ESM olarak yüklenir
cp -R src/lib "$STAGE/src/lib"
cp server/optioncalc-flow.service server/Caddyfile "$STAGE/"
tar -C "$STAGE" -czf "$STAGE.tgz" .
scp "${SSHOPT[@]}" "$STAGE.tgz" "$HOST:/tmp/optioncalc-flow.tgz"
rm -f "$STAGE.tgz"

ssh "${SSHOPT[@]}" "$HOST" bash -s <<'REMOTE'
set -euo pipefail
install -d -m 755 /opt/optioncalc-flow
rm -rf /opt/optioncalc-flow/server /opt/optioncalc-flow/src
tar -C /opt/optioncalc-flow -xzf /tmp/optioncalc-flow.tgz
rm -f /tmp/optioncalc-flow.tgz
chown -R root:root /opt/optioncalc-flow
chmod -R a+rX,go-w /opt/optioncalc-flow
install -m 644 /opt/optioncalc-flow/optioncalc-flow.service /etc/systemd/system/optioncalc-flow.service
if [ -f /opt/optioncalc-flow/Caddyfile ]; then install -m 644 /opt/optioncalc-flow/Caddyfile /etc/caddy/Caddyfile; fi
systemctl daemon-reload
systemctl enable optioncalc-flow >/dev/null 2>&1 || true
systemctl restart optioncalc-flow
if command -v caddy >/dev/null 2>&1; then systemctl reload caddy 2>/dev/null || systemctl restart caddy; fi
sleep 2
systemctl is-active optioncalc-flow
REMOTE
echo "deploy tamam"
