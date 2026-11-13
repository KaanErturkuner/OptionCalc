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
| GET | `/reports?limit=` | ✓ | Son raporlar (yeni → eski, tam metin; en çok 50, varsayılan 10) |
| GET | `/reports/<id>` | ✓ | Tek rapor |
| GET | `/api/md/<MarketData yolu>?<sorgu>` | ✓ | MarketData proxy'si (yanıt MarketData ile aynı; `X-Flow-Cache`, `X-Api-Ratelimit-Consumed` başlıkları) |
| POST | `/coach` `{"image":"<base64>","mime":"image/png","day":"YYYY-MM-DD"?}` | ✓ | Koç: görüntüden işlem çıkarma + koçluk (Haiku). Bkz. "Koç" |
| GET | `/coach?day=YYYY-MM-DD` | ✓ | Günün koçluk kayıtları, kuralları, geri bildirimleri ve karnesi |
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
| `COACH_DAILY_CAP` | 20 | Koç: günlük istek sınırı (son 24 sa) |
| `COACH_MIN_GAP_SEC` | 10 | Koç: iki istek arası asgari süre (sn) |
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

Midas işlem ekran görüntüsünü alır; **Haiku** (`claude-haiku-5-5`) işlemi okur, Kaan'ın kurallarına ve çıkıştan sonraki fiyat hareketine göre
Türkçe geri bildirim yazar. Eğitim amaçlıdır; tavsiye değildir.

- **Akış (tek istek):** görüntü → Haiku #1 (işlem çıkarma, JSON) → bağlam: dayanak 1 dk mumu (**Yahoo**, MarketData kredisi YOK),
  seans VWAP, giriş/çıkış çevresi 5 dk mumları, çıkış sonrası hareket (15/30/60 dk, lehe/aleyhe), hacim patlaması, duvar
  anlık görüntüsü (`snap`, poller'dan), akış olayları (SQLite) → Haiku #2 (görüntü + bağlam, koçluk JSON) → SQLite.
- **Girdi:** `POST /coach` gövdesi `{ image: <base64>, mime: "image/png" | "image/jpeg", day?: "YYYY-MM-DD" }`. Çözülmüş görüntü en çok **4 MB**
  (gövde sınırı 6 MB); PNG/JPEG imza baytları kontrol edilir. Gün verilmezse bugün (ET); son 7 güne kadar.
- **Hız sınırı:** günde en çok **20** istek (son 24 sa, `COACH_DAILY_CAP`), iki istek arası en az **10 sn** (`COACH_MIN_GAP_SEC`). Sayaç SQLite'ta (`coach_calls`), yeniden başlatmada sıfırlanmaz.
- **Kurallar (deterministik, `src/lib/coach/rules.ts`):** giriş 16:30–20:00 İst; 0–3 DTE; prim stopu = giriş × 0,33 (%67 kayıp);
  hedef 1:5 (yedek 1:4), brüt. Görüntüden okunamayan değer "bilinmiyor" olur, uydurulmaz.
- **Model:** `COACH_MODEL` (varsayılan `claude-haiku-5-5`). **Yedek model** `COACH_FALLBACK_MODEL` YALNIZ tanımlıysa ve birincil model
  reddedilirse (404 / not_found / model hatası) kullanılır; her yedek kullanımı `KOÇ UYARI` olarak loglanır ve çağrı kaydında `fallback=1` olur.
  Yedek tanımsızsa açık hata döner (sessiz geçiş yok).
- **Anahtar:** `/etc/optioncalc-flow/anthropic_key` (root, 600), systemd `LoadCredential=anthropic_key`. Ortam değişkeni olarak görünmez; loglarda
  ve yanıtlarda yer almaz. Dosya **boşsa** (yer tutucu) koç `503 Koç yapılandırılmadı` döner; diğer uç noktalar çalışır.
  **Dikkat:** `LoadCredential` kaynak dosyası yoksa systemd servisi başlatmaz (`status=243/CREDENTIALS`, 2026-11-13 deneminde yaşandı).
  `server/deploy.sh` boş, root 600 yer tutucuyu idempotent oluşturur.
  Kopyalama (anahtar ekrana basılmadan; yerelde `ANTHROPIC_API_KEY` tanımlı olmalı):
  ```bash
  printf '%s' "$ANTHROPIC_API_KEY" | ssh -i ~/.ssh/do_flow root@162.243.88.42 'umask 077; cat > /etc/optioncalc-flow/anthropic_key'
  ssh -i ~/.ssh/do_flow root@162.243.88.42 'systemctl restart optioncalc-flow'
  ```
- **Karne:** `POST /coach/karne?day=` (elle) veya **otomatik**: işlem günü kapanıştan 20 dk sonra, o güne ait koçluk kaydı varsa ve karne
  yoksa üretilir (dakikada bir kontrol; başarısızlıkta saatte bir yeniden dener). `COACH_KARNE_AUTO=off` kapatır.
- **Kayıt:** `coach_calls` (her Haiku çağrısı: model, giriş/çıkış token, süre, hata, yedek), `coach_trades` (işlem, kurallar, geri bildirim, bağlam),
  `coach_karne`. 30 gün tutulur.
- **Yanıt (özet):** `{ day, model, fallback, okuNamadi, warning, usage:{inTok,outTok}, trades:[{id, trade, rules, report, noData}] }`.
  `report` (TradeReport, `src/lib/coach/types.ts`): `header` (ticker, strike, C/P, DTE, giriş/çıkış, **brüt ve net P/L** — komisyon kodda
  hesaplanır: $1,50 / kontrat / yön), `neOldu` (öncesi/sırasında/sonrası + sayılar), `cikis` (✅/⚠️/❌ + neden), `giris` (karar, VWAP
  uzaklığı, pencere), `strike` (OTM %, beklenen harekete oranı; kural ≈ 0,5), `kacanFirsat` (tutarken/sonra lehe hareket; opsiyon
  değerleri **tahmini**, Black-Scholes IV %45), `birDahakine` (tam 3 madde), `karne` (3 puan /10 + açıklama).
  Model yalnız yorum ve karar üretir; sayılar `src/lib/coach/report.ts` + `context.ts` tarafından hesaplanır.
- **Uygulama:** Menü › **Koç** (`src/screens/Koc.tsx`). Görsel seçici için `expo-image-picker` gerekir; **kurulu değil** (native modül,
  OTA ile eklenemez → dev build). Seçici yokken ekran yükleme düğmesinde açıklama gösterir; liste, geri bildirim ve karne çalışır.
  Seçici eklenince yalnız `src/ui/coachPicker.ts` `pickScreenshot()` doldurulur.
- **Yerel kuru test (ağ YOK, ücret YOK):** `npm run flow:selftest` sahte Anthropic/Yahoo ile uçtan uca koçu sınar.

## Raporlar (zamanlanmış piyasa özetleri)

`server/app/reporter.ts` + saf mantık `src/lib/reports/`. Kural tabanlı metin (LLM yok), Türkçe.

| Rapor | Zaman (İst, kış / yaz) | İçerik |
|---|---|---|
| Piyasa öncesi | açılış −30 dk (17:00 / 16:00) | Asya (Nikkei, Hang Seng), Avrupa (FTSE, DAX), vadeliler (ES, NQ), izleme listesi ön piyasa, haberler, makro (FOMC/CPI/NFP), bilanço, beklenti |
| Açılış +30 dk, +1,5 sa, +2,5 sa | 18:00 / 19:00 / 20:00 (yaz: −1 sa) | Açılıştan beri hareket, duvar kayması (açılış → şimdi: call/put duvarı, gamma flip, max pain), opsiyon birikimi, haberler, beklenti |
| Gün sonu | kapanış +30 dk (yaz 23:30; kış 00:30) | Gün değişimi, duvar kayması, SMA20/50/200, birikim, haberler, yarın beklentisi |

- Zamanlar ABD açılış/kapanışına çapalıdır (ET, DST dâhil): ABD tatilinde rapor yok; erken kapanış (13:00 ET) günlerinde gün sonu kapanışa göre kayar.
- **Veri:** duvarlar poller'ın önbelleğe aldığı zincirlerden (MarketData'ya EK kredi yok). Yahoo chart (anahtarsız, seri, 350 ms aralık). Finnhub (haber, bilanço) — anahtar `/etc/optioncalc-flow/finnhub_key` (root 600), systemd `LoadCredential`; **anahtar URL'de değil, `X-Finnhub-Token` başlığında gider**.
- Kaynak hatası → metinde “veri alınamadı” satırı; rapor yine üretilir. Saklama 30 gün (`reports` tablosu). Her rapor sonunda kısa Expo push (kayıtlı tokenlara).
- Kapatma: `REPORTS=off` (ortam). Finnhub anahtarı yoksa haber/bilanço “veri alınamadı” olur.
- **Kuru çalıştırma** (ağ YOK, DB YOK, push YOK; sentetik fixture):
  ```bash
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON server/app/main.ts --report-dry-run premarket   # premarket | intra1 | intra2 | intra3 | eod
  ```
- Sınır: duvar anlık görüntüsü, akış tarayıcısı çalışırken alınır (seans dışında ve tarayıcı kapalıyken rapor “anlık görüntü yok” der). Gün içi birikim yalnız eşik üstü olaylardan toplanır (dV).

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
| `app/coach.ts` | Koç: Anthropic istemcisi (yedek model), görüntü → çıkarma → bağlam → koçluk, karne, oto-karne |
| `app/fixture.ts`, `fixtures/synthetic-chain.json` | Sentetik veriyle dry-run/test (gerçek MarketData verisi DEĞİL) |
| `app/selftest.ts` | Öz-test (`npm run flow:selftest`) |
| `provision.sh` | Sunucu kurulumu (idempotent) |
| `deploy.sh` | Kod dağıtımı ve servis yeniden başlatma |
| `optioncalc-flow.service`, `Caddyfile` | systemd birimi; Caddy HTTPS ters vekil |
