# Akış sunucusu (`server/`)

Tek MarketData istemcisi. Hem uygulamanın MarketData isteklerini (hisse kotu, vade listesi, zincir, mum) proxy'ler,
hem de olağandışı opsiyon akışını dakikalarca tarar ve teyitli olayları Expo push ile bildirir.
Spec: [`docs/tasks/FLOW.md`](../docs/tasks/FLOW.md). Uygulama tarafı: `src/lib/flow/`, `src/screens/Akis.tsx`.

- Dağıtım: DigitalOcean droplet `optioncalc-flow` (162.243.88.42, Ubuntu 24.04, 1 GB), Node 24 LTS, systemd, Caddy (HTTPS).
- Adres: **https://162-243-88-42.sslip.io** (yalnız HTTPS; port 80 yalnızca ACME/yönlendirme).
- Sıfır npm bağımlılığı: `node:sqlite` (yerleşik SQLite, native derleme yok) ve `node:http`.
- Kod iki yerde ortaktır: `server/app/*.ts` sunucu, `src/lib/flow/*.ts` saf mantık (uygulama ve testler de kullanır).

## Güvenlik kuralları (bağlayıcı)

- **MarketData tokenı yalnız bu sunucuda.** `/etc/optioncalc-flow/md_token` (root, 600). systemd `LoadCredential` ile okur;
  ortam değişkeni olarak görünmez. Kod ortam değişkeninden token OKUMAZ (dev kutularındaki token ikinci IP yaratır).
- **Tek IP kuralı:** MarketData aynı anda tek IP'den kullanılmalı. Bu yüzden başka hiçbir yerden (telefon dâhil) MarketData çağrılmaz.
  `backtest/` scriptleri hâlâ doğrudan MarketData çağırır: sunucu çalışırken **çalıştırma** (ya da önce `systemctl stop`).
- **Uygulama anahtarı** (`x-app-key`) `/etc/optioncalc-flow/app_key` (root, 600), `openssl rand -hex 32` ile sunucuda üretilir.
  Anahtar ne sohbete ne repoya ne loga yazılır. Karşılaştırma sabit zamanlıdır; `/health` dışındaki her uç nokta anahtar ister.
- Yanıtlar ve loglar token/anahtar içermez. Hata metinleri Türkçedir ve sırsızdır.
- Uygulamadan MarketData'ya yalnızca izinli yollar geçer (`src/lib/flow/proxy.ts` `checkMdRequest`): hisse kotu, vade listesi,
  zincir (`mode=live|cached|delayed`), 1 dk mum. Diğer her yol 403.

## Uç noktalar

| Yöntem | Yol | Anahtar | Açıklama |
|---|---|:-:|---|
| GET | `/health` | – | Çalışma durumu, piyasa açık mı, son tarama, bugünkü kredi (akış + toplam), MarketData kalan kredisi |
| GET | `/status` | ✓ | Yapılandırma özeti (sırsız), 7 günlük kredi geçmişi, son tarama istatistiği |
| GET | `/flow?days=&sinceId=&limit=` | ✓ | Son N **işlem** günü olayları (varsayılan `days=3`, en çok 5; tatil/hafta sonu NYSE takvimiyle atlanır), yeni → eski (en çok 500). Yanıt: `days`, `fromDay`, `tradingDays` |
| GET | `/flow/summary` | ✓ | Bugünkü teyitli olaylarda ticker bazında call/put prim toplamı |
| POST | `/push/register` `{"token":"ExponentPushToken[…]"}` | ✓ | Expo push tokenı kaydı (en çok 50 token) |
| POST | `/push/unregister` `{"token":…}` | ✓ | Tokenı sil |
| GET | `/api/md/<MarketData yolu>?<sorgu>` | ✓ | MarketData proxy'si (yanıt MarketData ile aynı; `X-Flow-Cache`, `X-Api-Ratelimit-Consumed` başlıkları) |

Saklama: olaylar son 5 işlem günü için tutulur (`store.prune`); eski günler silinir.

Hız sınırı: dakikada 120 istek (`FLOW_RATE_PER_MIN`). Proxy yanıtları 20 sn önbelleklenir (`FLOW_CACHE_SEC`); önbellekten gelenler 0 kredi.

## Akış tespiti (özet)

1. **Vadeler** (`src/lib/flow/expiry.ts`): bugünün 0DTE'si (işlem günüyse) + 3 ay içindeki her Cuma. Cuma tatilse bir önceki işlem günü
   (ör. 2027-03-26 → 2027-03-25). Diğer vadeler atlanır.
2. **Tarama** (piyasa saatleri, tatiller dâhil; `FLOW_INTERVAL_MIN`, varsayılan 2 dk): ticker başına **tek** önbellekli istek,
   `dte=` listesi ile tüm hedef vadeler (`mode=cached&maxage=<aralık>`). 204 = yeni veri yok, kredi yok.
3. **Hacim farkı:** kontrat başına `dV = volume_t − volume_{t−1}`; `updated` değişmediyse 0; negatif fark 0. Günün ilk taraması referans toplar, olay üretmez.
4. **Eşikler** (hepsi `FLOW_*` ile ayarlanır, aşağıda): `dV ≥ FLOW_MIN_VOLUME`, `dV ≥ FLOW_MIN_VOL_OI × OI`, `mid ≥ FLOW_MIN_MID`,
   `prim = dV × mid × 100 ≥ FLOW_MIN_PREMIUM`.
5. **Canlı teyit:** en yüksek primli `FLOW_CONFIRM_PER_POLL` aday için `options/quotes/{OCC}` (kontrat başına 1 kredi). Teyitli olay
   canlı hacme göre yeniden ölçülür. Kalan adaylar **teyitsiz** kaydedilir (uygulamada “Teyitsiz” rozetiyle).
6. **Soğuma:** kontrat başına `FLOW_COOLDOWN_MIN` dakika tekrar olay yok.
7. **Push:** yalnızca **teyitli**, **geniş spread olmayan** (`(ask−bid)/mid ≤ FLOW_MAX_SPREAD_PCT`), prim ≥ `FLOW_PUSH_MIN_PREMIUM`
   olaylar; günde en çok `FLOW_PUSH_MAX_PER_DAY`.

### Bilinen sınırlar (dürüst)

- MarketData işlem düzeyi veri vermez: sweep/blok, borsa, tek işlem büyüklüğü **bilinmez**. Taraf “tahmini”dir ve `last` alanından çıkarılır.
- `volume` yalnız poll anlarında görülür; iki poll arasındaki işlemler tek dV’ye karışır. Önbellek tazeliği garanti değildir.
- **Canlı doğrulama (2026-11-13, Cuma kapanışı, 5 kredi):** cached zincir + `dte` listesi: `consumed = 1`, yanıt 4 880 satır,
  ~800 KB, gerekli tüm alanlar var (`volume`, `openInterest`, `updated`, `bid/ask/mid/last`). `options/quotes` (teyit) sütun biçimli,
  aynı alanlarla dönüyor. Hisse kotu (proxy): `consumed = 1`. Her çağrının kredisi kendi yanıt başlığında (`x-api-ratelimit-consumed`).
- **Vade çözümü:** `dte` listesi her değeri en yakın *listelenmiş* vadeye çözer. QQQ’da 14 planlanan Cumadan 10’u listeli
  (2027-01-08, 01-22, 02-05, 02-12 yok); liste dışı çıkan vadeler (ör. 2027-02-19 aylık) tarayıcı tarafından süzülür. Beklenen davranış.
- Canlı tespit ilk kez **Pazartesi 2026-11-16 09:30 ET** sonrası çalışır; sonuç `journalctl -u optioncalc-flow` ve `/status` ile izlenir.
- Expo push: uzak push’un Expo Go’da çalışması garanti değildir; derleme (development/production build) gerekebilir. Uygulama
  izin/token hatasını Türkçe gösterir.
- Bu bir **bilgi** akışıdır. Sinyal değildir, tavsiye değildir (AGENTS.md: “No proven edge”).

## Kredi bütçesi

Kredi günü MarketData’ya göre 09:30 ET’de döner (`creditDay`). Tavanlar (hepsi env ile):

| Değişken | Varsayılan | Anlamı |
|---|---:|---|
| `FLOW_DAILY_CAP` | 10 000 | Akış tarayıcısının günlük tavanı (hedef: 10k altı) |
| `PROXY_DAILY_CAP` | 40 000 | Toplam (akış + uygulama) üst sınırı; 100k’nın altında kalır |
| `FLOW_CREDIT_RESERVE` | 5 000 | MarketData’nın kalan kredisi bunun altına inerse istekler durur |

Tahmin (2 dk aralık, 7 ticker, 6 teyit/poll): önbellekli **1 365/gün** + teyit tavanı **1 170/gün** = **≤ 2 535/gün**.
1 dk aralıkta önbellekli 2 730 + teyit. Dry-run ile planı ve tahmini gör:

```bash
npm run flow:dry                 # plan + kredi tahmini (MarketData'ya istek YOK)
npm run flow:selftest            # sunucu öz-testi (ağ YOK)
```

## Yapılandırma

`/etc/optioncalc-flow/env` (isteğe bağlı, sırsız; değişince `systemctl restart optioncalc-flow`):

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `FLOW_POLL` | `on` | `off` = tarayıcı durur, proxy çalışmaya devam eder |
| `FLOW_TICKERS` | `QQQ SPY NVDA GLD SLV MU INTC` | Taranacak tickerlar (boşlukla/virgülle) |
| `FLOW_INTERVAL_MIN` | 2 | Tarama aralığı (dk) |
| `FLOW_CONFIRM_PER_POLL` | 6 | Poll başına canlı teyit üst sınırı |
| `FLOW_MIN_PREMIUM` | 25000 | Olay eşiği: prim ($) |
| `FLOW_MIN_VOLUME` | 200 | Olay eşiği: dV (kontrat) |
| `FLOW_MIN_VOL_OI` | 0.5 | Olay eşiği: dV ≥ oran × OI |
| `FLOW_MIN_MID` | 0.05 | Gürültü: altındaki orta fiyat yok sayılır |
| `FLOW_MAX_SPREAD_PCT` | 0.3 | Geniş spread sınırı (push’u engeller) |
| `FLOW_COOLDOWN_MIN` | 15 | Aynı kontrat için bildirim soğuma süresi (dk) |
| `FLOW_PUSH_MIN_PREMIUM` | 100000 | Push eşiği: prim ($) |
| `FLOW_PUSH_MAX_PER_DAY` | 30 | Günlük push sınırı |
| `FLOW_RATE_PER_MIN` | 120 | Dış API istek sınırı (dakika) |
| `FLOW_CACHE_SEC` | 20 | Proxy yanıt önbelleği |

Sırlar (dosya, root 600): `/etc/optioncalc-flow/md_token`, `/etc/optioncalc-flow/app_key`. (İsteğe bağlı Expo erişim tokenı:
`/etc/optioncalc-flow/expo_access_token` — yalnız push’un hız sınırına takılırsa.)

## Kurulum ve dağıtım (ilk kez)

Yerelde (repo kökünde), anahtar `~/.ssh/do_flow`:

```bash
# 1) Sunucu paketleri: Node 24, Caddy, ufw (SSH/80/443), servis kullanıcısı, dizinler (idempotent)
ssh -i ~/.ssh/do_flow root@162.243.88.42 'bash -s' < server/provision.sh

# 2) MarketData tokenı: yerel dosyadan, ekrana yazmadan (umask 077, root 600)
ssh -i ~/.ssh/do_flow root@162.243.88.42 'install -d -m 700 /etc/optioncalc-flow; umask 077; cat > /etc/optioncalc-flow/md_token' < ~/.secrets/marketdata_token

# 3) Uygulama anahtarı: SUNUCUDA üretilir, ekrana yazılmaz (idempotent: varsa dokunmaz)
ssh -i ~/.ssh/do_flow root@162.243.88.42 'test -s /etc/optioncalc-flow/app_key || (umask 077; openssl rand -hex 32 > /etc/optioncalc-flow/app_key); chmod 600 /etc/optioncalc-flow/app_key; echo tamam'

# 4) Kod + Caddy + servis
server/deploy.sh
```

### Uygulama anahtarını almak (Kaan)

Anahtar sohbette ya da repoda **yoktur**. Kendi terminalinde, yalnız sana gösterilecek şekilde oku:

```bash
ssh -i ~/.ssh/do_flow root@162.243.88.42 'cat /etc/optioncalc-flow/app_key' | pbcopy   # macOS: panoya kopyalar
```

Sonra uygulamada **Hesapla › Ayarlar › “Akış sunucusu anahtarı”** alanına yapıştır. Anahtar yalnızca bu telefonda (AsyncStorage) saklanır.
Alternatif (derleme zamanı, OTA ile dağıtılır, anahtar JS paketine girer; tercih edilmez): EAS ortam değişkeni
`EXPO_PUBLIC_FLOW_API_KEY`. **Anahtarı yenilemek:** sunucuda dosyayı sil, 3. adımı yeniden çalıştır, `systemctl restart optioncalc-flow`,
uygulamada yeni anahtarı gir.

## Doğrulama

```bash
curl -s https://162-243-88-42.sslip.io/health                       # ok:true
curl -s -o /dev/null -w '%{http_code}\n' https://162-243-88-42.sslip.io/flow     # 401 (anahtarsız)
ssh -i ~/.ssh/do_flow root@162.243.88.42 'systemctl status optioncalc-flow --no-pager | head -5; journalctl -u optioncalc-flow -n 30 --no-pager'
```

Anahtarlı istek için, anahtarı yerelde bir değişkene oku (`K=$(ssh … 'cat …/app_key')`) ve `-H "x-app-key: $K"` ile kullan; ekrana yazdırma.

## Günlük işletim

- Log: `journalctl -u optioncalc-flow -f` (anahtar ve token asla yazılmaz).
- Tarayıcıyı durdurma: `FLOW_POLL=off` → `systemctl restart optioncalc-flow`. Proxy çalışmaya devam eder.
- Veritabanı: `/var/lib/optioncalc-flow/flow.db` (SQLite; 14 gün tutulur). Kredi kullanımı: `/status` veya `/health`.
- Kod güncellemesi: `server/deploy.sh` (taşıdığı tek şey `server/` ve `src/lib/`; sırlar dokunulmaz).

## Dosyalar

| Dosya | Görev |
|---|---|
| `app/main.ts` | Giriş: servis veya `--dry-run` |
| `app/config.ts` | Ortam + sır dosyaları (ortam tokenı yok) |
| `app/md.ts` | Tek MarketData istemcisi: kuyruk (aynı anda 1 istek), kredi muhasebesi, bütçe freni |
| `app/poller.ts` | Tarama döngüsü: aday → teyit → soğuma → kayıt → push |
| `app/http.ts` | HTTP uç noktaları, anahtar kontrolü, hız sınırı, proxy izin listesi, önbellek |
| `app/store.ts` | SQLite (kredi, taban, olaylar, soğuma, tokenlar) |
| `app/push.ts` | Expo push gönderimi; `DeviceNotRegistered` tokenları siler |
| `app/fixture.ts`, `fixtures/synthetic-chain.json` | Sentetik veriyle dry-run/test (gerçek MarketData verisi DEĞİL) |
| `app/selftest.ts` | Öz-test (`npm run flow:selftest`) |
| `provision.sh` | Sunucu kurulumu (idempotent) |
| `deploy.sh` | Kod dağıtımı ve servis yeniden başlatma |
| `optioncalc-flow.service`, `Caddyfile` | systemd birimi; Caddy HTTPS ters vekil |
