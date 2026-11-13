# Görev: "Radar" — Kaan'ın kişisel piyasa analisti (opsiyon akışı + haber → Türkçe uyarılar)

> Sahip: **Claude** (uygulama) · Tasarım: Grok · Ürün sahibi: Kaan
> Önce `AGENTS.md` / `CLAUDE.md` oku (komutlar, sır politikası, commit etiketi `[claude]`, CHANGELOG/TASKS devir protokolü).
> Bu dosya tek başına yeterli olacak şekilde yazıldı. Repo genelinde gereksiz tarama yapma; §4 dosya haritasını kullan.

---

## 1. Amaç ve ürün tanımı

Kaan ABD hisse opsiyonlarıyla (American, 0–3 DTE, trend-momentum, giriş 16:30–20:00 İstanbul) **kendi hesabına para kazanmak** istiyor. Bahis/Polymarket ekranı **istemiyor**. İstediği: piyasayı onun yerine izleyen, normal dışı durumları yakalayan ve ona **sohbet diliyle** haber veren bir analist.

Örnek çıktılar (hedef ton — kısa, net, "Başkan" diye hitap eden, gerekçeli; sayılar örnektir):

- "Başkan, **MU**'da 13 Kas vadeli **750P**'de bugün 18.400 kontrat işlem gördü, OI 2.100. Put/Call hacmi 3,4 (20 gün ort. 0,9). Piyasa %24 ihtimalle 750 altı fiyatlıyor, dün %15'ti. Biri düşüşe karşı korunuyor ya da düşüşe oynuyor. Haberde: *'Micron guidance concerns…'* (kaynak, 18:05). **Dikkat: call tarafında olma.**"
- "Başkan, **yarı iletkenlerde rehavet var**: SMH IV sıralaması %8 (1 yılın en düşüğü), put/call 0,55, realize oynaklık IV'nin üstünde. Böyle dönemlerde ani düşüşler sert olur. **Koruma ucuz.**"
- "Başkan, **AXTI**'de **olağan dışı call aktivitesi**: 50C (cuma) hacim/OI 7,8, ask tarafında alımlar, IV %18 sıçradı. Son 24 saatte haber yok → bilgi sızıntısı/söylenti olabilir. Kural: hacimle 46,1 üstü kırılırsa trend-call adayı."
- "Başkan, **NBIS** bilanço 2 gün sonra. Opsiyonlar ±%14 hareket fiyatlıyor, son 8 bilançonun ortalaması ±%11. Piyasa hareketi pahalı fiyatlıyor."

Her uyarı: **ne oldu (sayılarla) → neden önemli → olası senaryo(lar) → Kaan'ın tarzına göre ne yapılabilir / neye dikkat** + veri yaşı + kaynak bağlantısı. Kesin al/sat emri değil; "olasılık ve dikkat" dili. Her uyarının altında küçük not: *"Yatırım tavsiyesi değildir; kâğıt üstünde doğrula."*

## 2. Aşamalar (her biri ayrı commit; bitmeden sonrakine geçme; her aşamada `npm run check` yeşil)

| Aşama | İçerik | Zorunlu |
|---|---|---|
| A | Olasılık motoru (`src/lib/prob/implied.ts`) — opsiyonlardan zımni olasılık, beklenen hareket, skew | ✅ |
| B | Akış/anomali dedektörleri (`src/lib/radar/detectors/*`) + günlük taban çizgisi (baseline) | ✅ |
| C | Haber katmanı (`src/lib/news/*`): çekme, ticker eşleme, basit duygu/etiket, olaylarla ilişkilendirme | ✅ |
| D | Uyarı motoru: puanlama, birleştirme, Türkçe metin üretimi, bildirim; **Radar** sekmesi | ✅ |
| E | Geri bildirim ve isabet takibi (uyarı sonrası fiyat ne yaptı) | ✅ |
| F | Sunucu tarayıcı (TASKS #12/#16 ile birleşik): telefon kapalıyken de tarama + Telegram/ntfy | ⏸ Kaan onayı |

## 3. Veri kaynakları

### 3.1 MarketData.app (ücretli Trader plan — **ana opsiyon kaynağı**)
- Taban URL: `https://api.marketdata.app/v1` · Yetki: `Authorization: Bearer $MARKETDATA_TOKEN`.
- **Token sadece ortam değişkeninden** okunur (`process.env.MARKETDATA_TOKEN`; uygulamada kullanıcı Ayarlar'dan girer). Koda, teste, loga, commit'e, fixture'a **asla** yazma. Yanıt loglarken `Authorization` başlığını maskele.
- **TEK CİHAZ / TEK BAĞLANTI KURALI:** Token aynı anda tek IP/tek cihazdan kullanılabilir. Aksi halde 403 *"Only one device is permitted…"* ve **5 dk kilit**. Bu yüzden:
  - Token'lı bir işlem başlatmadan önce **Kaan'a sor** (Grok'un kayıt süreci veya telefon uygulaması o an token'ı kullanıyor olabilir).
  - Tek süreç, tek keep-alive bağlantı; paralel istek **yok**. Hazır istemci: `backtest/md.mts` (kuyruk, hız sınırı, kredi koruması `BT_MAX_CREDITS`/`BT_RESERVE`, kuru çalıştırma `BT_DRYRUN=1`, disk önbelleği). Uygulama tarafı: `src/lib/market/marketdata.ts`.
  - Geliştirme/test için **önce** anahtarsız CBOE sağlayıcısı (`src/lib/market/cboe.ts`, 15 dk gecikmeli) veya fixture'lar kullan.
- Kredi (günlük 100.000, 09:30 ET'de sıfırlanır; yanıt başlıkları `x-api-ratelimit-consumed` / `-remaining`):

| Uç nokta | Ne verir | Kredi |
|---|---|---|
| `GET /stocks/quotes/{SYM}/` | hisse kotu (**hesapta 15 dk gecikmeli** — TASKS #15) | 1 |
| `GET /options/expirations/{SYM}/` | vadeler | 1 |
| `GET /options/chain/{SYM}/?expiration=YYYY-MM-DD&strikeLimit=N` | canlı zincir: bid/ask/last/hacim/OI/IV/greeks | **kontrat başına 1** (N strike × 2) |
| aynı + `&mode=cached&maxage=2min` | önbellekli zincir (gerçek zamanlıya yakın, ~1 sn yaş ölçüldü) | **istek başına 1** ← tercih et |
| `GET /options/chain/{SYM}/?date=YYYY-MM-DD&from=…&to=…&strike=LO-HI` | geçmiş **gün sonu** zinciri (gün içi geçmiş YOK) | 1 |
| `GET /stocks/candles/1/{SYM}/?from=…&to=…` | 1 dk mum (en iyi 15 dk gecikmeli) | gün başına 1 |
| `GET /stocks/candles/D/{SYM}/?from=…&to=…` | günlük mum | 1 |
| `GET /options/quotes/{OCC}/?from=…&to=…` | tek kontrat geçmişi (gün sonu) | 1 |

- Durum kodları: 200 ok · 203 önbellekten · 204 veri yok · 402/429 kredi bitti · 403 tek-cihaz kilidi (5 dk bekle, tekrar deneme fırtınası yapma).
- Radar bütçe hedefi: 15 ticker × her 5 dk × `cached` zincir (en yakın 2 vade) ≈ **4–6 bin kredi/gün**. Canlı mod kullanma.

### 3.2 Gerçek zamanlı hisse fiyatı / gün içi mumlar
MarketData hisse verisi gecikmeli → gün içi fiyat/VWAP/hacim için **Yahoo** (`src/lib/market/yahoo.ts`, `bars.ts`; anahtarsız). Sektör ETF'leri: SMH (yarı iletken: MU, INTC, AMD, AXTI, AAOI, MRVL, NVDA, DRAM), QQQ/SPY (piyasa), IGV (yazılım), ARKX/UFO (uzay: RKLB, SPCX), GLD/SLV. NBIS/CRWV için SMH + QQQ.

### 3.3 Haber (anahtarsız varsayılan + isteğe bağlı anahtarlı)
Sağlayıcı arayüzü `NewsProvider { fetch(tickers, sinceMs): Promise<NewsItem[]> }`:
1. **Yahoo Finance RSS** (anahtarsız, varsayılan): `https://feeds.finance.yahoo.com/rss/2.0/headline?s=MU,AMD&region=US&lang=en-US`.
2. **SEC EDGAR** (anahtarsız; `User-Agent` başlığı zorunlu ve iletişim e-postası içermeli — e-postayı Kaan'a sor): 8-K ve Form 4 (içeriden alım/satım) — şirket bazlı `https://data.sec.gov/submissions/CIK##########.json`.
3. **Finnhub** (isteğe bağlı, ücretsiz anahtar `FINNHUB_KEY`): şirket haberleri, **bilanço takvimi** (`/calendar/earnings`), makro takvim. Anahtar yoksa bilanço tarihini Yahoo'dan dene.
- Uç noktaları uygulamadan önce **doğrula** (dokümantasyon + tek deneme); çalışmayanı kapat ve CHANGELOG'a yaz.
- `NewsItem { id, tickers: string[], title, source, url, publishedAt, kind: 'news'|'filing'|'insider'|'earnings'|'macro', sentiment?: number /* -1..1 */, tags: string[] }`.
- Duygu/etiket: **sözlük tabanlı** basit sınıflama (downgrade, guidance cut, offering, SEC probe, lawsuit, beat, raise, upgrade, contract, partnership… → etiket + işaret). LLM özetleme bu görevin kapsamı dışında (ileride sunucuda).

## 4. Dosya haritası

Mevcut (içe aktar, yeniden yazma):
- `src/lib/bs.ts` — `ncdf`, `npdf`, `price`, `greeks`, `impliedVol`.
- `src/lib/market/types.ts` — `Chain`, `OptQuote`, `mid()`, `spreadPct()`, `parseOcc()`; `index.ts` sağlayıcı seçimi; `ProvOpts.mdMode` (`live|cached`).
- `src/lib/odte/analytics.ts` — OI duvarları, max pain, GEX/gamma flip, VWAP, beklenen hareket.
- `src/lib/odte/strategies/*` — strateji modülleri; `kaanMomentum.ts` Kaan'ın strike kuralını içerir (hisse 1,8× / ETF 0,45× günlük beklenen hareket kadar OTM).
- `src/lib/usmarket.ts` — takvim, `closeMs`, `marketOpen`, `etDate`.
- `src/lib/alerts.ts`, `src/ui/notify.ts`, `src/ui/monitor.ts` — yerel bildirim + tarama döngüsü (uygulama açıkken). Radar bu döngüye bağlanacak.
- `src/lib/state.ts` — izleme listesi (varsayılan: QQQ, MU, AXTI, AAOI, MRVL, GLW, NBIS, CRWV, DRAM, AMD, INTC, SPCX, NVDA, TSLA, RKLB; isteğe bağlı SPY, IWM, GLD, SLV).
- `src/lib/journal.ts`, `src/ui/journalStore.ts` — AsyncStorage kalıcılık deseni.
- `src/app/_layout.tsx` — sekmeler. Yeni sekme: **Radar** (0DTE'nin soluna).
- `src/ui/theme.ts`, `src/ui/controls.tsx` — UI bileşenleri; yeni stil icat etme.
- `test/run.ts` — testler; `test/fixtures/cboe-AAPL.json` gerçek zincir örneği.

Yeni:
```
src/lib/prob/implied.ts                               A
src/lib/radar/types.ts                                B  Signal/Alert tipleri
src/lib/radar/baseline.ts                             B  günlük taban çizgileri (20 gün / 1 yıl)
src/lib/radar/detectors/*.ts                          B  her dedektör ayrı dosya, saf fonksiyon
src/lib/news/{yahoo,sec,finnhub,classify,names,index}.ts   C
src/lib/radar/engine.ts                               D  puanlama, birleştirme, soğuma
src/lib/radar/text.ts                                 D  Türkçe metin şablonları
src/ui/radarStore.ts                                  D/E
src/screens/Radar.tsx                                 D
test/prob.test.ts, test/radar.test.ts, test/news.test.ts
```

## 5. Aşama A — Olasılık motoru (`src/lib/prob/implied.ts`)
Uyarılarda "piyasa %X ihtimal veriyor, dün %Y'ydi" diyebilmek için.
- **IV eğrisi:** OTM tarafı (K<F put, K≥F call; F = S·e^{(r−q)T}); filtre bid>0, spread ≤ %35, mid ≥ 0,05; ln(K/F) ekseninde 3'lü hareketli medyan + doğrusal interpolasyon, uçlarda düz ekstrapolasyon. IV sağlayıcıdan yoksa `impliedVol(mid)`.
- **Kapanış olasılığı (skew düzeltmeli):** `pAbove(K) = N(d2) − e^{rT}·vega(K, σ(K))·∂σ/∂K`, [0,1]'e kırp. Çapraz kontrol: komşu likit call'larla `(C1−C2)/(K2−K1)·e^{rT}`.
- `pBelow`, `pBetween`, **dokunma** `P_touch ≈ min(1, 2·P(beyond))` ("yaklaşık" etiketi), `quantiles()` (bisection).
- **Skew metrikleri:** 25Δ risk reversal (σ25ΔP − σ25ΔC), put kanadı eğimi; **beklenen hareket** analytics'ten.
- Not: risk-nötr olasılık; düşüş olasılığını biraz abartır (UI'da küçük not).
- Testler: düz IV → N(d2) (1e-9); K arttıkça pAbove artmaz; pAbove(F) ≈ 0,5 ± 0,08 (fixture); çapraz kontrol ± 0,05.

## 6. Aşama B — Dedektörler
İmza: `(ctx: TickerSnapshot, base: Baseline) => Signal[]`.
`Signal { id, ticker, kind, severity /*0..1*/, direction: 'bull'|'bear'|'neutral'|'vol', facts: Record<string, number|string>, at }`.

`TickerSnapshot`: spot; gün içi barlar (Yahoo); en yakın 2–3 vadenin zinciri; önceki gün sonu zinciri (OI değişimi için); sektör ETF barları; QQQ/SPY durumu.
`Baseline` (günde bir, gün sonu zincirlerinden; önbelleğe al): 20 gün ort. P/C hacim oranı, toplam opsiyon hacmi, ortalama kontrat hacmi, ATM IV ve **IV rank/percentile (1 yıl)**, realize oynaklık (10/20 gün), 25Δ RR ortalama ve std. Geçmiş yoksa birikerek dolar; yetersizse dedektör "düşük güven" işaretler.

Dedektörler (eşikler parametre; başlangıç değerleri):
1. **Put/Call yığılması** — ticker P/C hacmi ≥ 2× baseline **ve** toplam hacim ≥ 1,5× → `bear` (tersi, call yığılması → `bull`).
2. **Olağan dışı kontrat** — tek kontratta hacim/OI ≥ 3 ve hacim ≥ max(500, ort. kontrat hacmi × 5). last ≥ mid → "alıcı agresif". Call→bull, put→bear. Vade ≤ 14 gün ve OTM ise severity ↑.
3. **OI birikimi** — dünden bugüne bir strike'ta OI artışı ≥ %50 ve ≥ 2.000 (gün sonu karşılaştırması; ertesi sabah raporu).
4. **IV sıçraması / çöküşü** — ATM IV gün içi göreli ≥ +%15 ve haber yok → "bir şey fiyatlanıyor"; bilanço sonrası IV çöküşü bilgi amaçlı.
5. **Skew kayması** — 25Δ RR baseline'dan ≥ 2σ (put'lar pahalanıyor → koruma talebi, `bear`).
6. **Rehavet / panik** (endeks ve sektör ETF'leri + tek hisse) — Rehavet: IV rank ≤ %15 **ve** P/C ≤ baseline×0,7 **ve** realize oynaklık > IV → `vol` ("koruma ucuz, ani düşüşe dikkat"). Panik: IV rank ≥ %85 ve P/C ≥ 1,5× → "korku zirvesi, dönüş fırsatı olabilir".
7. **Gamma / pin** — 0DTE'de fiyat büyük OI duvarına ±0,3 beklenen hareket yakınsa "pin riski"; gamma flip altına iniş → "oynaklık artabilir".
8. **Sektör ayrışması** — hisse ile sektörü ters yönde ve fark ≥ 1,5 beklenen hareket → bilgi.
9. **Bilanço/olay yakınlığı** — 0–5 gün içinde bilanço: zımni hareket vs son 8 bilançonun gerçekleşen ortalaması → "pahalı/ucuz fiyatlıyor".
10. **Trend adayı** (Kaan'ın tarzı) — `kaanMomentum` koşulları sağlanınca Radar'a sinyal olarak geçir (strateji kodunu yeniden kullan, kopyalama).

## 7. Aşama C — Haber katmanı
- Tarama turunda en fazla 1 haber çekimi / 5 dk (tüm liste tek istekte); `seen` kümesiyle tekrarları ele.
- Eşleme: sembol + şirket adı sözlüğü (`names.ts`).
- `classify.ts`: sözlük tabanlı etiket + işaret; testli.
- **İlişkilendirme:** dedektör sinyalinden ±6 saat içindeki aynı ticker haberleri uyarıya eklenir. Sinyal var + haber yok → metne "haber yok → söylenti / bilgi sızıntısı olabilir" (severity ↑). Haber var + opsiyon tepkisi yok → düşük öncelikli bilgi kartı.
- Önemli haber türleri (downgrade, guidance, offering, SEC, büyük insider satışı, büyük sözleşme) tek başına orta seviyeli uyarı üretebilir.

## 8. Aşama D — Uyarı motoru + Radar sekmesi
- **Birleştirme:** aynı ticker + aynı yön sinyalleri 30 dk penceresinde tek uyarı; `score = 1 − Π(1 − severity_i)`; haber teyidi +0,1, sektör teyidi +0,1 (üst sınır 1).
- **Soğuma:** aynı ticker+tür için 60 dk tekrar bildirim yok (skor ≥ 0,2 artmadıkça). Günlük bildirim tavanı 12.
- **Eşik:** score ≥ 0,6 → yerel bildirim; 0,35–0,6 → sadece Radar listesinde.
- **Metin (`text.ts`):** şablon + gerçek sayılar; daima "Başkan," ile başlar; §1'deki 4 parçalı yapı; Türkçe sayı biçimi (`format.ts`); Kaan'ın strike kuralıyla aday kontrat ("Trend teyit ederse: 13 Kas 857,5C"), vade 0–3 gün; giriş penceresi dışında (20:00 İstanbul sonrası) "yarın için not" olarak yaz.
- **Radar ekranı:** üstte "Piyasa nabzı" kartı (QQQ/SPY/SMH yön, VWAP tarafı, IV rank, rehavet/panik göstergesi); altında skor sıralı uyarı kartları (ticker, renkli yön, saat, metin, veri yaşı, haber bağlantıları, "Hesapla'da aç" → Calc ekranına strike/vade ile). Filtre: tümü / yükseliş / düşüş / oynaklık / haber. Karta dokununca dayanak tablo (facts) ve olasılık eğrisi (Aşama A).
- **Tarama:** uygulama açıkken `monitor.ts` döngüsü, 5 dk, seans saatlerinde. Seans dışında "gün sonu özeti" modu: "Yarın için 5 not".

## 9. Aşama E — İsabet takibi
- Her uyarı kaydedilir (`radarStore.ts`): yön, skor, dedektörler, o anki spot, ATM IV.
- 30 dk / 2 saat / gün sonu / ertesi gün fiyat değişimi otomatik doldurulur (Yahoo). Dedektör bazında yön isabeti ve beklenen hareket cinsinden ortalama hareket tablosu ("put yığılması uyarılarının %X'inde fiyat 2 saatte düştü").
- Kaan uyarıya 👍/👎 verebilir; kaydedilir.
- 4–6 hafta sonra eşik/ağırlık kalibrasyonunu Grok yapacak; sen sadece veriyi eksiksiz kaydet.

## 10. Aşama F (Kaan onayı olmadan başlama)
Aynı motor `server/` altında Node sürecinde çalışır (tek MarketData kullanıcısı, sabit IP), Telegram veya ntfy ile anlık bildirim yollar; telefon veriyi sunucudan okur → tek-cihaz sorunu biter. Detay TASKS #12/#16.

## 11. Kurallar
- Sırlar: hiçbir token/anahtar repoya, loga, fixture'a. `.env*` git dışı.
- Token'lı işlemden önce Kaan'a sor (tek cihaz). Fixture için gerçek yanıt kaydederken başlıkları temizle.
- Kredi: canlı mod yok, `cached` mod; zincir başına 60 sn bellek önbelleği; Ayarlar'da günlük kredi sayacı.
- Sadece **American** opsiyonlar, ABD piyasası, 16:00 ET kapanış; metinlerde saat **İstanbul** (ET parantez içinde).
- Tüm UI ve uyarı metinleri Türkçe.
- Yayınlama (EAS update) **yalnızca Kaan isterse**.
- Her aşama: `[claude]` commit, `docs/CHANGELOG.md` girdisi, `docs/TASKS.md` #19 satırını güncelle, sonunda Grok'a kısa devir notu (ne yapıldı / ne kaldı / bilinen sorunlar).

## 12. Bitti tanımı (A–E)
- [ ] `npm run check` yeşil; dedektörler ve sınıflandırıcı için birim testler (sentetik zincirlerle her dedektörün pozitif ve negatif örneği).
- [ ] Radar sekmesi Expo Go'da açılıyor; CBOE (anahtarsız) ile de çalışıyor (gecikme etiketiyle).
- [ ] Fixture senaryosunda en az 3 farklı türde Türkçe uyarı üretiliyor ve yerel bildirim tetikleniyor.
- [ ] Uyarı kayıtları ve isabet tablosu doluyor.
- [ ] 15 ticker / 5 dk kredi tüketimi ölçülüp CHANGELOG'a yazıldı (hedef ≤ 6 bin/gün).
