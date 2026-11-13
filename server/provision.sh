#!/usr/bin/env bash
# Sunucu kurulumu (droplet, Ubuntu 24.04, root). İDEMPOTENT: tekrar çalıştırmak güvenli.
# Sır YOK: MarketData tokenı ve uygulama anahtarı bu betikle değil, server/README.md'deki adımlarla yerleştirilir.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y ca-certificates curl gnupg ufw debian-keyring debian-archive-keyring apt-transport-https

# Node.js 24 LTS (NodeSource)
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" != "24" ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

# Caddy (resmi apt deposu)
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# Servis kullanıcısı (kabuksuz, ayrıcalıksız) ve dizinler
id -u ocflow >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /opt/optioncalc-flow --shell /usr/sbin/nologin ocflow
install -d -m 755 -o root -g root /opt/optioncalc-flow
install -d -m 700 -o root -g root /etc/optioncalc-flow

# Güvenlik duvarı: yalnız SSH, HTTP (ACME/yönlendirme), HTTPS
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

node -v; caddy version | head -1; ufw status | head -8
echo "provision tamam"
