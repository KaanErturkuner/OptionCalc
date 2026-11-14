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
| GET | `/reports?limit=` | ✓ | Son raporlar (yeni → eski; `body` düz metin, `sections` yapılandırılmış bölümler — eski satırlarda `null`; en çok 50, varsayılan 10) |
| GET | `/reports/<id>` | ✓ | Tek rapor |
| GET | `/api/md/<MarketData yolu>?<sorgu>` | ✓ | MarketData proxy'si (yanıt MarketData ile aynı; `X-Flow-Cache`, `X-Api-Ratelimit-Consumed` başlıkları) |
| POST | `/coach` `{"image":"<base64>","mime":"image/png","day":"YYYY-MM-DD"?}` | ✓ | Koç: ekran görüntüsü → dolum çıkarma, eşleştirme, koçluk (Haiku). Bkz. "Koç" |
| POST | `/coach/process?day=YYYY-MM-DD`? | ✓ | Koç: bekleyen koçlukları işle (en çok 5) |
| GET | `/coach?day=YYYY-MM-DD` | ✓ | Günün dolumları, eşleşmiş işlemleri (rapor dâhil), açık pozisyonları, eşleşmeyen satışları, karnesi |
| POST | `/coach/karne?day=YYYY-MM-DD` | ✓ | Günün karnesini üret (Haiku) |

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
| `COACH_MODEL` | `claude-haiku-5-5` | Koç birincil modeli |
| `COACH_FALLBACK_MODEL` | (boş) | Yedek model; yalnız birincil reddedilirse, loglanarak |
| `COACH_DAILY_CAP` | 100 | Koç: 24 saatte (kayan) en çok yükleme (çıkarma çağrısı) |
| `COACH_MIN_GAP_SEC` | 2 | Koç: iki yükleme arası asgari süre (sn) |
| `COACH_KARNE_AUTO` | `on` | `off` = kapanış sonrası otomatik karne kapalı |

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

## Koç (işlem koçu, Haiku)

**Günlük (2026-11-14):** her `/coach*` isteğinin sonucu `journalctl -u optioncalc-flow | grep "koç istek"` ile görülür (durum, süre, gövde, mime, kısa not; görüntü ve anahtar yazılmaz). Caddy erişim günlüğü yalnız `/coach*` için: `/var/log/caddy/coach-access.log` (JSON; başlıklar silinir). `server/deploy.sh` Caddyfile'ı `caddy` kullanıcısıyla doğrular; geçersizse dağıtımı durdurur.


Midas ekran görüntülerinden işlemleri çıkarır, alış ile satışı **kodda** eşleştirir ve her kapanmış işlem için Türkçe koçluk
raporu yazar. Eğitim amaçlıdır; tavsiye değildir. Uygulama: Menü › **Koç** (`src/screens/Koc.tsx`).

### Akış (v2, toplu)

1. **Yükleme** (`POST /coach`, tek görüntü; uygulama 40 görüntüyü sırayla gönderir): sha256 hesaplanır. Aynı görüntü daha önce
   işlendiyse **önbellek**: Haiku çağrısı yok, sayaç işlemez.
2. **Dolum çıkarma** (Haiku #1, `EXTRACT_SYSTEM` + zorunlu araç `record_fills` = `EXTRACT_TOOL`, `max_tokens` 1024): her satır = bir dolum (`tk, exp, k, cp, q, side buy|sell, px, t, conf`); giriş + çıkış aynı görüntüde olabilir (dizi). Araç girdisi yoksa metin toleranslı ayrıştırılır (çit, önsöz, dizi). Ayrıştırma başarısızsa log: `KOÇ UYARI: dolum çıkarılamadı … stop=… in=… out=… tool=… örnek="…"` (≤300 karakter, anahtar/base64 yok).
   Dolumlar SQLite `coach_fills` tablosuna yazılır; aynı dolum (zaman+sözleşme+yön+fiyat+adet) tekrar gelirse yeni sayılmaz.
3. **Eşleştirme** (saf kod, `src/lib/coach/fills.ts`): sözleşme başına (tk+vade+strike+C/P), zaman sırasıyla **FIFO**. Alış bir parti açar;
   satış en eski partiden düşer. Parti **tamamen** kapanınca bir işlem oluşur (kademeli çıkışlar tek işlemde, çıkış fiyatı ağırlıklı
   ortalama). Kısmi kapanış = açık pozisyon (koçluk yok). Açık parti yokken gelen satış = **eşleşmeyen satış** (açılışı yüklenmemiş).
   Yükleme sırası sonucu değiştirmez (dolumlar zamana göre sıralanır); ekran görüntüsü her geldiğinde eşleştirme yeniden hesaplanır.
4. **Koçluk** (Haiku #2, yalnız **metin**, görüntü yok): her yeni kapanmış işlem için bir çağrı. Girdi: işlem, bacaklar, kurallar,
   Yahoo 1 dk bağlamı, duvar/akış (varsa). Rapor SQLite `coach_reports` tablosunda, anahtarı **işlem imzası** (dolum kimlikleri);
   aynı işlem tekrar koçlanmaz. Bir yükleme isteğinde en çok 3 koçluk yapılır; kalanı `POST /coach/process` (uygulama, bekleyen kalmayınca
   durur). Başarısız koçluk hata olarak loglanır, yüklemeyi bozmaz; aynı işlem 1 saat içinde yeniden denenmez.
5. **Karne:** `POST /coach/karne?day=` (elle) veya kapanıştan 20 dk sonra otomatik (`COACH_KARNE_AUTO=off` kapatır).

### Sınırlar ve kurallar

- **Gövde (Caddy):** `/coach*` **7 MB**, diğer uçlar **8 KB**. Tek görüntü en çok 4 MB (base64 ≈ 5,6 MB); uygulama bir istekte bir görüntü gönderir.
- **Hız:** 24 saatte (kayan) en çok **100** çıkarma çağrısı (`COACH_DAILY_CAP`), iki yükleme arası en az **2 sn** (`COACH_MIN_GAP_SEC`).
  Sınırda `429` + `kind: "gap"` (kısa bekleme) veya `kind: "daily"` (dur). Uygulama `gap`'te geri çekilip yeniden dener, `daily`'de durur.
- **Dolum kuralları:** en çok 6 satır/görüntü; zorunlu alanı (tk, vade, strike, C/P, adet, prim, saat) eksik satır atılır; hiç satır yoksa `422`.
- **Saklama:** 30 gün (dolum, rapor, karne, çağrı kaydı). Eşleştirme penceresi de 30 gün; bundan eski açık pozisyonlar görünmez olur.
- **Model:** `COACH_MODEL` (varsayılan `claude-haiku-5-5`). Yedek `COACH_FALLBACK_MODEL` yalnız tanımlıysa ve birincil reddedilirse
  kullanılır (`KOÇ UYARI` logu, `fallback=1`).
- **Anahtar:** `/etc/optioncalc-flow/anthropic_key` (root, 600), systemd `LoadCredential=anthropic_key`. Loglarda ve yanıtlarda yok.
  Dosya **boşsa** koç `503 Koç yapılandırılmadı` döner. `LoadCredential` kaynağı yoksa servis başlamaz (`status=243/CREDENTIALS`).
  `server/deploy.sh` boş, root 600 yer tutucuyu idempotent oluşturur. Kopyalama (anahtar ekrana basılmadan):
  ```bash
  printf '%s' "$ANTHROPIC_API_KEY" | ssh -i ~/.ssh/do_flow root@162.243.88.42 'umask 077; cat > /etc/optioncalc-flow/anthropic_key'
  ssh -i ~/.ssh/do_flow root@162.243.88.42 'systemctl restart optioncalc-flow'
  ```
- **Log:** her Haiku çağrısı `koç <tür> model=… in=… out=… stop=<stop_reason>`; `stop=max_tokens` = çıktı kesildi.

### Uç noktalar ve yanıtlar

- `POST /coach` → `{ day, duplicate, added, fills:[{id,t,tk,exp,k,cp,q,side,px,conf}], note, model, fallback, coached, pending, warnings, usage }`.
  `duplicate: true` ise Haiku çağrılmadı. Hata: `429` (`error`, `kind`, `retryAfterSec`), `422` (satır okunamadı), `400`, `503`, `502`.
- `POST /coach/process?day=` → `{ processed, pending, errors }`.
- `GET /coach?day=` → `{ day, fills, trades:[{sig,tk,exp,k,cp,qty,entryT,entryPx,exitT,exitPx,legs,conf,status:"hazir"|"bekliyor",ts,report}],
  open:[{tk,exp,k,cp,qty,entryT,entryPx,closedQty,closedPx}], orphans:[fill], pending, karne, usage }`.
  `report` (TradeReport, `src/lib/coach/types.ts`): başlık (brüt/net P/L, komisyon $1,50/kontrat/yön, kodda), öncesi/sırasında/sonrası,
  çıkış/giriş/strike kararları (✅⚠️❌❔, kodda emoji), kaçan fırsat (**tahmini**, BS IV %45), 3 somut öneri, karne (/10).
  Sayılar kodda hesaplanır; model yalnız yorum ve karar üretir.

### Maliyet tahmini (Haiku 5.5: girdi $0,10 / çıktı $0,50 per MTok; 100K altı istem)

Varsayım: görüntü ≈ 1.600 token (görüntü boyutuna bağlı; **ölçülmedi**, aşağıda), çıkarma istemi ≈ 450 token, çıktı ≈ 150 token;
koçluk girdisi ≈ 3.500 token (istem + bağlam JSON; görüntü yok), çıktısı ≈ 1.500 token (canlı denemede 1.266–2.054).

| Kalem | Adet/gün | Girdi | Çıktı | Maliyet |
|---|---|---|---|---|
| Dolum çıkarma | 40 | 40 × ~2.050 ≈ 82K | 40 × 150 = 6K | ≈ $0,011 |
| Koçluk (eşleşen kapanmış işlem) | 20 | 20 × 3.500 = 70K | 20 × 1.500 = 30K | ≈ $0,022 |
| Karne | 1 | ≈ 3K | ≈ 0,5K | ≈ $0,001 |
| **Toplam** | | | | **≈ $0,035 / gün** (≈ $1 / 30 gün) |

Önbellek (aynı görüntü) ve yeniden koçlanmayan işlemler maliyeti düşürür. Üst sınır: 100 çıkarma/24 sa ≈ $0,03 (çıkarma) + en çok
koçluk. Gerçek görüntü tokeni `usage.inTok` ile yanıtta ve `GET /coach` içinde (`usage`) izlenir; ilk gerçek yüklemeden sonra bu tahmin güncellenmeli.

### Yerel kuru test (ağ YOK, ücret YOK)

`npm run flow:selftest`: sahte Anthropic ve Yahoo ile çıkarma → önbellek → sırasız yükleme → kısmi çıkış → koçluk hatası ve kurtarma →
hız sınırı (gap/daily) → karne → anahtar sızıntısı yok. Saf eşleştirme: `test/coach-fills.test.ts`; yükleme kuyruğu: `test/coach-queue.test.ts`.

### Uygulama (özet)

- Seçici: en çok **40** görüntü (`src/ui/coachPicker.ts`, `expo-image-picker`); yükleme sırası: `src/lib/coach/queue.ts` (ilerleme `n/N`,
  429/ağ/5xx'te üstel geri çekilme, günlük sınırda ve 401'de durur, tek görüntü hatasında devam eder).
- Ekran: eşleşmiş işlemler (rapor kartı veya "koçluk bekliyor"), açık pozisyonlar, eşleşmeyen satışlar, okunan dolumlar, karne.

## Raporlar (zamanlanmış piyasa özetleri)

`server/app/reporter.ts` + saf mantık `src/lib/reports/`. Kural tabanlı metin (LLM yok), Türkçe.

| Rapor | Zaman (İst, kış / yaz) | İçerik |
|---|---|---|
| Piyasa öncesi | açılış −30 dk (17:00 / 16:00) | Asya (Nikkei, Hang Seng), Avrupa (FTSE, DAX), vadeliler (ES, NQ), izleme listesi ön piyasa, haberler, makro (FOMC/CPI/NFP), bilanço, beklenti |
| Açılış +30 dk, +1,5 sa, +2,5 sa, +3,5 sa | 18:00 / 19:00 / 20:00 / **21:00** (yaz: −1 sa) | Açılıştan beri hareket, **şu ana kadar ne oldu** (açılış, seans yükseği/dibi, VWAP, rejim değişimleri, en sert 15 dk), **rejim** (konsolidasyon bant / trend / onaylı dönüş), **bundan sonra** devam · dönüş · yatay olasılıkları (kural tabanlı, toplam 100) ve tetikleyiciler; duvar kayması, birikim, haberler |
| Gün sonu | kapanış +30 dk (yaz 23:30; kış 00:30) | Gün değişimi, duvar kayması, SMA20/50/200, birikim, haberler, yarın beklentisi |

- Zamanlar ABD açılış/kapanışına çapalıdır (ET, DST dâhil): ABD tatilinde rapor yok; erken kapanış (13:00 ET) günlerinde gün sonu kapanışa göre kayar; 21:00 (açılış +3,5 sa) erken kapanışta atlanır.
- **Rejim** (`src/lib/market/regime.ts`, eşikler `REGIME_K`): QQQ (yoksa SPY) 1 dk barları Yahoo'dan (önceki 4 gün dâhil, yalnız rapor anından önce tamamlananlar). Konsolidasyon: son 75 dk aralığı ≤ 3,5×ATR14(5 dk) ve ≤ seansın %50'si, ve hacim düşük (≤ 0,8×) ya da ≥ 3 VWAP geçişi; onaylı dönüş: seans uç noktasından ≥ %0,3 ters hareket ve son 30 dk'da ≥ 2 teyit (VWAP geri alma/kaybı, 1,5× hacimli ters mum, 5 dk yapı). Konsolidasyonda karar BEKLE + bant kırılım tetikleyicileri ("bant üstü X → CALL, bant altı Y → PUT").
- Rejim yoksa (erken seans, bar yok) karar eski eğilim kuralıyla verilir.
- **Veri:** duvarlar poller'ın önbelleğe aldığı zincirlerden (MarketData'ya EK kredi yok). Yahoo chart (anahtarsız, seri, 350 ms aralık). Finnhub (haber, bilanço) — anahtar `/etc/optioncalc-flow/finnhub_key` (root 600), systemd `LoadCredential`; **anahtar URL'de değil, `X-Finnhub-Token` başlığında gider**.
- Kaynak hatası → metinde “veri alınamadı” satırı; rapor yine üretilir. Saklama 30 gün (`reports` tablosu). Her rapor sonunda kısa Expo push (kayıtlı tokenlara).
- **Yapılandırılmış bölümler** (`reports.sections` JSON, `src/lib/reports/sections.ts`): özet (CALL/PUT/BEKLE, ana seviyeler, tek cümle plan), metrikler, duvarlar (merdiven uygulamada bu seviyelerden çizilir), takvim (ET + İst, etki), haberler (etki etiketi), akış yığını, gün sonu incelemesi (beklenti–gerçek, duvar kayması okları, yarın planı). Push metni yine kısa düz metindir. Şema: `ReportSections` (`src/lib/reports/types.ts`).
- Kapatma: `REPORTS=off` (ortam). Finnhub anahtarı yoksa haber/bilanço “veri alınamadı” olur.
- **Kuru çalıştırma** (ağ YOK, DB YOK, push YOK; sentetik fixture):
  ```bash
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON server/app/main.ts --report-dry-run premarket   # premarket | intra1 | intra2 | intra3 | intra4 | eod
  ```
- Sınır: duvar anlık görüntüsü, akış tarayıcısı çalışırken alınır (seans dışında ve tarayıcı kapalıyken rapor “anlık görüntü yok” der). Gün içi birikim yalnız eşik üstü olaylardan toplanır (dV).

### Örnek raporlar (geçmiş gün, nokta-zamanlı)

`server/app/backfill.ts` bir geçmiş işlem günü için 6 raporu yeniden kurar (17:00 / 18:00 / 19:00 / 20:00 / 21:00 İst, gün sonu; yaz saatinde ara raporlar 1 saat erken).
**Nokta-zamanlı:** her rapor yalnız kendi anından önce **tamamlanmış** veriyi görür (`src/lib/reports/pit.ts`):

- Yahoo barları yalnız `t + süre ≤ rapor anı` ise; `period2` = rapor anı (sonrası istenmez). Günlük kapanış yalnız 16:00 ET rapor anından önceyse.
- Önceki gün kapanışı: yerel (borsa saat dilimi) tarihi rapor gününden önce olan son günlük bar; fiyat: rapor günü ve rapor anından önceki son bar.
- Haber: yayın zamanı `[pencere başı, rapor anı)`. Bilanço takvimi: geçmiş anlık görüntü yok → “veri alınamadı”.
- Duvar anlık görüntüsü: yalnız rapor anından önce yazılmışsa (`snap`); akış olayı: `events.ts < rapor anı`. Kayıt yoksa “veri alınamadı” (sahte “birikim yok” yazılmaz).
- **MarketData çağrısı YOK** (`md.ts` içe aktarılmaz). Push YOK. Başlık öneki “Örnek · …”, `example = 1` (API'de `example: true`), gövde başında “ÖRNEK RAPOR” notu.
- Anahtar `ornek:<gün>:<tür>` ile saklanır (gerçek rapor anahtarıyla çakışmaz). Yeniden yazma: `--force` yalnız örnekleri siler.
- **Duvar ve birikim (önceki kapanış):** canlı akış kaydı yoksa rapor, **önceki işlem gününün** tarihsel EOD opsiyon zincirinden kurulur (`hist_chain` tablosu). Her bölüm başlığı “önceki kapanış (12/11) zincirine göre” diye etiketlenir; intra raporlarda açılış anı olmadığı için kayma yazılmaz ve “Gözlem” notu yazılmaz (spot önceki kapanıştır). Gün sonu raporunda kayma yalnız 12/11 → gün sonu (13/11) zincirleri varsa hesaplanır. Birikim = OI × orta fiyat × 100 (işlem akışı değil).
- Zincir çekimi (**yalnız sunucu, tek MarketData istemcisi**, `server/app/histfetch.ts`): ticker × vade başına bir istek (`date=`, `expiration=`); vade kümesi akışla aynı (0DTE + 3 ay Cuma). Kredi: tarihsel yanıt 1000 sembol başına 1 kredi (başlık `x-api-ratelimit-consumed`); bir istek en az 1 kredi.
  ```bash
  ssh -i ~/.ssh/do_flow root@162.243.88.42 'systemd-run --pipe --wait --collect -q -p User=ocflow -p Group=ocflow -p WorkingDirectory=/opt/optioncalc-flow \
    -p EnvironmentFile=-/etc/optioncalc-flow/env -p StateDirectory=optioncalc-flow -p LoadCredential=md_token:/etc/optioncalc-flow/md_token \
    -p Environment=FLOW_DB=/var/lib/optioncalc-flow/flow.db \
    /usr/bin/node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON /opt/optioncalc-flow/server/app/histfetch.ts --date 2026-11-12 --report-day 2026-11-13 --max-credits 450'
  ```
  Önce 12/11 (zorunlu), sonra gün sonu için `--date 2026-11-13`. Kredi tavanı (`--max-credits`) aşılırsa durur. Backfill MarketData'ya **çağrı yapmaz**; yalnız `hist_chain` okur.

Çalıştırma (droplet; servis kullanıcısı `ocflow` olarak, Finnhub anahtarı `LoadCredential` ile — anahtar ekrana basılmaz; DB sahibi değişmez):

```bash
ssh -i ~/.ssh/do_flow root@162.243.88.42 'systemd-run --pipe --wait --collect -q \
  -p User=ocflow -p Group=ocflow -p WorkingDirectory=/opt/optioncalc-flow \
  -p EnvironmentFile=-/etc/optioncalc-flow/env -p StateDirectory=optioncalc-flow \
  -p LoadCredential=finnhub_key:/etc/optioncalc-flow/finnhub_key \
  -p Environment=FLOW_DB=/var/lib/optioncalc-flow/flow.db \
  /usr/bin/node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON /opt/optioncalc-flow/server/app/backfill.ts --day 2026-11-13'
```

Kuru çalıştırma: aynı komuta `--dry-run` ekleyin (DB yazmaz, metni yazdırır). Örnekler 30 gün sonra diğer raporlarla birlikte silinir.

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
| `app/backfill.ts` | Örnek raporlar: geçmiş gün için nokta-zamanlı yeniden kurulum (yalnız sunucu, MarketData yok, push yok) |
| `app/coach.ts` | Koç: Anthropic istemcisi (yedek model), yükleme (önbellek, dolum çıkarma, eşleştirme), koçluk kuyruğu, karne, oto-karne |
| `app/fixture.ts`, `fixtures/synthetic-chain.json` | Sentetik veriyle dry-run/test (gerçek MarketData verisi DEĞİL) |
| `app/selftest.ts` | Öz-test (`npm run flow:selftest`) |
| `provision.sh` | Sunucu kurulumu (idempotent) |
| `deploy.sh` | Kod dağıtımı ve servis yeniden başlatma |
| `optioncalc-flow.service`, `Caddyfile` | systemd birimi; Caddy HTTPS ters vekil |
