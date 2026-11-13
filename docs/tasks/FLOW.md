# FLOW — Canlı "olağandışı opsiyon akışı" (Unusual Whales benzeri) — TASLAK

> Durum: **uygulandı** (2026-11-14, TASKS #31): sunucu `server/`, akış mantığı `src/lib/flow/`, Akış sekmesi. Ayrıntı ve doğrulama: `server/README.md`, CHANGELOG 2026-11-14.
> Aşağıdaki metin, uygulamadan önceki taslağın araştırma notudur (2026-11-13). Yazan: Başkan (Grok), 2026-11-13. Kaan onayı yok.
> Kural: API bilgileri yalnız MarketData'nın resmi dokümanından alınmıştır, her maddenin yanında kaynak URL var.
> Dokümanda bulunamayan bilgiler **"bilinmiyor / doğrulanmalı"** olarak işaretlendi. Uydurma yok.
> Bu taslak hazırlanırken MarketData'ya hiç istek atılmadı.

Kaynaklar (erişim 2026-11-13):
- [CHAIN] https://www.marketdata.app/docs/api/options/chain
- [QUOTES] https://www.marketdata.app/docs/api/options/quotes
- [MODE] https://www.marketdata.app/docs/api/universal-parameters/mode
- [RATE] https://www.marketdata.app/docs/api/rate-limiting
- [COLS] https://www.marketdata.app/docs/api/universal-parameters/columns
- [FRESH] https://www.marketdata.app/docs/account/data-freshness/
- [LIMITS] https://www.marketdata.app/docs/account/plan-limits/
- [TRADER] https://www.marketdata.app/docs/account/plans/trader/
- [IP] https://www.marketdata.app/docs/account/data-policies/single-ip/
- [IP403] https://www.marketdata.app/docs/api/troubleshooting/multiple-ip-addresses/

---

## 1. MarketData'nın döndürdüğü veriler

### 1.1 Opsiyon zinciri — `GET /v1/options/chain/{underlying}/` [CHAIN]
Yanıt sütun bazlıdır: her alan, kontrat başına bir eleman içeren bir dizidir.
- **Kimlik:** `optionSymbol` (OCC), `underlying`, `expiration` (uzlaşma zamanı, unix), `side` (call/put), `strike`, `firstTraded`, `dte`.
- **Fiyat:** `bid`, `bidSize`, `ask`, `askSize`, `mid`, `last` ("bu kotasyon anındaki son işlem fiyatı").
- **Hacim/OI:**
  - `volume`: "gün içinde bu kotasyon anına kadar işlem gören kontrat sayısı". Kümülatiftir.
  - `openInterest`: "günde bir kez yayınlanır, gün içinde değişmez" (önceki seansın kapanışından gelen değer).
- **Diğer:**
  - `underlyingPrice`, `inTheMoney`, `intrinsicValue`, `extrinsicValue`.
  - `updated`: kotasyon anlık görüntüsünün zamanı.
- **Greek'ler:** `iv`, `delta`, `gamma`, `theta`, `vega`. Yalnız güncel isteklerde dolu gelir; `date=` ile yapılan tarihsel isteklerde `null` döner.
- **Opsiyon kotası** — `GET /v1/options/quotes/{optionSymbol}/` [QUOTES]: tek kontrat için aynı alanları döndürür. Fiyatı kontrat başına 1 kredi.
- **`columns` parametresi** [COLS]: yalnız istenen sütunlar döner. bid/ask/mid/last içermeyen çok sembollü yanıtlar tek kredi sayılır [RATE].

### 1.2 İşlem düzeyi (trade-level / time & sales) veri var mı?
- **Yok, en azından dokümanda bulunmuyor.**
  - Opsiyon bölümünde yalnız şu uç noktalar listeleniyor: `chain`, `quotes`, `expirations`, `lookup` (https://www.marketdata.app/docs/api/options/).
  - Ayrı işlemler (print'ler), işlem büyüklüğü, borsa, işlem zamanı ya da sweep/blok bayrağı veren bir uç nokta yok.
- **`last` alanı:** yalnız son işlem fiyatını veriyor. Son işlemin **zamanını** veren ayrı bir alan dokümanda yok (`updated` kotasyon zamanıdır). → **Bilinmiyor:** `last` ne kadar eski olabilir?
- **Sonuç:** Akışı **poll'lar arası hacim farkından (Δvolume)** çıkarmak zorundayız. Bir poll aralığındaki birçok işlem tek bir Δ'ya karışır. Bu yüzden blok/sweep ayrımı **yapılamaz**.

### 1.3 Filtreler (chain) [CHAIN]
- **Vade:**
  - `expiration`: tek tarih ya da `all`. Verilmezse bir sonraki aylık vade döner.
  - `dte`:
    - tek değer → en yakın vade;
    - liste (`15,30,45`) → her değer için en yakın tek vade, tekrarlar elenir;
    - aralık ya da operatör (`0-45`, `>=30`) → aralıktaki **tüm** vadeler.
  - `from`/`to`, `month`, `year`, `weekly`, `monthly`, `quarterly`.
  - `dte` ile `from`/`to` birlikte kullanılamaz (400 döner).
- **Strike:** `strike` (tek, liste, aralık, `>400`), `delta` (mutlak delta; tarihsel istekte kullanılamaz), `strikeLimit`, `range` (`itm`/`otm`/`all`).
  - `range` ve `side`, `strikeLimit`'ten önce uygulanır.
- **Fiyat/likidite:** `minBid`, `maxBid`, `minAsk`, `maxAsk`, `maxBidAskSpread`, `maxBidAskSpreadPct`, `minOpenInterest`, `minVolume`.
- **Diğer:** `side` (call/put), `nonstandard`, `am`/`pm` (yalnız endeks opsiyonları), `date` (tarihsel EOD).
- **Mod:** `mode=live|cached|delayed|eod|historical`, ayrıca `maxage` (yalnız cached ile) [MODE].

### 1.4 Tazelik (Trader planı) [FRESH][LIMITS][TRADER]
- `options/chain` ve `options/quotes`: **gerçek zamanlı** (OPRA sözleşmesi ve profesyonel olmayan kullanıcı şartı var).
- `stocks/quotes`, `stocks/candles`, `stocks/bulkcandles`: **15 dk gecikmeli**.
- `stocks/prices`: gerçek zamanlı.
- Uygulamanın kullandığı uç noktalar: `stocks/quotes`, `options/expirations`, `options/chain`, `stocks/candles/1` (src/lib/market/marketdata.ts). Yani hisse fiyatı ve barlar 15 dk gecikmeli, zincir gerçek zamanlı.

---

## 2. Kredi maliyeti [CHAIN][MODE][RATE]

| Mod | Maliyet | Not |
|---|---|---|
| Live (varsayılan) | Yanıtta kotasyonu olan **her opsiyon sembolü için 1 kredi** | Gerçek zamanlı |
| Delayed | Live ile aynı | ≥ 15 dk gecikmeli |
| **Cached** | **İstek başına 1 kredi** (sembol sayısından bağımsız) | Veri "birkaç saniye ile birkaç dakika" eski olabilir, tazelik garanti değil. Popüler semboller daha sık yenilenir. |
| Cached + `maxage` | Önbellek `maxage`'den eskiyse **204, 0 kredi** | Başarılı yanıt 203 döner. 200/203/204'ün hepsi başarıdır. |
| Tarihsel (`date=`) | 1000 sembol başına 1 kredi | Greek yok |

**Kotalar** [RATE]:
- Trader planı: **100.000 kredi/gün**. Sayaç **09:30 ET'de** sıfırlanır. Eşzamanlı istek sınırı 50.
- Yalnız 200/203 yanıtlar kredi tüketir. Hata ve boş yanıtlar sayılmaz.
- Bakiye ≥ 1 iken tek istek bakiyeyi eksiye düşürebilir. Sonra sayaç sıfırlanana kadar 429 döner.
- `X-Api-Ratelimit-Remaining` ve `X-Api-Ratelimit-Consumed` başlıkları kalan ve harcanan krediyi gösterir.
- **Önemli:** bu 100k, Kaan'ın telefondaki uygulamasıyla **ortak** bütçedir.

**Bilinmeyenler (doğrulanmalı, tek bir küçük test isteğiyle; şimdi yapılmadı):**
- Cached modda `dte` listesi ve `strikeLimit` filtreleri aynen uygulanıyor mu? Maliyet sabit kalıyor mu? Doküman "regardless of the number of symbols" diyor ama filtre davranışını ayrıca yazmıyor.
- Cached yanıtta `volume` alanı ne sıklıkla güncelleniyor? QQQ/SPY gibi popüler sembollerde muhtemelen sık, MU/INTC'de daha seyrek; ölçülmeli.

---

## 3. Kaan'ın vade filtresi
- **Kapsam:** bugünden itibaren **3 ay** içindeki vadeler.
- **Bunlardan yalnız:**
  - **bugünün vadesi (0DTE)**, varsa;
  - **her haftanın Cuma vadesi**. Cuma borsa tatiliyse **Perşembe**. Örnek: 2027-03-26 Kutsal Cuma → 2027-03-25 Perşembe.
- **Diğer vadeler atlanır:** Pazartesi/Salı/Çarşamba günlükleri, aylık olmayan diğer günler.
- **Uygulama:**
  1. Günde bir kez `options/expirations` çekilir (1 yanıt = 1 kredi, "Other Endpoints" [MODE]). Ya da vadeler `src/lib/usmarket.ts` (`nyseHolidays`, `isTradingDay`) ile yerelde hesaplanır.
  2. Listelenmiş vadelerle kesişim alınır.
- **Vade sayısı:** ~3 ayda ~13 haftalık Cuma, artı 0DTE (Cuma değilse) → ticker başına **~13–14 vade**.
  - QQQ/SPY'de her gün vade var, yani 0DTE her gün mevcut.
  - GLD/SLV/NVDA/MU/INTC'de 0DTE ancak o gün listelenmiş bir vade varsa vardır. Bu tickerların hangi günlerde vadesi olduğu **bu taslakta doğrulanmadı**; `expirations` ile bakılmalı.
- **İstek biçimi:**
  - `expiration` parametresi tek tarih alır.
  - Seçili vadeleri **tek istekte** almak için `dte` listesi kullanılabilir (örn. `dte=0,1,8,15,…`). Her değer en yakın tek vadeye çözülür.
  - Dönen `expiration` değerleri seçili kümeyle karşılaştırılır, kümede olmayanlar atılır.
  - Aralık (`dte=0-92`) **kullanılmaz**: aralıktaki tüm vadeleri döndürür ve live modda hepsine kredi yazılır [CHAIN].

---

## 4. Günlük kredi tahmini
- **Varsayımlar:**
  - 09:30–16:00 ET = 390 dk. 1 dk poll → **390 poll/gün**, 2 dk poll → **195 poll/gün**.
  - Tickerlar: QQQ, SPY, NVDA, GLD, SLV, MU, INTC (T = 7). Ticker başına E ≈ 14 vade (üst sınır).
  - `strikeLimit = L`. `side` verilmezse vade başına ~2L kontrat (call + put).
- **Formüller:**
  - Live: `kredi/gün = P × Σ_ticker (E × 2L)`.
  - Cached: `kredi/gün = P × istek_sayısı`.

| Senaryo | Poll başına | 1 dk (390) | 2 dk (195) | 100k sınırına göre |
|---|---:|---:|---:|---|
| Live, 7 ticker × 14 vade × L=20 (40 kontrat) | 3.920 | 1.528.800 | 764.400 | **15× / 7,6× aşar** |
| Live, 7 ticker × 14 vade × L=10 | 1.960 | 764.400 | 382.200 | 7,6× / 3,8× aşar |
| Live, 7 ticker × yalnız 0DTE + ilk Cuma (2 vade) × L=10 | 280 | 109.200 | 54.600 | 1 dk aşar; 2 dk sığar (uygulamaya ~45k kalır) |
| Cached, vade başına ayrı istek (7 × 14) | 98 | 38.220 | 19.110 | sığar |
| **Cached, ticker başına tek istek (`dte` listesi)** | 7 | **2.730** | **1.365** | rahat sığar (doğrulama gerekli, §2) |

- **Ölçekleme:**
  - Live maliyet ticker × vade × strike sayısıyla **doğrusal** büyür ve poll sıklığıyla çarpılır.
  - 100k/gün sınırında 1 dk poll'da poll başına en çok ~256 kontrat, 2 dk'da ~512 kontrat sığar. Bu, uygulamanın kendi kullanımı hariç bir tavandır.
  - Cached maliyeti yalnız istek sayısına bağlıdır; strike sayısı krediyi etkilemez, yalnız yanıt boyutunu büyütür.
- **Öneri:**
  - **Keşif katmanı cached:** `mode=cached&maxage=1min` (2 dk poll'da `2min`). 204 gelirse o poll atlanır, 0 kredi.
  - **Teyit katmanı live:** yalnız işaretlenen birkaç kontrat için `options/quotes`, kontrat başına 1 kredi.
  - Hibrit maliyet tahmini: ~3k (cached) + ~50–500 kontrat × birkaç kez ≈ **< 10k/gün**. Kesin sayı, ilk gün `X-Api-Ratelimit-Consumed` başlığıyla ölçülmeli.
- **Cached'in riski:** veri yaşı garanti değil [MODE].
  - Δvolume ölçümünde `updated` değişmediyse o kontrat için Δ = 0 sayılır, çift sayım yapılmaz.
  - Seyrek yenilenen tickerlarda (muhtemelen MU/INTC) akış "parça parça" gelir.

---

## 5. Tespit sezgileri (heuristics)
Hepsi Δ tabanlıdır. Kontrat anahtarı `optionSymbol`; durum gün başında sıfırlanır.

1. **Δhacim:** `dV = volume_t − volume_{t−1}`.
   - Negatif çıkarsa ya da `updated` değişmediyse dV = 0.
   - Günün ilk poll'unda referans yoktur, akış yazılmaz.
2. **Prim:** `prem = dV × mid × 100`.
   - `mid` poll anındaki değerdir. Aralıktaki işlemler farklı fiyatlarda olmuş olabilir; yaklaşık bir değerdir.
   - Spread çok genişse (örn. `ask − bid > 0,3 × mid`) güven düşürülür.
3. **Hacim/OI:**
   - `volume / openInterest` (OI gün içinde sabit, önceki seansın değeri [CHAIN]).
   - `> 1` ise büyük olasılıkla yeni pozisyon açılıyor. Bu bir **sezgi**dir, teyit edilemez.
   - Poll bazında `dV / OI` de izlenir.
4. **Yön (taraf) çıkarımı:** `last` alanı mevcut ama tek fiyattır.
   - `last ≥ ask − ε` → "ask'ta" (agresif alış);
   - `last ≤ bid + ε` → "bid'de" (agresif satış);
   - arada → "orta / belirsiz".
   - Uyarı: `last` aralıktaki **son** işlemdir, dV'nin tamamını temsil etmez, zamanı da bilinmiyor (§1.2). Etiket "tahmini taraf" olarak gösterilir.
5. **Eşikler (olağandışılık):**
   - `prem ≥` ticker'a özgü taban (gün içi yuvarlanan dağılımın %99'u ya da ticker başına sabit taban: QQQ/SPY yüksek, MU/INTC düşük);
   - `dV ≥ k ×` (son 20 poll'daki medyan dV);
   - tercihen OTM ve kısa DTE;
   - gürültü filtresi: `mid < 0,05`, aşırı geniş spread.
6. **Tekrarlayan vuruşlar:** aynı kontrat M dakikada N kez eşiği geçerse "tekrar" etiketi alır ve puanı artar. Aynı ticker, yön ve vadede birden çok strike'ta eşzamanlı vuruş → "küme".
7. **Ticker bazında call/put prim dengesi:**
   - Yükseliş primi = call @ask + put @bid. Düşüş primi = put @ask + call @bid.
   - 15/30 dk ve gün boyu oranlar tutulur; belirsiz taraf ayrı sütundadır.
   - Bu oran Fırsat/Sinyal ekranına **bilgi** olarak gösterilir, skora girmez (WEIGHTS Kaan onayı olmadan değişmez).
8. **Yapılamayanlar:** sweep/blok ayrımı, borsa dağılımı, tek işlem büyüklüğü, "açılış mı kapanış mı" kesinliği. Hepsi işlem düzeyi veri gerektirir (§1.2).

---

## 6. Mimari (Aşama 7: sunucu gerekiyor)

### 6.1 Neden sunucu
- MarketData hesabı **aynı anda yalnız tek IP**'den kullanılabilir [IP][IP403].
  - İstekler 5 dk içinde iki IP arasında gidip gelirse hesap **5 dk bloklanır** (403).
  - Kaan'ın gözlemi de bu: telefon ve başka bir cihaz aynı anda kullanınca kilitleniyor.
- Akış için uygulamanın kapalıyken de sürekli poll yapılması gerekir; telefon bunu güvenilir yapamaz.
- **Sonuç:** MarketData'yı çağıran **tek** cihaz sunucu olmalı. Telefondaki uygulama MarketData'yı **doğrudan çağırmayı bırakmalı** ve zincir/kota verisini de sunucudan (proxy) almalı. Aksi halde telefon IP'si ile sunucu IP'si çakışır ve iki taraf da bloklanır.

### 6.2 Önerilen asgari mimari
- **Tek küçük VPS, sabit IP:** 1 vCPU / 1–2 GB yeterli. Sağlayıcı ve fiyat bu taslakta doğrulanmadı; "aylık birkaç $" düzeyi beklenir.
  - **Serverless (Lambda, Cloud Functions, Apps Script vb.) KULLANILAMAZ:** MarketData bunları açıkça "desteklenmiyor" diyor, çünkü çıkış IP'leri değişir [IP403].
- **Poller (Node 20 + TS):**
  - Repodaki `src/lib/usmarket.ts` ve vade seçimini yeniden kullanır.
  - Seans saatlerinde 1–2 dk'da bir cached zincir çeker, işaretlenen kontratlar için live teyit yapar.
  - `X-Api-Ratelimit-Remaining` ile **bütçe freni** uygular. Örneğin kalan < 20k ise sıklığı düşürür; kalan < 5k ise yalnız uygulama proxy'si çalışır.
- **Depolama:** SQLite, son poll durumu ve günlük akış kayıtları.
- **API:** HTTPS (Caddy ile otomatik TLS) ve uygulamaya özel bir paylaşılan gizli anahtar. Uç noktalar:
  - `GET /flow?since=` (akış listesi);
  - `GET /flow/summary` (ticker bazında prim dengesi);
  - `GET /md/*` (uygulamanın mevcut zincir/kota çağrılarının proxy'si, sunucuda önbellekli).
- **Bildirim:**
  - (a) Expo Push API (HTTPS); uygulamada `expo-notifications` zaten var. **Bilinmiyor:** Expo Go'da (SDK 58) uzak push'un çalışıp çalışmadığı doğrulanmalı. Çalışmıyorsa development build gerekir, bu da OTA ile gelmez.
  - (b) Yedek: uygulama açıkken sunucuyu 1–2 dk'da bir yoklar ve yerel bildirim gösterir (mevcut altyapı).
- **Güvenlik:**
  - MarketData token yalnız sunucuda tutulur (env dosyası, 600 izin); repoya girmez, loglanmaz.
  - Uygulama yalnız sunucu anahtarını bilir.

### 6.3 Ödünleşimler (trade-off)
| Seçenek | Artı | Eksi |
|---|---|---|
| **VPS + SQLite (öneri)** | Sabit IP, kalıcı durum (Δhacim için şart), basit, ucuz | Bakım (güncelleme, yeniden başlatma), tek hata noktası |
| Serverless cron | Bakım yok | MarketData desteklemiyor (IP değişir) → **elendi** [IP403] |
| Kaan'ın PC'si | Ek maliyet yok | Her zaman açık değil; ev IP'si değişebilir; telefonla aynı token → IP çakışması |
| Telefon tek başına (sunucusuz) | Altyapı yok | Arka planda dakikalık poll iOS'ta güvenilir değil; bütçe yetmez; kapalıyken akış yok |

### 6.4 Lisans / dağıtım uyarısı
- MarketData, verinin **üçüncü kişilere** yeniden dağıtılmasını yasaklıyor [IP].
- Kaan'ın kendi sunucusundan kendi telefonuna veri aktarması tek abone, tek cihaz çıkışı, kişisel kullanım olarak değerlendirilebilir. Ama bu **yorumdur** ve MarketData'dan yazılı teyit alınması önerilir.
- Uygulama başka kişilere açılacaksa Commercial plan gerekir [IP].

---

## 7. Kaan'a sorular
1. Sunucu (VPS) açılsın mı? Aylık maliyet ve sağlayıcı onayı.
2. Telefondaki uygulama MarketData'yı doğrudan çağırmayı bırakıp sunucu proxy'sine geçsin mi? Tek IP kuralı nedeniyle sunucu varken bu şart.
3. Akış eşikleri: ticker başına asgari prim ($)? Bildirim sıklığı sınırı?
4. Cached mod (ucuz, tazelik garantisiz) + live teyit hibriti kabul mü? Yoksa yalnız 0DTE + ilk Cuma için live, 2 dk poll mu (~55k/gün)?
5. Hisse fiyatı için gerçek zamanlı `stocks/prices` uç noktasına geçilsin mi? Uygulama şu an 15 dk gecikmeli `stocks/quotes` kullanıyor [FRESH].
6. MarketData'ya "kendi sunucum → kendi telefonum" kullanımının tek-IP/dağıtım kurallarına uygunluğu sorulsun mu?

## 8. Doğrulama planı (onaydan sonra, sunucudan, telefon kapalıyken)
- Tek cached `chain` isteği (`dte` listesi + `strikeLimit`) → `X-Api-Ratelimit-Consumed` = 1 mi? Filtreler uygulanıyor mu?
- Aynı kontratın `updated` ve `volume` alanlarının 1 dk arayla değişip değişmediği (QQQ ve INTC için).
- GLD/SLV/NVDA/MU/INTC vade günleri (`options/expirations`).
