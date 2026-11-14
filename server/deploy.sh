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
[ -d dist-web ] || { echo "dist-web yok: önce npx expo export --platform web --output-dir dist-web" >&2; exit 1; }
cp -R dist-web "$STAGE/web"
tar -C "$STAGE" -czf "$STAGE.tgz" .
scp "${SSHOPT[@]}" "$STAGE.tgz" "$HOST:/tmp/optioncalc-flow.tgz"
rm -f "$STAGE.tgz"

ssh "${SSHOPT[@]}" "$HOST" bash -s <<'REMOTE'
set -euo pipefail
install -d -m 755 /opt/optioncalc-flow
rm -rf /opt/optioncalc-flow/server /opt/optioncalc-flow/src /opt/optioncalc-flow/web
tar -C /opt/optioncalc-flow -xzf /tmp/optioncalc-flow.tgz
rm -f /tmp/optioncalc-flow.tgz
# Koç erişim günlüğü: dosya caddy kullanıcısına ait olmalı (root olarak açılırsa Caddy başlamaz → site düşer)
install -d -o caddy -g caddy -m 755 /var/log/caddy
[ -e /var/log/caddy/coach-access.log ] || install -o caddy -g caddy -m 640 /dev/null /var/log/caddy/coach-access.log
# Caddyfile geçersizse dağıtımı durdur; doğrulama caddy kullanıcısıyla (günlük dosyası root'a ait olmasın)
if command -v caddy >/dev/null 2>&1; then
  install -o caddy -g caddy -m 644 /opt/optioncalc-flow/Caddyfile /tmp/Caddyfile.validate
  runuser -u caddy -- caddy validate --config /tmp/Caddyfile.validate --adapter caddyfile >/dev/null 2>&1 || { rm -f /tmp/Caddyfile.validate; echo "Caddyfile GEÇERSİZ — dağıtım durduruldu" >&2; exit 1; }
  rm -f /tmp/Caddyfile.validate
fi
chown -R root:root /opt/optioncalc-flow
chmod -R a+rX,go-w /opt/optioncalc-flow
install -m 644 /opt/optioncalc-flow/optioncalc-flow.service /etc/systemd/system/optioncalc-flow.service
if [ -f /opt/optioncalc-flow/Caddyfile ]; then install -m 644 /opt/optioncalc-flow/Caddyfile /etc/caddy/Caddyfile; fi
# LoadCredential: kaynak dosya yoksa systemd servisi başlatmaz (status=243). Koç anahtarı henüz yoksa boş, root 600 yer tutucu.
test -e /etc/optioncalc-flow/anthropic_key || (umask 077; : > /etc/optioncalc-flow/anthropic_key)
chmod 600 /etc/optioncalc-flow/anthropic_key
systemctl daemon-reload
systemctl enable optioncalc-flow >/dev/null 2>&1 || true
systemctl restart optioncalc-flow
if command -v caddy >/dev/null 2>&1; then systemctl reload caddy 2>/dev/null || systemctl restart caddy; fi
sleep 2
systemctl is-active optioncalc-flow
REMOTE
echo "deploy tamam"
