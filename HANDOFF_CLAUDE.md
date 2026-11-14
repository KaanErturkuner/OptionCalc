# OptionCalc — Claude Devir Rehberi

> Bu dosya, Kaan'ın isteğiyle (14 Kasım 2026, Europe/Istanbul) Claude için yazıldı.
> Amaç: projeyi **hiç bilmeyen birine anlatır gibi** anlatmak — ne yaptık, neden yaptık, hangi veriyi nereden alıyoruz, nasıl kullanıyoruz.
>
> **Dil:** Kaan'a her zaman Türkçe hitap et. İsmi sohbette **"Başkan"**. Kod yorumları Türkçe veya İngilizce olabilir; uygulama metinleri Türkçe.
>
> **Doğruluk kuralı:** Aşağıdaki bilgiler kod, sunucu durumu, `docs/CHANGELOG.md`, `docs/TASKS.md`, `AGENTS.md` ve bu oturumun doğrulanmış notlarından gelir. Emin olunmayan yerler **«bilinmiyor»** veya **«doğrulanmadı»** diye işaretlidir. Uydurma.

---

## 0. Otuz saniyelik özet

OptionCalc (uygulama adı: **Opsiyon Hesaplayıcı**, slug `option-calc`), Kaan'ın ABD borsasında Amerikan tipi opsiyon işlemesi için yazılmış bir **iPhone uygulamasıdır**. Expo Go ile çalışır; güncellemeler kablosuz (OTA) gider. Hedef, OptionStrat gibi araçlardan daha **işleme yönelik, sade ve kullanılabilir** bir karar yardımcısı olmaktır.

Telefon tek başına her veriyi çekmez. Piyasa verisinin asıl kapısı, DigitalOcean'daki küçük bir sunucudur (`optioncalc-flow`). Bu sunucu MarketData'yı **tek IP'den** çağırır, olağandışı opsiyon akışını tarar, zamanlanmış rapor üretir ve Koç için Claude Haiku'yu çalıştırır.

Sinyaller **tavsiye değildir**. Şimdiye kadarki backtest'lerde uygulama motorunun kanıtlanmış bir avantajı yoktur. Kâğıt (simülasyon) hesap varsayılandır. Gerçek para kuralları uygulamada yazılıdır ama canlı avantaj henüz kanıtlanmamıştır.

---

## 1. Kaan kimdir, nasıl işlem yapar?

- **Ad:** Kaan Ertürküner. İstanbul'da yaşar (saat dilimi `Europe/Istanbul`, kışın UTC+3).
- **Piyasa:** Yalnız **ABD, Amerikan tipi opsiyonlar**. Avrupa / endeks (Avrupa) opsiyonu yok.
- **Aracı kurum:** **Midas**. Komisyon: **kontrat başına, yön başına 1,50 $**. Yani bir kontrat alıp satınca toplam **3,00 $** komisyon düşer. Bu sayı kodda tek kaynaktan gelir: `src/lib/paper/costs.ts` (`BROKER_COMMISSION.midas = 1.5`, `DEFAULT_COMMISSION`).
- **Tarz:** Yukarıdan aşağı (top-down) **momentum**. Kısa vade: **0–3 DTE** (vadeye kalan gün; 0DTE = bugün biten kontrat).
- **Tipik örnek:** QQQ'da dayanak fiyattan **2–3 $ uzak** (OTM) strike. Diğer sembollerde (NVDA, GLD, SLV) uzaklık **oynaklığa göre** seçilir; sabit 2–3 $ her sembole uygulanmaz.
- **Fırsat sinyal tickerları (varsayılan, uygulamadan değiştirilebilir):** QQQ, GLD, SLV, NVDA. En fazla 8 ticker (`src/lib/signals/tickers.ts`).
- **Akış / rapor izleme listesi (sunucu varsayılanı):** QQQ, SPY, NVDA, GLD, SLV, MU, INTC.
- **Kendisi OptionCalc Expo uygulamasını geliştirir.** Kodun ucuz kısmını Claude Code yazar; Grok (Başkan rolünde) yönetir, inceler, sunucuya ve Expo'ya iş bitince yollar.

Kaan'ın kendi cümleleriyle özetlenen niyet (`docs/tasks/SINYAL-FIRSAT.md` §0): uygulama güzel görünüyordu ama **işlem güvenilirliği düşüktü**. İstediği şey: seçtiği tickerlar için sinyal, her sinyalde görünür bir **güven skoru**, ve sanal sermaye ile **1:5 risk/ödül** hedefleyen bir Fırsat penceresi.

---

## 2. Projenin amacı — neden var?

Kaan hazır araçları (örneğin OptionStrat) yetersiz buldu: hem **işleme yönelik bilgi vermiyor** hem **anlaşılır değil**. OptionCalc'ın amacı:

1. Amerikan tipi opsiyonu **doğru fiyatlamak** (erken kullanım hakkı yüzünden düz Black-Scholes yetmez).
2. Seans içinde **ne olduğunu ve bundan sonra ne beklenebileceğini** sade dille, olasılıklarla göstermek.
3. Duvar, akış, rejim, makro takvimi gibi bağlamı **tek yerde** toplamak.
4. Kâğıt hesapla kuralları uygulayıp disiplini korumak (stop, hedef, kademe, gece taşıma).
5. Midas işlem görüntülerinden **koçluk** almak (eğitim; tavsiye değil).

Bu bir sinyal "kutusu" değil, **karar yardımcısıdır**. `AGENTS.md` net yazar: **"No proven edge."** Sinyalleri gerçek para tavsiyesi gibi sunma.

---

## 3. Uygulama ekranları (ne işe yarar?)

Alt sekmeler, `src/app/index.tsx` sırasıyla:

| Sekme | Ekran dosyası | Ne işe yarar? |
|---|---|---|
| **Hesapla** | `src/screens/Calc.tsx` | Amerikan opsiyon hesaplayıcı: fiyat, Greek'ler, K/Z grafiği, ısı haritası, strateji (Long Call/Put + diğer). Sembol, vade, zincir buradan yüklenir. Ayarlar da burada (veri kaynağı, akış sunucu anahtarı). |
| **Radar** | `src/screens/Radar.tsx`, `RadarDetail.tsx` | İzleme listesinde olağandışı durum, haber, detayda OI/hacim merdiven grafiği, duvarlar, gamma flip, max pain. Seans içinde varsayılan 5 dakikada bir tarar. |
| **Fırsat** | `src/screens/Firsat.tsx` | Asıl **işlem karar kartları**: skor, yön, strike, prim, stop/hedef, BEKLE, Detaylar. Kâğıt hesaba işlem **yalnızca Kaan "Onayla"ya basınca** girer. |
| **0DTE** | `src/screens/Odte.tsx` | Kısa vade tarama, sinyal motoru, "Aldım" ile pozisyon, Sonuç kartı. |
| **Akış** | `src/screens/Akis.tsx` | Sunucunun bulduğu olağandışı opsiyon akışı (son 3 işlem günü, saklama 5 işlem günü). **Bilgi amaçlıdır, sinyal değildir.** |
| **Menü** | `src/screens/Menu.tsx` | Alt sayfalar: **Geçmiş**, **Takip Listesi**, **Raporlar**, **Koç**. |

Menü kartları:

- **Geçmiş** (`Journal.tsx`): sinyal ve işlem günlüğü, kâğıt pozisyonlar, hedef/stop uyarıları.
- **Takip Listesi** (`Watchlist.tsx`): Hesapla'dan eklenen kontratların canlı kâr/zararı.
- **Raporlar** (`Raporlar.tsx`): sunucunun ürettiği seans raporları; gün klasörleri; duvar bölümü **varsayılan kapalı**, açılıp kapanır. (Menü açıklama metni hâlâ +2,5 saate kadar yazıyor; gerçekte **+3,5 saat / 21:00** raporu da var — kod `schedule.ts`.)
- **Koç** (`Koc.tsx`): Midas ekran görüntülerini yükle → dolum çıkar → FIFO eşleştir → işlem raporu + günlük karne.

---

## 4. Mimari — parçalar nasıl konuşur?

Kafanda iki kutu tut: **telefon** ve **sunucu**.

```
[ iPhone, Expo Go ]
   Hesapla / Radar / Fırsat / 0DTE / Akış / Menü
   │
   │ HTTPS + başlık x-app-key
   │ (MarketData tokenı telefonda YOK)
   ▼
[ Caddy, 443 ]  https://162-243-88-42.sslip.io
   │  /coach* gövde en çok 7 MB; diğer uçlar 8 KB
   ▼
[ optioncalc-flow, 127.0.0.1:8787, Node 24 ]
   ├── MarketData proxy'si (/api/md/...)  →  api.marketdata.app
   ├── Akış tarayıcısı (2 dk, cached zincir + canlı teyit)
   ├── Zamanlanmış raporlar (Yahoo + Finnhub + duvar/akış)
   ├── Koç (Claude Haiku; anahtar yalnız sunucuda)
   └── SQLite: /var/lib/optioncalc-flow/flow.db
```

### 4.1 Telefon (Expo uygulaması)

- **Expo SDK 58** (`expo ~58.0.24`), TypeScript, Expo Router (`src/app/`).
- EAS proje kimliği: `7a3bdc56-2e9a-496b-8d53-e2c8d271df8b`, owner `kaanert`, runtime politikası `sdkVersion`.
- Güncelleme adresi: `https://u.expo.dev/7a3bdc56-2e9a-496b-8d53-e2c8d271df8b`.
- **Şu an yalnız Expo Go + OTA.** TestFlight veya native / development build **şimdilik yok**. Kaan: native işe bulaşılmasın. Native modül gerektiren bir şey (Expo Go'da olmayan paket) eklenemez; eklenirse OTA yetmez.
- Saf iş mantığı `src/lib/**` altındadır: React yok, Node'a özgü API yok. Böylece aynı kod uygulama, birim test ve backtest'te çalışır. Node'a özgü betikler `backtest/*.mts` ve `server/app/*.ts`.

### 4.2 Sunucu (DigitalOcean droplet)

14 Kasım 2026, Europe/Istanbul 12:11 civarında doğrulandı:

| Alan | Değer |
|---|---|
| Droplet adı | `optioncalc-flow` |
| IP | `162.243.88.42` |
| OS | Ubuntu 24.04, 1 GB RAM (doğrulanan: ~961 MiB, kullanım ~390 MiB) |
| Disk | 24 G, yaklaşık %11 dolu |
| Node | v24.22.3 |
| Caddy | v2.11.9 (80 ve 443 dinler; ACME / HTTPS) |
| Servis | `optioncalc-flow.service` (systemd, kullanıcı `ocflow`, `MemoryMax=400M`) |
| Uygulama dinleme | yalnız `127.0.0.1:8787` |
| Kod yolu | `/opt/optioncalc-flow` (`server/` + `src/lib`) |
| Veritabanı | `/var/lib/optioncalc-flow/flow.db` |
| Yapılandırma dizini | `/etc/optioncalc-flow/` |
| SSH | `ssh -i ~/.ssh/do_flow root@162.243.88.42` |

Servis 14 Kasım 2026 10:32 İst civarında (`07:32 UTC`) son kez başlatılmıştı; Caddy ve servis `active`. Log satırı: raporlar açık ve Finnhub anahtarı var; koç anahtarı var, model `claude-haiku-5-5`, oto-karne açık; tarayıcı 2 dk, tickerlar QQQ SPY NVDA GLD SLV MU INTC.

`/etc/optioncalc-flow/env` **yok** — sayısal tavanlar kod varsayılanlarıyla çalışır.

Sır dosyaları (içerik **asla** okunmaz, basılmaz, commit edilmez; yalnız **dosya adları**):

| Dosya | LoadCredential adı | Ne için |
|---|---|---|
| `/etc/optioncalc-flow/md_token` | `md_token` | MarketData API |
| `/etc/optioncalc-flow/app_key` | `app_key` | Telefonun sunucuya el sıkışması (`x-app-key`) |
| `/etc/optioncalc-flow/finnhub_key` | `finnhub_key` | Rapor haberleri / bilanço |
| `/etc/optioncalc-flow/anthropic_key` | `anthropic_key` | Koç (Haiku) |

`expo_access_token` dosyası bu kontrolde **yoktu**. Expo push için isteğe bağlıdır (hız sınırına takılırsa).

Ortamlarda görünen **sırsız** değişkenler (systemd biriminde): `FLOW_HOST=127.0.0.1`, `FLOW_PORT=8787`, `FLOW_DB=/var/lib/optioncalc-flow/flow.db`. İsteğe bağlı `/etc/optioncalc-flow/env` ile eklenebilecek isimler `server/app/config.ts` ve `server/README.md`'de: `FLOW_POLL`, `FLOW_TICKERS`, `FLOW_INTERVAL_MIN`, `FLOW_CONFIRM_PER_POLL`, `FLOW_MIN_PREMIUM`, `FLOW_MIN_VOLUME`, `FLOW_MIN_VOL_OI`, `FLOW_MIN_MID`, `FLOW_MAX_SPREAD_PCT`, `FLOW_COOLDOWN_MIN`, `FLOW_PUSH_MIN_PREMIUM`, `FLOW_PUSH_MAX_PER_DAY`, `FLOW_DAILY_CAP`, `PROXY_DAILY_CAP`, `FLOW_CREDIT_RESERVE`, `FLOW_RATE_PER_MIN`, `FLOW_CACHE_SEC`, `REPORTS`, `COACH_MODEL`, `COACH_FALLBACK_MODEL`, `COACH_DAILY_CAP`, `COACH_MIN_GAP_SEC`, `COACH_KARNE_AUTO`.

**Neden ayrı sunucu?** MarketData aynı tokenı iki IP/cihazdan aynı anda kullanırsa hesabı **5 dakika kilitler**. Bu yüzden MarketData'yı yalnız droplet çağırır. Telefon, backtest scriptleri ve box doğrudan MarketData'ya gitmez. Sunucu çalışırken `bt:fetch` / `bt:record` / `bt:probe` çalıştırma (veya önce `systemctl stop optioncalc-flow`).

### 4.3 Veritabanı (SQLite)

`flow.db` tabloları (14 Kasım 2026 kontrolü): `events`, `credits`, `reports`, `hist_chain`, `snap`, `cooldown`, `push_tokens`, `push_count`, `coach_shots`, `coach_fills`, `coach_reports`, `coach_karne`, `coach_calls`, `coach_trades`, `base`.

Aynı anda görülen sayılar (hafta sonu, seans kapalı): `events` 0, `credits` 1 satır, `reports` 6 (13/11 için premarket + 4 ara + eod), `hist_chain` 7, `push_tokens` 1, koç tabloları boş (test kaydı temizlenmiş), `coach_trades` 4 (eski kalıntı; sunucu kodunda kullanılmıyor — CHANGELOG notu).

Kredi sayacı (`credits`): tek satır **`2026-11-13` / `src=proxy` / `used=5829`**. `/health` aynı gün için `flow: 0`, `total: 5829`, `mdRemaining: null` verdi (hafta sonu, MarketData kalan kredisi alınamadı). Akış tarayıcısının ilk canlı taraması Pazartesi 16 Kasım 2026 09:30 ET sonrası beklenir.

### 4.4 Dağıtım betikleri

- İlk kurulum: `server/provision.sh` (Node 24, Caddy, ufw, kullanıcı `ocflow`). Sır taşımaz.
- Kod güncelleme: repo kökünden `server/deploy.sh`. `server/app` + `src/lib` paketleyip scp eder, servisi yeniden başlatır, Caddyfile'ı `caddy` kullanıcısıyla doğrular. **Sır taşımaz.**
- Birim dosyası: `server/optioncalc-flow.service`.
- Caddy: `server/Caddyfile`. Koç erişim günlüğü: `/var/log/caddy/coach-access.log` (başlıklar silinir; `x-app-key` yazılmaz).

---

## 5. Veri kaynakları ve API'ler

Her kaynak için: **ne için**, **kim çağırır**, **ne sıklıkla**, **maliyet**, **bozulursa ne olur**.

### 5.1 MarketData.app (asıl opsiyon verisi)

- **Plan:** Trader (belgeler / `docs/PLAN.md`): günde **100.000 kredi**, sayaç **09:30 ET**'de sıfırlanır. Eşzamanlı istek tavanı 50.
- **Kim çağırır:** Yalnız droplet. Telefon `src/lib/market/marketdata.ts` ile sunucu proxy'sine gider: `https://162-243-88-42.sslip.io/api/md` + MarketData yolu, başlık `x-app-key`.
- **İzinli yollar** (`src/lib/flow/proxy.ts` — başka yol 403):
  - `GET /stocks/quotes/{sembol}/` — hisse kotu (**15 dk gecikmeli**, Trader'da bile).
  - `GET /options/expirations/{sembol}/` — vade listesi.
  - `GET /options/chain/{sembol}/` — zincir. İzinli sorgu: `expiration`, `dte`, `mode=live|cached|delayed`, `maxage`, `strikeLimit` vb. (`historical` / `eod` **proxy'den yasak**; EOD zincir sunucuda ayrı `histfetch` ile alınır.)
  - `GET /stocks/candles/1/{sembol}/` — 1 dk mum (hiçbir planda gerçek zamanlı değil; en iyi 15 dk gecikmeli).
- **Sunucu tarayıcısı ayrıca** teyit için `options/quotes/{OCC}` çağırır (bu yol uygulama proxy'sinde yok; yalnız poller).
- **Kredi (resmi belgeler, Kasım 2026):**
  - Canlı zincir: yanıtta kotasyonu olan **her kontrat 1 kredi**.
  - `mode=cached`: **istek başına 1 kredi** (veri birkaç sn–dk eski olabilir). `maxage` dolmazsa 204, **0 kredi**.
  - Tarihsel zincir (`date=`): 1000 kontratta 1 kredi; Greek yok.
  - Hisse kotu ~1, vade listesi ~1, mumlar 1000 mumda 1, canlı tek kontrat kotu 1.
- **Tavanlar (sunucu varsayılanı):** akış 10.000/gün, toplam (akış+proxy) 40.000/gün, MarketData kalanı 5.000'in altına inerse dur. Tahmini akış maliyeti (2 dk, 7 ticker, 6 teyit): ≤ ~2.535/gün.
- **Önbellek:** proxy yanıtları 20 sn (`FLOW_CACHE_SEC`); önbellekten 0 kredi. Uygulama tarafında da ~30 sn'lik küçük önbellek var.
- **Hız sınırı:** dış API için dakikada 120 istek.
- **Bozulursa:** 401 (sunucu anahtarı), 402 (plandaki veri yok), 429 (günlük kredi bitti, 09:30 ET'de yenilenir), "one device" (5 dk kilit). Uygulama Türkçe mesaj gösterir. `auto` kaynakta MarketData düşerse CBOE / Yahoo yedeğe geçer.
- **Bilinen sınır:** işlem düzeyi (time & sales, sweep/blok, borsa) **yok**. Akış, poll'lar arasındaki hacim farkından (`dV`) tahmin edilir. Hisse kotu 15 dk gecikmeli olabilir; uygulama dayanak için çoğu yerde Yahoo'yu tercih eder.

**EOD / geçmiş zincir:** MarketData geçmiş opsiyonu yalnız **gün sonu** verir; geçmiş gün içi kot yok. 13/11 örnek raporlarının duvarı, bir önceki kapanışın (12/11) EOD zincirinden dolduruldu. CHANGELOG'a göre bu iş **131 kredi** yedi (yoklama 1 + 12/11 çekimi 65 + sıralama düzeltmesi 65 + 13/11 denemesi 0). 13/11'in kendi EOD zinciri o sırada henüz yoktu (~65 kredi, Kaan onayı bekler). Backfill komutu `server/README.md`'de; sunucu çalışırken doğrudan MarketData çağrısı yapmadan önce durdurma / onay kuralına uy.

### 5.2 Yahoo Finance (anahtarsız)

- **Kim:** Telefon (`src/lib/market/yahoo.ts`, `bars.ts`) ve sunucu raporları (`server/app/sources.ts`, `YahooClient`).
- **Ne:** Hisse kotu yedeği, temettü bilgisi, **1 dk ve günlük mumlar**, raporlar için endeks / vadeli / VIX.
- **Rapor sembolleri:** Nikkei `^N225`, Hang Seng `^HSI`, FTSE `^FTSE`, DAX `^GDAXI`, ES vadeli `ES=F`, NQ vadeli `NQ=F`, VIX `^VIX`, izleme listesi tickerları, rejim için QQQ ve SPY 1 dk serisi (son 4 gün, rapor anından sonrası kesilir).
- **Sıklık:** Uygulamada tarama / ekran yenilemesi kadar. Raporlarda her slotta (günde 6 kez, işlem günü). Çağrılar arasında ~350 ms nazik aralık.
- **Maliyet:** Ücretsiz, kredi yok.
- **Neden mumlar Yahoo?** MarketData mumları gecikmeli ve krediliydi; gecikmeli barlarla sinyal üretmek yanlıştı. `loadBars` önce Yahoo'yu dener, olmazsa MarketData yedek.
- **Bozulursa:** Rapor ilgili satıra **"veri alınamadı"** yazar, rapor düşmez. Bar yoksa sinyal / rejim zayıflar veya çalışmaz.

### 5.3 CBOE (anahtarsız)

- Telefon, varsayılan `auto` zincirinde MarketData / Tradier yoksa veya düşerse **CBOE → Yahoo**.
- Ücretsiz; gecikmeli / sınırlı olabilir. Anahtar yok.
- Hesapla ayarlarında kaynak elle `CBOE` seçilebilir.

### 5.4 Tradier (isteğe bağlı, anahtarlı)

- Kullanıcı Hesapla › Ayarlar'da kendi anahtarını girebilir (cihazda AsyncStorage).
- Sunucuda Tradier anahtarı **yok**. Repoya yazılmaz.
- `auto` sırasında MarketData'dan sonra, CBOE'den önce denenir.

### 5.5 Finnhub

İki kullanım yeri var; karıştırma:

1. **Sunucu raporları** (`server/app/sources.ts`, `FinnhubClient`): anahtar `X-Finnhub-Token` başlığında (URL'de yok). Uçlar: `/news?category=general`, `/company-news`, `/calendar/earnings`. Ücretsiz planda ~60 istek/dk; istemci 1100 ms aralık bırakır. Anahtar yoksa veya hata olursa rapor "veri alınamadı" der.
2. **Telefon Radar / Fırsat** (`src/lib/news/finnhub.ts`): kullanıcı Radar ayarlarına **isteğe bağlı** kendi anahtarını yapıştırır. Bu çağrılarda anahtar **sorgu parametresinde** `token=` olarak gider (mevcut kod). Sunucu yolundaki başlık stilinden farklıdır.

Finnhub resmi bir "doğruluk kaynağı" değildir; haber ve bilanço takvimi içindir. Gece taşıma kapısındaki FOMC/CPI/NFP tarihleri Finnhub'dan değil, kod içi resmi tablolardandır.

### 5.6 Claude / Anthropic (yalnız Koç)

- **Kim çağırır:** Yalnız sunucu (`src/lib/coach/anthropic.ts`, `server/app/coach.ts`).
- **Model:** varsayılan `claude-haiku-5-5`. Yedek `COACH_FALLBACK_MODEL` yalnız açıkça tanımlanırsa ve birincil reddedilirse (loglanır).
- **Anahtar:** `/etc/optioncalc-flow/anthropic_key`. Telefonda ve repoda yok. Dosya boşsa koç `503 Koç yapılandırılmadı` döner. Dosya hiç yoksa servis başlamaz (`status=243/CREDENTIALS`); `deploy.sh` boş yer tutucu oluşturur.
- **Akış:**
  1. Telefon görüntüyü JPEG'e çevirir, `POST /coach` ile tek tek gönderir (en çok 40, sırayla).
  2. Haiku #1: dolum çıkarma (zorunlu araç `record_fills`, `max_tokens` 1024).
  3. Eşleştirme **kodda** FIFO (`src/lib/coach/fills.ts`) — model alış/satışı eşlemez.
  4. Haiku #2: her kapanmış işlem için Türkçe koçluk (görüntü yok, yalnız metin). Bir yüklemede en çok 3 koçluk; kalanı `POST /coach/process`.
  5. Karne: `POST /coach/karne` veya kapanıştan ~20 dk sonra otomatik.
- **Sınırlar:** 24 saatte en çok 100 çıkarma (`COACH_DAILY_CAP`), iki yükleme arası en az 2 sn, görüntü en çok 4 MB (base64 ~5,6 MB), Caddy `/coach*` 7 MB. Aynı görüntü önbellekten döner (Haiku yok, sayaç işlemez). Saklama 30 gün.
- **Maliyet:** Anthropic token kullanımı (girdi/çıktı loglanır: `koç extract model=… in=… out=… stop=…`). Kesin dolar tutarı bu rehberde **doğrulanmadı**.
- **Bozulursa:** 429 (gap veya daily), 422 (satır okunamadı), 413 (gövde büyük), 502/503. Uygulama görüntü başına Türkçe hata gösterir.

### 5.7 Expo (EAS Update + Push)

- **OTA:** iş bitince üretim dalına güncelleme. Tipik komut:
  ```bash
  npx eas-cli update --branch production --environment production --message "..." --non-interactive
  ```
  (`AGENTS.md` bazen `eas-cli@latest` ve `--environment` olmadan yazar; bu projedeki pratik komut yukarıdaki gibidir.) Yayın sonrası pakette **`sslip.io` geçtiği doğrulanmalıdır** (sunucu adresi düşmesin).
- Kaan daha sonra "iş bitince gönder expoya" diyerek **bitmiş işin OTA'sını önceden onayladı**. TestFlight / native build hâlâ yok.
- Kullanıcıya: Expo Go'yu tamamen kapatıp 1–2 kez yeniden açması söylenir.
- **Push:** `POST /push/register` ile Expo push token. Uzak bildirimin Expo Go'da çalışması **garanti değil**; gerekirse ileride dev build + Apple Developer (99 $/yıl) — bu karar açık (`TASKS` #14).
- `EXPO_TOKEN` yalnız ortam değişkeninden; asla commit / sohbet / zip yok.

### 5.8 GitHub

- Depo: `https://github.com/KaanErturkuner/OptionCalc` (doğruluk kaynağı olarak planlandı).
- **Ajanlar GitHub'a push etmez.** Kaan kendi makinesinden senkronlar ve push eder.
- Box kopyası: `/workspace/oc`. `git remote` şu an yerel bir bundle (`/workspace/oc.bundle`); `master` bu yazım anında origin'den **65 commit önde** idi. Tipik HEAD: `d466264` — Koç yükleme düzeltmesi.
- Kaan'ın Windows kopyası: `C:\dev\Grok x Claude\OptionCalc` (makine `0cd60357-9041-4e17-aa23-09710e75630a`). Orada box'ta olmayan ekstra bir commit var: **`c109538`**. Box commit'leri oraya uygulanmalı veya GitHub'dan çekilmeli; sonra Kaan push eder. Kör `push --force` yok.

### 5.9 SEC ve diğer (Radar haber)

Radar, isteğe bağlı SEC haber kaynağı kullanabilir (`secUa` ayarı). User-Agent e-postası Kaan'dan beklenir (`TASKS` #19). Anahtar zorunlu değil; yoksa o kaynak sessizce atlanır.

### 5.10 Kaynak seçim sırası (telefon kotu)

`src/lib/market/index.ts`, `provider: 'auto'` (varsayılan):

1. MarketData (akış sunucu anahtarı varsa ve veri taze ise)
2. Tradier (kullanıcı anahtarı varsa)
3. CBOE
4. Yahoo

MarketData bayatsa (deneme planı eski seans döndürür diye) 10 dk atlanır, CBOE kullanılır. Hesapla ayarlarından kaynak elle kilitlenebilir.

---

## 6. Para kuralları (tek kaynak: `src/lib/paper/rules.ts`)

Kaan 14 Kasım 2026'da sert stopu değiştirdi: prim **%67 değil, %40** düşünce işlem kapanır. Bütün yeni sayılar `rules.ts`'ten türer. Eski belgelerde (`SINYAL-FIRSAT` gövdesi, eski backtest raporları, bazı handoff'lar) hâlâ %67 görebilirsin — onlar **tarihseldir**. Yeni kural/sayı yazarken `0,33` / `0,67` / `%67` literal'i koyma.

### 6.1 Stop, 1R, hedef — sayı örneği

Komisyon hedef fiyata **girmez** (brüt hedef). Net K/Z'den ayrıca düşülür.

| Kavram | Formül | Giriş primi 3,00 $ iken |
|---|---|---|
| Sert stop | giriş × 0,60 | **1,80** |
| 1R (risk) | giriş × 0,40 | **1,20** (kontrat başına prim) |
| 1:5 hedef (birincil) | giriş + 5 × 1R = giriş × 3,0 | **9,00** |
| 1:4 yedek | giriş × 2,6 | **7,80** |
| Stop'ta R | −1R | 1,80'de çıkış = −1R |

Kontrat çarpanı 100'tür: prim 3,00 olan 1 kontratın maliyeti kabaca 300 $ + komisyon. 1R dolar olarak `1,20 × 100 = 120 $` (1 kontrat, komisyonsuz).

Kâğıt hesap giriş dolumu: **ask + 0,01 $ kayma**. Çıkış: **bid − 0,01**. Ask ≤ 0,05 olan kontrat alınmaz (`MIN_ASK`).

### 6.2 Kademe (pozisyon büyüklüğü)

- İlk işlem: sermayenin **%50'si**. **Bir işlem asla %50'yi aşmaz.** Bu Kaan'ın kırmızı çizgisidir; yumuşatma, gizli tavan, "önerilen daha küçük" yok (`src/lib/paper/sizing.ts`).
- Kazanınca bir basamak yukarı (30→40→50, tavan 50). Kaybedince bir basamak aşağı (taban 30). Başabaş değişmez.
- Kademe **ertesi güne taşınır**. Mod ve ardışık sayaçlar 09:30 ET'de sıfırlanır.

Örnek: 300 $ sermaye, kademe %50 → bütçe 150 $. 1:5 hedefli işlem 1:3'te kapanırsa sermaye 600 $ olabilir; sonraki bütçe yine %50 = 300 $.

### 6.3 Hesap modları (`src/lib/paper/account.ts`)

| Mod | Ne zaman | Hedef |
|---|---|---|
| **AGRESIF** | Gün başı varsayılan | 1:5, yoksa 1:4 (`AGRESIF_4`). Skor ≥ 65 |
| **GUVENLI_KAR** | Gün içinde **4 kazanç** üst üste | 1:2, yoksa **1:1,5**. Skor ≥ 70 |
| **GUVENLI_ZARAR** | Üst üste **2 kayıp** | 1:2 / 1:1,5. Skor ≥ 75 |
| **DURDU** | Güvenli zarara girdikten sonra **2 kayıp daha** (varsayılan açık; ayardan kapatılabilir) | Yeni işlem yok |

Öncelik: DURDU > GUVENLI_ZARAR > GUVENLI_KAR > AGRESIF. Mod gün sonuna kadar yapışkan. `|net K/Z| < maliyetin %2'si` başabaş sayılır. Monte Carlo'da güvenli mod hedef çarpanı `modeN` ile **2**'dir (1:2); 1:1,5 uygunluk eşiğidir (`minRR: 1.5`).

### 6.4 Çıkış sırası ve ÇIK / TUT / DİKKAT

`src/lib/signals/riskwatch.ts` sırası (özet):

1. Hedef vurduysa kapat.
2. Sert prim stopu veya iz süren stop vurduysa kapat (−%40 her zaman önce).
3. **15:45 ET** zorunlu çıkış (0DTE her zaman; gece taşıma yoksa 1–3 DTE de).
4. Uyarlanabilir **ÇIK / TUT / DİKKAT yalnız uyarıdır** — otomatik kapatmaz (Kaan, 14 Kasım 2026).
5. Eski T4–T7 risk tetikleri hâlâ var (kâr bandına göre uyarı veya çıkış). ÇIK yokken eski T1–T3 davranışı devrededir.

İz süren stop: kâr ≥2R → +1R kilit; ≥3R → +2R; ≥4R → +3R.

### 6.5 Gece taşıma (1–3 DTE)

0DTE **her zaman** 15:45 ET'de kapanır. 1–3 DTE ancak **hepsi** sağlanırsa taşınır (`src/lib/paper/overnight.ts`):

- Vade ertesi seansı kapsar.
- Takvim kapısı temiz: **bilanço + FOMC + CPI + NFP**. Olay varsa veya takvim bilinmiyorsa taşıma **yok** (güvenli taraf).
- Son 30 dk'da güçlü risk tetği yok.
- Rejim pozisyon yönünde.
- Kötü senaryo (dayanak 2σ aleyhe, IV × 0,9) kaybı **≤ 1,5R**.

Kaan 14 Kasım 2026'da 1,5R eşiğinin **dolar değil R olarak kalmasını** istedi («Yok böyke kalsın»). Dikkat: eski 1R ≈ giriş × 0,67 idi; yeni 1R = giriş × 0,40 (dolar olarak daha küçük). Aynı dolarlık gece boşluğu artık daha fazla R eder; taşımak **daha zor** olabilir.

**PPI ve PCE taşımayı engellemez** — yalnız uyarıdır (`releaseWarnings`). Bunların da bloklanıp bloklanmayacağı **açık karar**.

Ertesi sabah: açılış dayanak stopunun ötesindeyse veya prim stopun altındaysa gap çıkışı. 09:30–09:45 ET arası yalnız stop/hedef; diğer tetikler 09:45'ten sonra.

---

## 7. Algoritmalar (basit anlatım)

### 7.1 Seans rejimi (`src/lib/market/regime.ts`)

Girdi: QQQ (yoksa SPY) **1 dk barları**, 5 dk'ya toplanır. Pencere: son **75 dk** (45 dk'dan kısa seans = "erken").

**Konsolidasyon** (üçü birden):

1. Pencere aralığı ≤ **3,5 ×** 5 dk ATR(14),
2. ve ≤ seans aralığının **yarısı**,
3. ve (pencere hacmi ≤ önceki seansın dk başına hacminin %80'i **veya** pencerede **en az 3 VWAP geçişi**).

**Trend:** kapanışların ≥ %80'i VWAP'ın aynı tarafında ve net hareket ≥ 1,5 × ATR.

**Onaylı dönüş:** seans uç noktasından tersine **≥ %0,3** hareket **ve** son 30 dk içinde **en az 2 teyit** (VWAP geri alma/kaybı, yüksek hacimli ters mum, 5 dk yüksek dip / alçak tepe). Tek teyit = "aday", rejimi değiştirmez.

Öncelik: onaylı dönüş > konsolidasyon > trend; hiçbiri değilse "karışık".

**Histerezis (yumuşatma):** yeni rejim, **2 ardışık 5 dk kapanış** görülmeden onaylanmaz. Rapor, Sonuç/Fırsat ve risk izleyici **onaylı** rejimi kullanır. 13/11 20:00–20:40 arasında ham rejim titreştiği için eklendi.

### 7.2 Uyarlanabilir çıkış (`src/lib/signals/adaptive.ts`)

Kaan: «düşünsün, dönüyorsa geçsin; devam edeceğine dair gösterge varsa devam.»

Tetik: girişten beri **lehte uç noktadan** tersine ≥ **%0,3**. Yoksa karar **YOK**.

| Dönüş (aleyhte) | Puan | Devam (lehte) | Puan |
|---|---:|---|---:|
| VWAP kaybı | 2 | VWAP doğru tarafta | 2 |
| Hacimli ters mum | 2 | Hacimli trend mumu | 1 |
| 5 dk dip/tepe kırıldı | 2 | HH/HL veya LH/LL korunuyor | 2 |
| Onaylı rejim aleyhte | 2 | Onaylı rejim lehte | 1 |
| Momentum ters | 1 | Momentum yönde | 1 |

Dönüş > devam → **ÇIK**; devam > dönüş → **TUT**; eşit → **DİKKAT**. Hepsi uyarıdır, otomatik kapatmaz. Niteliksel geri test: `docs/reports/riskwatch-replay-2026-11-12_13.md` (Yahoo 1 dk, 12–13 Kasım). Açık not: 4 örnekte 3 erken ÇIK — eşik sıkılığı tartışmalı. O testler eski %67 stop ile üretilmiş olabilir; yeniden koşulmadı.

### 7.3 Duvarlar, birikim, EOD geri doldurma

- **Duvar:** açık faiz (OI) en yüksek call strike ≈ call duvarı, en yüksek put strike ≈ put duvarı. İlk 3 OI `oiWalls` ile alınır (`src/lib/odte/analytics.ts`).
- Raporlarda birikim **OI × fiyat değil, kontrat sayısına (OI)** göre sıralanır.
- Max pain, GEX, gamma flip, put/call, beklenen hareket (ATM straddle), VWAP, ORB aynı analitik dosyada.
- Canlı seans duvarı akış tarayıcısının zincir anlık görüntüsünden gelir. 13/11'de sunucu seans boyunca yoktu → raporlarda "veri alınamadı". Sonra 12/11 EOD zinciri `hist_chain` tablosuna alınıp örnek raporlar yeniden kuruldu. 13/11 EOD zinciri henüz yoktu; gün sonu duvar kayması bu yüzden boş kalabildi.

### 7.4 Rapor zamanı ve senaryo olasılıkları

Zamanlama **ET açılış/kapanışa çapalıdır** (DST otomatik kayar), `src/lib/reports/schedule.ts`:

| Slot | ET referans | Kış İstanbul | Yaz İstanbul |
|---|---|---|---|
| Piyasa öncesi | açılış − 30 dk | **17:00** | 16:00 |
| intra1 | açılış + 30 dk | **18:00** | 17:00 |
| intra2 | açılış + 1,5 sa | **19:00** | 18:00 |
| intra3 | açılış + 2,5 sa | **20:00** | 19:00 |
| intra4 (21:00 raporu) | açılış + 3,5 sa | **21:00** | 20:00 |
| Gün sonu | kapanış + 30 dk | **00:30** (ertesi takvim günü) | **23:30** |

Tatilde rapor yok. Erken kapanışta (Şükran ertesi, 24 Ara, 3 Tem) 21:00 slotu kapanışa denk gelirse atlanır. Sunucu yeniden başlarsa **45 dk**'dan eski slot üretilmez.

Açılış eğilimi: vadeli ortalama %70 + Asya/Avrupa %30; eşik ±%0,25. Eski 20:00 raporu yalnızca açılıştan beri ortalamaya baktığı için 13/11'de piyasa sıkışmışken hâlâ düşüş bekliyordu — bu yüzden rejim + 21:00 + senaryo eklendi.

Ara raporlar «Şu ana kadar ne oldu / Bundan sonra ne bekleniyor» bölümü taşır. Olasılıklar **kural tabanlı tahmindir**, model tahmini değil, toplamı 100'dür (`src/lib/reports/intra.ts`):

| Rejim | Devam | Dönüş | Yatay |
|---|---:|---:|---:|
| Konsolidasyon | 25 | 20 | 55 |
| Trend (yukarı/aşağı) | 50 | 25 | 25 |
| Onaylı dönüş | 45 | 20 | 35 |
| Karışık | 30 | 30 | 40 |
| Erken | 33 | 33 | 34 |

Fiyat VWAP'ın yön tarafındaysa devam +5, değilse dönüş +5 (yatay en az %5 kalır). Metinde: «kural tabanlı tahminler — yatırım tavsiyesi değildir».

Rapor metni LLM kullanmaz. Veri yoksa cümle **"veri alınamadı"** olur.

### 7.5 Makro takvim

- **Blokaj (gece kapısı):** yalnız FOMC, CPI, NFP + hisse bilançosu — `src/lib/calendar/events.ts`. Resmi Fed / BLS tabloları (2026-11 → 2027-12; FOMC 2026 başından). Kapsam dışı gün = bilinmiyor = taşıma yok.
- **Uyarı (rapor + Sonuç kartı):** PPI, PCE, GSYH, perakende, JOLTS, ISM, UMich, FOMC tutanağı, haftalık işsizlik — `src/lib/calendar/releases.ts`. `verified=false` olanlar ekranda **"tarih doğrulanmadı"** gider. Nedeni: 13/11 Cuma PPI (08:30 ET = 16:30 İst) takvimde yoktu, rapor "önemli bir şey yok" gibi duruyordu.

### 7.6 Güven skoru, Fırsat setupları, Qullamaggie, backtest

- Güven skoru 0–100 (bileşenler A1–H, vetolar, gecikme tavanı) — `src/lib/signals/confidence.ts`.
- Fırsat setupları S1–S6 + prim bazlı RR (`optionRR`, Amerikan fiyatlayıcı) — `src/lib/signals/setups/`.
- **Qullamaggie** Q1/Q1S/Q2/Q3 Fırsat'ta var ama kâğıt kapısı boş (`Q_PAPER_ELIGIBLE`); Kaan onayı olmadan varsayılan strateji yapılmamalı (`docs/tasks/QULLAMAGGIE.md`).
- Backtest: `backtest/`. 12 ay MU/QQQ/INTC, **modellenmiş** fiyatta stratejilerin hiçbiri geçiş kriterini (ADAY) aşamadı. Gün içi gerçek prim yalnız bizim kaydımızda olacak (`bt:record`). Kriterler: `backtest/criteria.mts`, plan: `docs/PLAN.md`.

### 7.7 Akış tespiti (kısa)

Her 2 dk, ticker başına 1 cached zincir (0DTE + 3 ay içindeki Cuma vadeleri; Cuma tatilse önceki işlem günü). `dV = hacim farkı`; prim ≈ `dV × mid × 100`. Eşikler: prim ≥ 25.000 $, dV ≥ 200, dV ≥ 0,5×OI, mid ≥ 0,05. En yüksek primli en çok 6 aday canlı kotla teyit. Soğuma 15 dk. Push: teyitli, dar spread, prim ≥ 100.000 $, günde en çok 30. Taraf tahmindir.

---

## 8. Kronolojik tarihçe — ne yapıldı, neden?

Sıra kabaca ürün evrimidir; ayrıntı `docs/CHANGELOG.md` ve `git log`.

1. **Başlangıç:** Expo iPhone hesaplayıcı, koyu tema, Türkçe. Sonra Amerikan motoru (Leisen-Reimer + Richardson, nakit temettü), ABD vade takvimi.
2. **Canlı veri:** CBOE (varsayılan, anahtarsız) + Yahoo yedek + Tradier. Sembol, gerçek vade, zincir seçici.
3. **SINYAL-FIRSAT (13 Kasım 2026):** Kaan'ın 1:5 kâğıt penceresi. Aşamalar 0–6: ticker ayarı, güven skoru, setuplar, kâğıt hesap, Fırsat ekranı, Monte Carlo. Grok inceledi, Kaan kararları (D12) işlendi: komisyon 1,50 $, kademe %50 tavan, onayla-aç, gece kapısı, DURDU varsayılan açık, 1:N **risk bazlı** (eski "çıkış/giriş çarpanı" K8 yalnız karşılaştırma).
4. **Takvim:** FOMC/CPI/NFP resmi tablo; bilinmeyen gece = taşıma yok.
5. **Backtest gerçeği:** mevcut motor ve `kaan-momentum` OOS'ta avantaj göstermedi. Sinyaller kâğıtta kaldı.
6. **Qullamaggie:** araştırma setup'ları ve çevrimdışı test eklendi; canlı varsayılan değil.
7. **Tazelik göstergesi:** hangi veri ne kadar taze, hap + ayrıntı (Sinyal/Fırsat/Radar).
8. **FLOW / sunucu (14 Kasım):** tek MarketData istemcisi, proxy, akış sekmesi, Expo push kaydı, droplet + Caddy. Neden: tek IP kilidi, telefonun token tutmaması, uygulama kapalıyken bile tarama.
9. **Takip listesi, Menü, Radar detay grafiği, Sonuç kartı.**
10. **Koç (Haiku):** Midas görüntüsü → dolum → FIFO → rapor + karne. Sonra: Caddy 413 (gövde küçüktü), `max_tokens` 2000→3500 (rapor kesiliyordu), çoklu seçici, saat dilimi kayması (ET→İstanbul +7 saat yanlış kaydırılıyordu), JSON çıkarma sağlamlaştırma, yükleme hatalarının gizlenmesi.
11. **Raporlar:** 17:00–20:00 + gün sonu, sonra **21:00**, yapılandırılmış renkli bölümler, daraltılabilir duvar, 13/11 örneklerinin EOD zinciriyle yeniden kurulması.
12. **PPI kaçması:** 13/11 PPI takvimde yoktu; uyarı tablosu eklendi. Blokaj kümesi değiştirilmedi.
13. **«18 raporunda veri alınamadı»:** 13/11'de sunucu seans boyunca akış/duvar kaydetmemişti; Yahoo/Finnhub düşerse de aynı cümle yazılır. Örnek raporlar nokta-zamanlı Yahoo ile geri dolduruldu; duvar için 12/11 EOD zinciri alındı.
14. **Rejim + sıkı dönüş (%0,3) + senaryo olasılıkları:** 18:00–20:00 sıkışmasına rağmen 20:00 raporunun hâlâ düşüş beklemesi.
15. **Uyarlanabilir ÇIK/TUT/DİKKAT + histerezis.**
16. **Fırsat çökmesi:** eski Sonuç kartlarında `levels` yoktu (`Cannot read property 'S' of undefined`). Normalizasyon + kart başına ErrorBoundary.
17. **Stop −%40** ve ÇIK'ın otomatik çıkıştan uyarıya çekilmesi. Tek kaynak `rules.ts`.
18. **Koç 0/22 yükleme:** hatalar ekranda siliniyordu, görüntü JPEG'e çevrilmiyordu, sunucu 4xx'i ve Caddy erişimini loglamıyordu. Dönüşüm (`expo-image-manipulator`), görüntü başına hata, günlük eklendi. Tek test görüntüsü sunucuda 200/1 dolum verdi; 22'li gerçek deneme Kaan'ın telefonunda **hâlâ doğrulanacak**.
19. **Caddy kesintisi (~3 dk, 10:28–10:31 İst / 07:28–07:31 UTC):** dağıtım günlük dosyasını root olarak açınca Caddy yeniden başlamadı. Ayrıca yanlış host adı (`162.243.88.42.sslip.io`, noktalı) bir süre yanlış teşhise yol açtı; doğru ad **tireli** `162-243-88-42.sslip.io`. `deploy.sh` artık Caddyfile'ı `caddy` kullanıcısıyla doğrular.

---

## 9. Çalışma kuralları (Claude için bağlayıcı)

1. **Kaan'a Türkçe, "Başkan" diye hitap et.**
2. **Kod yazımı:** Kaan maliyet için asıl kodu Claude Code'a yaptırır. Tipik çağrı (box'ta): `env -u ANTHROPIC_API_KEY /home/box/.local/bin/claude -p` — yani ortamda yanlışlıkla duran bir Anthropic anahtarı Claude Code'a gitmesin. Küçük doküman / inceleme dışında büyük yamayı sen “pahalı” oturumda şişirme.
3. **Commit öncesi:** `npm run check` (`test` + `typecheck` + `lint` + `bt:selftest` + `flow:selftest`). Görev bitince `docs/TASKS.md` ve `docs/CHANGELOG.md` güncelle.
4. **Commit mesajı:** `[claude] <alan>: <ne>` veya Grok için `[grok]`. Alanlar: `ui`, `engine`, `backtest`, `market`, `docs`, `infra`, `server`, `coach`, `reports`…
5. **Asla token basma / commit etme.** Yasak isimler: `EXPO_TOKEN`, `MARKETDATA_TOKEN`, `GITHUB_TOKEN`, `FINNHUB_API_KEY`, `DIGITALOCEAN_TOKEN`, `ANTHROPIC_API_KEY`, uygulama anahtarı (`app_key`), `x-app-key` değeri. `.env*` takip dışı. Sırları sohbete, zip'e, belgeye, loga yazma. Sunucuda dosya içeriğini `cat` etme.
6. **GitHub'a push yok.** Yerel commit + değişen dosya listesini Kaan'a bırak. Force-push yok. Kaan'ın kopyasındaki `c109538` commit'ini ezme; birleştir.
7. **MarketData'yı box'tan veya telefondan doğrudan çağırma.** Sunucu çalışırken backtest API scriptlerini çalıştırma.
8. **Expo:** bitmiş iş için OTA önceden onaylı; yine de mesajı dürüst yaz, pakette `sslip.io` kontrol et. **TestFlight / native build yapma.**
9. **Otomasyon / rutin kurma:** Kaan «şimdilik otomatize etme» dedi. Seans kaydı veya rapor için kendi başına cron/rutin açma.
10. **Satın alma, rezervasyon, para hareketi:** onay yoksa yok.
11. **Para kuralı değişmez:** %50 tavanı küçültme. Yeni sayı yalnız `rules.ts`'ten.
12. **Sinyali tavsiye gibi sunma.**
13. **Görev panosu:** `docs/TASKS.md`. Başkasının `doing` işini Kaan olmadan alma.
14. **`AGENTS.md` / `CLAUDE.md` kısmen eski kalabilir** (ör. "OPRA onayı bekleniyor", "üç sekme", "repo'da remote yok"). Güncel gerçek: MarketData sunucu üzerinden kullanılıyor; sekmeler altı; GitHub var ama ajan push etmiyor. Çelişince **kod + son CHANGELOG + bu dosya** esas.

Kaan daha önce bir Expo token'ını sohbete yapıştırmıştı; mümkünse o token'ı iptal etmesi hatırlatılmalı (değeri buraya yazılmaz).

---

## 10. Açık işler ve karar bekleyen konular

**Kaan kararı gerekenler**

- PPI ve PCE (belki diğer yüksek kademeli veriler) gece taşımayı **bloklasın mı**, yoksa uyarı olarak mı kalsın?
- Kışın gün sonu raporu **00:30** mü olsun, **23:30** mu? (Kod kışın 00:30 üretir; DST'ye çapalı.)
- Kış giriş penceresi? (saat kayması)
- Gün sonu raporu yeni eğilim/rejim kuralını kullansın mı?
- 13/11 **EOD zinciri** çekilsin mi? (~65 kredi, onay şart.) Pazartesi mümkün.
- Eski açık kâğıt pozisyonlar ve kayıtlı Sonuç kartları hâlâ eski %67 stop ile kalmış olabilir; migrasyon yapılmadı.

**Teknik / izleme**

- **İlk canlı deneme: Pazartesi 16 Kasım 2026** — 17:00 İst piyasa öncesi rapor, 17:30 İst açılış, akış tespiti. Log: `journalctl -u optioncalc-flow`, `/health`, `/status`.
- Kredi sayacı: yerel tablo 13/11 için **proxy 5829**, akış 0, `mdRemaining` hafta sonu boş. Önceki konuşmada "13/11 için 900 kredi" gibi bir tuhaflık geçti; **bu kontrolde 900 satırı bulunamadı**. MarketData resmi bakiyesi ile 5829'un birebir doğrulaması yapılmadı (bilinmiyor). 131 kredi, EOD backfill için CHANGELOG'da belgeli.
- `TASKS` açık kalan örnekler: #5 backtest yanlılık denetimi, #6–#9 uygulama seçenekleri, #13 GitHub senkron, #14 Apple Developer, #15 hisse kotunun 15 dk gecikmesi (Trader'da beklenen mi?), #16 notu (sabit IP artık droplet ile çözüldü — görev satırı eski kalmış olabilir), #17 hybrid compare, #18 kaan-momentum gözden geçirme, #19 Radar kalibrasyonu, Qullamaggie onayı.
- Koç: Kaan 22 görüntüyü yeniden yükleyip denemeli; küçültülmüş JPEG'de Midas yazısı okunaklı mı bakmalı. Fırsat ekranını telefonda doğrulamalı.
- Expo Go'da uzak push garanti değil.
- `coach_trades` tablosu kalıntı.
- 13/11 erken Koç test verisi bir yedeklemede kaybolmuş (CHANGELOG); neden bilinmiyor.
- Box repo ile Kaan'ın `c109538` commit'li kopyasının birleştirilmesi.

**Yapma**

- Onaysız MarketData ile 13/11 EOD çekimi.
- Onaysız otomasyon.
- TestFlight.

---

## 11. Terimler sözlüğü

| Terim | Düz dil |
|---|---|
| **Opsiyon** | Belli bir fiyattan (strike) belli bir güne kadar (vade) alım (call) veya satım (put) hakkı. Yükümlülük değil, hak. |
| **Amerikan tipi** | Vadeden önce de kullanılabilir. ABD hisse/ETF opsiyonları böyledir. Avrupa tipinden farklı fiyatlanır. |
| **Prim** | Opsiyonun fiyatı. 3,00 yazıyorsa bir kontrat ≈ 300 $ (×100). |
| **DTE** | Days to expiration — vadeye kalan gün. **0DTE** bugün biten kontrat. |
| **OTM** | Out of the money — call'da strike > dayanak, put'ta strike < dayanak. Şu an "içeride" değil; daha ucuz, daha kaldıraçlı. |
| **ITM** | In the money — şu an kullanım değeri var. |
| **ATM** | At the money — strike dayanağa çok yakın. |
| **Strike / kullanım fiyatı** | Hakkın bağlı olduğu fiyat. |
| **Dayanak** | Opsiyonun üzerine yazıldığı araç (QQQ, NVDA…). |
| **Bid / Ask / Mid** | Alış teklifi / satış teklifi / orta. Giriş genelde ask, çıkış bid. |
| **OI (open interest)** | Kapanmamış kontrat adedi. Yüksek OI = o strike'ta çok pozisyon. |
| **Hacim (volume)** | Gün içinde işlem gören kontrat. MarketData'da kümülatif. |
| **Duvar** | OI'nin yığıldığı strike. Fiyat orada yavaşlayabilir veya hızlanabilir; garanti değil. |
| **Max pain** | Vade günü opsiyon alıcılarının toplamda en az kazandığı fiyat (kaba sezgi). |
| **GEX / gamma flip** | Bayi gamma tahmini ve işaret değiştirdiği bölge. Yaklaşık model. |
| **IV** | Zımni oynaklık — piyasadaki "beklenen sarsıntı". |
| **Greek (delta, gamma, theta, vega)** | Fiyatın dayanak / zaman / IV'e duyarlılığı. Theta = her geçen günün maliyeti. |
| **VWAP** | Volume-weighted average price — seansın hacim ağırlıklı ortalaması. "Doğru taraf" çoğu zaman fiyatın VWAP üstü (alıcı) / altı (satıcı) olmasıdır. |
| **ATR** | Average true range — tipik dalga boyu. |
| **ORB** | Opening range break — açılış aralığının kırılması. |
| **R** | Risk birimi. Bu projede 1R = giriş primi × 0,40 (kontrat başına). +5R ≈ 1:5 hedef. |
| **RR / 1:N** | Risk/ödül. 1:5 = risk ettiğin her 1 birime karşılık 5 birim hedef (giriş + 5R). |
| **Stop** | Zararı kesme seviyesi. Sert stop: prim %40 düşünce. |
| **Kademe** | Sermayenin yüzde kaçıyla işlem açılacağı (50 / 40 / 30). |
| **Kâğıt / paper** | Gerçek emir yok; kurallar simülasyonda işler. |
| **Spread** | Ask − bid. Genişse işlem pahalı / kaygan. |
| **OCC sembolü** | Opsiyonun resmi kodu (ticker + vade + C/P + strike). |
| **ET** | ABD Doğu saati. İstanbul kışın ET+8, yazın ET+7 (DST). Seans normalde 09:30–16:00 ET = kışın 17:30–00:00 İst. |
| **FOMC / CPI / NFP / PPI / PCE** | Faiz kararı / tüketici enflasyonu / istihdam / üretici enflasyonu / kişisel tüketim enflasyonu. İlk üçü geceyi bloklar. |
| **OTA** | Over-the-air — Expo'nun uygulama güncellemesini mağazasız göndermesi. |
| **Cached / live zincir** | Cached: ucuz (1 kredi/istek), biraz eski olabilir. Live: taze, kontrat başına kredi. |
| **EOD** | End of day — gün sonu verisi. |
| **ÇIK / TUT / DİKKAT** | Uyarlanabilir çıkış uyarısı. Çıkış emri değildir. |

---

## 12. Nasıl çalıştırılır, test edilir, dağıtılır?

### 12.1 Yerel (box: `/workspace/oc`)

```bash
cd /workspace/oc
npm install
npm test                 # birim testler
npm run typecheck
npm run lint
npm run bt:selftest      # sentetik backtest, API yok
npm run flow:selftest    # sunucu öz-testi, ağ yok
npm run flow:dry         # akış kredi tahmini, MarketData yok
npm run check            # hepsi — her commit öncesi
npx expo start           # Expo Go ile QR
```

Backtest (MarketData'ya dokunur — sunucu durmuş olmalı, onay ve bütçe şart):

```bash
BT_DRYRUN=1 npm run bt:fetch     # yalnız tahmin
npm run bt:probe                 # seans açıkken gecikme ölçümü
npm run bt:compare -- --quick --t SPY
```

Veri dizinleri git'te yok: `/workspace/backtest/{cache,days,snaps,reports}`.

### 12.2 Sunucu

```bash
# durum (sır yok)
ssh -i ~/.ssh/do_flow root@162.243.88.42 'systemctl status optioncalc-flow --no-pager -n 30'
ssh -i ~/.ssh/do_flow root@162.243.88.42 'curl -sS http://127.0.0.1:8787/health'

# kod dağıt (sır taşımaz)
# repo kökünden:
server/deploy.sh

# koç / hata
ssh -i ~/.ssh/do_flow root@162.243.88.42 'journalctl -u optioncalc-flow -n 100 --no-pager'
# koç satırları: journalctl -u optioncalc-flow | grep "koç istek"
```

Uygulama anahtarı sohbete yazılmaz. Kaan kendi terminalinde okuyup telefona yapıştırır (`Hesapla › Ayarlar › Akış sunucusu anahtarı`).

### 12.3 Expo OTA

```bash
# EXPO_TOKEN ortamda olmalı; echo etme
npm run check
npx eas-cli update --branch production --environment production --message "kısa Türkçe açıklama" --non-interactive
# üretilen pakette sslip.io geçtiğini doğrula
```

Sonra Expo Go tamamen kapatılıp açılır.

### 12.4 Telefon testi (Kaan'da açık)

- Fırsat çökmeden açılıyor mu?
- Koç: 22 görüntü yeniden, görüntü başına durum, Midas yazısı okunaklı mı?
- Raporlar: 17:00–21:00 ve gün sonu, duvar aç/kapa.
- Pazartesi: 17:00 rapor, 17:30 açılış, Akış olay üretiyor mu?

---

## 13. Dürüst sınırlar (unutma)

- Kanıtlanmış avantaj yok; backtest'ler çoğunlukla negatif / anlamsız.
- Senaryo %'leri kural tablosudur, kehanet değil.
- Akış işlem düzeyini görmez; sweep/blok bilinmez.
- Hisse MarketData kotu 15 dk gecikmeli olabilir.
- Geçmiş gün içi opsiyon kotu yok; model fiyatı zayıf halka.
- Yahoo / Finnhub resmi kaynak değil; engellenirse rapor "veri alınamadı" der.
- Expo Go uzak push ve arka plan taraması sınırlıdır (iOS uygulamayı uyutur).
- Koç eğitim içindir; görüntü okuma hata yapabilir.
- Bu belge 14 Kasım 2026 (Cumartesi) anını yansıtır. Pazartesi canlı seans her şeyi değiştirebilir.

---

## 14. Önemli dosya haritası

| Yer | Ne |
|---|---|
| `AGENTS.md`, `CLAUDE.md` | Ajan kuralları (kısmen eski cümleler olabilir) |
| `docs/TASKS.md` | Görev panosu |
| `docs/CHANGELOG.md` | Devir notları (neden / ne / doğrulama / açık) |
| `docs/PLAN.md` | MarketData sonrası plan, kredi bütçesi |
| `docs/tasks/SINYAL-FIRSAT.md` | Fırsat / kâğıt spec (eski %67 tarihsel) |
| `docs/tasks/FLOW.md` | Akış araştırması + uygulandı notu |
| `docs/tasks/RADAR.md`, `QULLAMAGGIE.md` | Radar / Q setup |
| `server/README.md` | Sunucu uçları, kredi, koç, dağıtım |
| `src/lib/paper/rules.ts` | Para sayılarının tek kaynağı |
| `src/lib/paper/*` | Kâğıt hesap, kademe, gece, MC |
| `src/lib/signals/adaptive.ts`, `riskwatch.ts` | Çıkış |
| `src/lib/market/regime.ts` | Rejim / dönüş |
| `src/lib/calendar/*` | Blokaj + uyarı takvimi |
| `src/lib/reports/*` | Rapor mantığı |
| `src/lib/flow/*` | Akış saf mantık + proxy izinleri |
| `src/lib/coach/*` | Koç saf mantık |
| `src/lib/market/*` | Sağlayıcılar, barlar |
| `src/lib/american.ts` | Amerikan fiyatlayıcı |
| `backtest/` | Araştırma betikleri |
| `test/` | Birim testler |

---

*Son doğrulama: 14 Kasım 2026, yaklaşık 12:11 Europe/Istanbul. Sunucu sağlık ve `flow.db` kredi/rapor sayıları o anda okundu; sır değerleri okunmadı.*

## 15. Expo'ya yayınlama (OTA)

Claude uygulamayı Expo'ya kendisi yayınlayabilir. Yalnız **Expo Go + OTA güncellemesi**. Native build, TestFlight, `eas build` YOK.

**Kanal bilgisi**
- Branch: `production`
- Runtime version: `exposdk:58.0.0` (Expo SDK 58; SDK değişmedikçe aynı kalır, native değişiklik gerektiren paket ekleme)

**Ön koşullar (değerleri ASLA commit etme, loglama, ekrana yazma)**
1. `EXPO_TOKEN` ortam değişkeni: Kaan expo.dev → Account settings → Access tokens'tan oluşturur, Claude ortamına gizli değişken (secret) olarak verir.
2. Repo kökünde git'e girmeyen (`.gitignore`'da) `.env` dosyası, içinde tek satır: `EXPO_PUBLIC_FLOW_API_KEY=<değer>`. Değer Kaan'dan ya da sunucudaki `/etc/optioncalc-flow/app_key`'den gelir. Asla commit etme. `.env` yoksa YAYINLAMA.
   - Bu anahtar olmadan yayınlanırsa Koç ve Akış ekranları kullanıcıdan anahtar ister (bir kez oldu).
3. `src/lib/flow/client.ts` içindeki `ENV_FLOW_KEY` / `flowKeyOf` paket içi anahtar yedeğini SİLME (Kaan kararı: anahtarı elle girmesin).

**Adımlar**
```bash
git fetch origin && git merge origin/master          # en güncel master (Başkan'ın commit'leri dahil)
npx tsc --noEmit
npm test
npx eas-cli update --branch production --environment production --message "Kısa Türkçe açıklama" --non-interactive
# Doğrulama: paketlerde sunucu adresi ve anahtar var mı (anahtarı YAZDIRMA, yalnız say)
KEY=$(sed -n 's/^EXPO_PUBLIC_FLOW_API_KEY=//p' .env)
for f in dist/_expo/static/js/*/*.hbc; do echo "$f sslip=$(grep -c sslip.io "$f") key=$(grep -cF "$KEY" "$f")"; done; unset KEY
# Her iki paket (ios, android) için sslip=1 ve key=1 olmalı; değilse hemen geri al (aşağıda)
git push origin master
```
Çıktıdaki `Update group ID`'yi Kaan'a bildir.

**Geri alma**
- Önceki iyi güncellemeyi yeniden yayınla: `npx eas-cli update:list --branch production --non-interactive` ile önceki grup kimliğini bul, sonra `npx eas-cli update:republish --group <önceki-group-id> --non-interactive`.

**Sunucu değişiklikleri**
- `server/` (ve sunucunun kullandığı `src/lib/` kodu) değişiklikleri `server/deploy.sh` + SSH gerektirir; Claude'da SSH yok. Bunlar Başkan'da kalır: commit'le, push'la ve Başkan'a/Kaan'a "sunucu dağıtımı gerekiyor" de.

**Koordinasyon (iki yayıncı birbirini ezmesin)**
- Yayınlamadan önce Başkan'a/Kaan'a haber ver.
- Her zaman diğer tarafın commit'lerini içeren master'dan yayınla (önce fetch + merge). Son yayınlanan OTA, master'da olmayan bir değişikliği taşıyorsa onu geri silmiş olursun.
- Asla force-push yapma.
