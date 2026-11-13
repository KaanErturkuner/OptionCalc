# SINYAL-FIRSAT: Sinyal tickerları, Güven Skoru ve Fırsat Penceresi (1:5 RR kâğıt hesap)

> **Kimin için:** Claude Code (uygulayıcı). **Tasarım ve onay:** Grok ("Başkan" Kaan adına orkestra şefi). **Karar sahibi:** Kaan.
> **Durum:** yeni görev, TASKS #20–#27. **Önkoşul:** Aşama 0 (port) bitmeden diğer aşamalara başlanmaz.
> **Dil:** uygulama metinleri Türkçe, Kaan'a hitap "Başkan, ...". Kod yorumları Türkçe veya İngilizce.
> **Bu dosyada token yoktur ve olmayacak.** MarketData token'ı yalnızca `MARKETDATA_TOKEN` ortam değişkeninden okunur.

---

## 0. Kaan'ın isteği (özgün niyet)

Kaan'ın 2026-11-13 tarihli mesajından, anlamı bozmadan:

1. **Otomatik sinyal altyapısı:** varsayılan olarak QQQ, GLD, SLV, NVDA için sinyal gönder. Ama listeyi uygulamadan ben seçeyim:
   uygulamada **"Sinyal tickerları"** adında bir alan olsun, oraya koyduğum tickerlar için sinyal gelsin.
2. **"Uygulama görünümü güzel ama işlem güvenilirliği düşük, sinyal doğru mu bilinmiyor."** Bütün işlem sinyallerinde belirlenen
   kurallara göre bir **güven skoru** hesaplansın ve **görünür** olsun.
3. **Fırsat Penceresi:** hedef **1:5 RR** işlem yakalamak. Gerekli setupları araştır, kur. Ben sanal bir sermaye gireceğim (ör. 300),
   sistem bu parayla bana opsiyon temelli 1:5 hedefli işlemler açtıracak:
   - İlk işlem sermayenin **%50**'si (300 → 150). **Bir işlem en fazla %50** olabilir, kazansa da kaybetse de.
   - 1:5 bulamazsa **1:4**'e baksın.
   - İşlem pozitif gidiyor ama risk artıyorsa (ör. 1:3'teyken) **"risk artıyor"** uyarısı versin ve çıkarsın.
   - Bileşik büyüme: 300 ile başladık, 150 ile 1:5 hedefli işlem açtık, 1:3'te çıktık, 150 → 450 oldu, elimizde 600 var;
     sıradaki işlem 300 (600'ün %50'si). Böyle tekrar etsin.
   - Bir günde **üst üste 4 kazanç** olursa gün yeterli, risk almamak için **1:2 veya 1:1,5** işlemlere baksın.
   - **Üst üste 2 kayıp** olursa "bugünlük bu kadar zarar çok" deyip **daha güvenli** işlemlere yönelsin.
   - Kayıpta küçülme: 150 ile açtı, 50'ye düştü, sistem riski görüp kapattı, sermaye 300 → 200 oldu: sıradaki işlem **%40**.
     Yine kaybederse **%30** ile ve **güvenli** işlemle devam.
4. Kodları ve altyapıyı Claude yazar, Grok (Başkan) yönetir.

**Kaan'ın 2026-11-13 cevapları** (ayrıntı §11.1; bunlar artık varsayım değil, kuraldır): kayıptan sonra kazançla kademe adım adım yükselir (30 → 40 → 50);
kademe ertesi güne taşınır; Fırsat sinyali kâğıt hesaba **yalnızca Kaan "Onayla"ya basınca** girer; 1–3 DTE pozisyon gece taşınabilir (0DTE gün bitmeden kapanır);
prim stopu %67; NVDA/GLD/SLV strike uzaklığını sistem oynaklıktan seçer; Midas komisyonu kontrat başına **1,50 $** (açılış ve kapanışta).

**Kaan'ın kesin kararı (Claude değiştiremez):** %50 azami pozisyon büyüklüğü Kaan'ın bilinçli tercihidir. Kaan kâğıt veya gerçek hesabı
kendi güvenlik payı olarak küçük bir tutarla besleyecek. Claude bu kuralı **yumuşatmaz, varsayılanı düşürmez, gizli bir tavan eklemez,
"önerilen" daha küçük bir değer göstermez.** İflas (risk of ruin) raporu yine dürüstçe hazırlanır ama **bilgi amaçlıdır**, kuralları
değiştirmek için gerekçe değildir.

---

## 1. Bağlam: şu an ne var, ne yok

### 1.1 Kodda hazır olanlar (GitHub, 2026-11-13)
| Alan | Dosya | Bu görevde nasıl kullanılır |
|---|---|---|
| Amerikan fiyatlayıcı | `src/lib/american.ts` (`americanPrice`, `americanGreeks`, `americanIV`, `FAST_STEPS`) | RR hesabında hedef/stop priminin modellenmesi |
| Zımni olasılık | `src/lib/prob/implied.ts` (`buildSmile`, `ivAt`, `pAbove`, `pTouch`, `skew`) | Hedefe dokunma olasılığı, strike başına IV |
| Analitik | `src/lib/odte/analytics.ts` (`oiWalls`, `gex`, `expectedMove`, `vwap`, `openingRange`, `ema`, `momentum`, `sessionBars`) | Setup kuralları |
| Radar | `src/lib/radar/**` (snapshot, baseline, 10 dedektör, engine, text, track), `src/ui/radarScan.ts`, `src/ui/radarStore.ts`, `src/screens/Radar.tsx` | Güven skorunda "opsiyon akışı uyumu" bileşeni; anlık görüntü yeniden kullanılır |
| Haber | `src/lib/news/**` (`NewsHub`, `relatedNews`, sınıflandırıcı) | Haber riski bileşeni ve S5 setup |
| Bildirim | `src/ui/notify.ts` (`notifySignal`, `notifyRadar`, `ensurePermission`) | Yeni `notifyFirsat` buraya eklenir |
| Arka plan | `src/ui/monitor.ts` (`BG_TASK`, `syncBackgroundTask`, expo-background-task, en az ~15 dk) | Arka plan kontrolü; anlık sinyal için yeterli değil (bkz. §5.4) |
| Uyarı / günlük | `src/lib/alerts.ts`, `src/lib/journal.ts`, `src/ui/journalStore.ts` | Kâğıt işlemlerin Geçmiş'e de yazılması (isteğe bağlı) |
| Strateji arayüzü | `src/lib/odte/strategies/types.ts` (`Strategy<P>`, `StratCtx`, `StratEntry`) | Setuplar backtest için bu arayüze de sarılır |
| Backtest | `backtest/engine.mts`, `sources.mts` (modeled / recorded / hybrid), `wf.mts`, `compare.mts`, `criteria.mts` | Aşama 6 |
| Sağlayıcılar | `src/lib/market/index.ts` (`loadSymbol`, `loadChain`), `bars.ts` (`loadBars`, Yahoo önce), `marketdata.ts` (`mdMode: 'cached'`) | Veri |

### 1.2 Aşama 0'da eklenecek, şu an GitHub'da olmayanlar
Başkan bu dosyaları Claude başlamadan önce repoya koyar (Grok'un box kopyasından, testleri geçmiş halde):
- `src/lib/odte/strategies/kaanMomentum.ts` (Kaan'ın trend-momentum stratejisi; 4 varyant: `kaan-momentum-0dte`, `-1to3dte`, `-gevsek-0dte`, `-gevsek-1to3dte`)
- `src/lib/odte/strategies/types.ts` (`StratCtx.peer`, `StratEntry.strike`, `StratEntry.exitCheck`, `Strategy.peers`), `util.ts` (`pickStrike`, yalnız OTM), `index.ts` (kayıt)
- `backtest/engine.mts` (`pickStrike`, `exitCheck`, `peers`), `compare.mts` (`--days`, yardımcı semboller), `bt.mts` (`BT_STEP`, `BT_DAYS`), `prep.mts` (`BT_MIN_DTE`/`BT_MAX_DTE`), `validate.mts` (`BT_TICKERS`), `backtest/README.md`
- Yeni: `backtest/peers.mts`, `backtest/live.mts` (`npm run bt:live`), `backtest/replay.mts` (`npm run bt:replay`), `backtest/replay.defaults.env` (yalnız `BT_STEP=1`, gizli bilgi yok)
- `test/run.ts` (kaan-momentum ve `pickStrike` testleri eklenmiş hali)
- `package.json` (`bt:live`, `bt:replay` betikleri; Claude'un `test` betiği korunmuş)
- `docs/tasks/RADAR.md`, `docs/reports/2026-11-12-MU-QQQ-INTC-12m.md`, `docs/reports/2026-11-12-gun-tekrari.md`

Grok bunları GitHub sürümünün kopyasında denedi: `npx tsc --noEmit` temiz, `npm test` (run + prob + radar) geçti, `npm run bt:selftest` geçti, `npx eslint src test` temiz.

### 1.3 Backtest bulguları (karar verirken akılda tut)
Kaynak: `docs/reports/2026-11-12-MU-QQQ-INTC-12m.md` (MU/QQQ/INTC, 2025-11-12 → 2026-11-11, 249 gün, **modellenmiş** opsiyon fiyatı, 5 katlı walk-forward).
- **10 stratejinin hiçbiri** geçiş kriterini sağlamadı (hepsi RED veya ZAYIF). Uygulama motorunun kanıtlanmış bir avantajı yok.
- `kaan-momentum-0dte`: OOS **144 işlem**, kazanma %27,1, işlem başı beklenti **−%4,9**, PF 0,69.
  - **Yön:** put 66× **+%6,7**, call 78× **−%14,7**.
  - **Çıkış:** stop 65× **−%36,5** (sıkı stoplar zarar ettiriyor), "hold" 36× +%26,7, hedef 2× +%430.
  - **Sembol:** QQQ 103× **+%0,4** (başabaş), MU 23× −%16,2, INTC 18× −%20,8.
  - **Saat (ET):** 10:30 ve 12:30 dilimleri pozitif, diğerleri negatif.
- Ders: (a) 0DTE'de çok yakın stop, gürültüde kesiliyor; stop **dayanak seviyesine** göre konmalı, prim yüzdesine göre değil.
  (b) Büyük kazançlar az sayıda "uzak hedef" işleminden geliyor, yani 1:5 fikri veriyle çelişmiyor ama isabet oranı düşük olacak.
  (c) Modellenmiş OTM 0DTE fiyatı en zayıf halka; gerçek gün içi kot kaydı (`bt:record`) birikmeden kesin karar yok.

### 1.4 Veri kısıtları
- **MarketData Trader planı:** opsiyonlar gerçek zamanlı (~1 sn), hisse/ETF kotu ~15 dk gecikmeli (TASKS #15), geçmiş opsiyon verisi yalnızca EOD,
  `mode=cached` zincir isteği 1 kredi, günlük 100.000 kredi (09:30 ET sıfırlanır).
- **Tek cihaz kuralı:** aynı token iki cihaz/IP'den aynı anda kullanılırsa 403 ve 5 dk kilit. Telefon kullanırken box/bilgisayar kullanmaz.
- **Uygulama verisi:** zincir varsayılan CBOE (anahtarsız, **gecikmeli**), barlar Yahoo 1 dk (neredeyse canlı). Telefonda MarketData token'ı
  (Hesapla › Ayarlar, `state.mdKey`) varsa zincir MarketData'dan alınabilir.
- **Kural:** Fırsat sinyali gecikmeli zincirle üretilirse prim seviyeleri "≈ gecikmeli" etiketi alır ve güven skoru tavanı uygulanır (§4.3).

---

## 2. Çalışma düzeni: Grok orkestra, Claude uygulayıcı

### 2.1 Roller
- **Kaan:** karar verir, onaylar. Token'ı kendisi ortam değişkeni olarak tanımlar. Expo yayınını yalnızca o ister.
- **Grok (Başkan):** tasarım, bu belge, kabul kontrolü, Kaan'a özet. Aşama sonlarında devir notunu okur, sonraki aşamayı onaylar veya düzeltme ister.
- **Claude:** kodu yazar, test eder, belgeler. Tasarım kararı gerekiyorsa uydurmaz: `docs/tasks/SINYAL-FIRSAT-SORULAR.md` dosyasına soru yazar,
  varsayılanla devam edebiliyorsa varsayımı açıkça işaretler (§11.2 listesine ekler).

### 2.2 Önce oku (bu sırayla)
1. `AGENTS.md`, `CLAUDE.md`, `docs/TASKS.md`, `docs/CHANGELOG.md` (en yeni 2 kayıt)
2. Bu dosya (tamamı)
3. `src/lib/odte/strategies/types.ts`, `util.ts`, `kaanMomentum.ts`
4. `src/lib/radar/types.ts`, `snapshot.ts`, `engine.ts`, `universe.ts`, `src/ui/radarScan.ts`, `src/ui/radarStore.ts`
5. `src/lib/american.ts`, `src/lib/prob/implied.ts`, `src/lib/odte/analytics.ts`
6. `src/ui/notify.ts`, `src/ui/monitor.ts`, `src/app/index.tsx`, `src/screens/Radar.tsx` (UI deseni için)
7. `backtest/README.md`, `backtest/engine.mts`, `backtest/sources.mts`, `backtest/criteria.mts`

### 2.3 Altın kurallar
1. **Çalışan kodu yeniden yazma.** Radar, 0DTE, Hesapla ve Geçmiş davranışı değişmez (yalnızca belgede yazan bağlantılar eklenir).
2. **`src/lib/**` saf kalır** (React yok, Node yerleşiği yok, `.ts` uzantılı göreli import). UI ve depolama `src/ui/`'da.
3. **İleriye bakış yok:** setuplar yalnızca tamamlanmış barları, önceki gün OI'yı görür. Backtest ve canlı aynı saf fonksiyonu çağırır.
4. **Her saf fonksiyon için birim testi.** Testler token'sız, ağsız, fikstürle çalışır (`test/fixtures`).
5. **Küçük commit'ler:** `[claude] <alan>: <ne>`; alanlar `engine`, `ui`, `backtest`, `docs`, `infra`, `paper`. Her aşama 1–4 commit.
6. **Her commit öncesi:** `npm run check` (test + typecheck + lint + bt:selftest). `bt:selftest` için gerekirse `BT_CACHE` ve `BT_SNAPS`'i geçici dizine yönlendir.
7. **Kaan'a sormadan yapılmayacaklar:**
   - `MARKETDATA_TOKEN` kullanan her çalıştırma (`bt:fetch`, `bt:record`, `bt:probe`, `peers.mts` indirme). Önce `BT_DRYRUN=1` ile kredi tahmini, sonra Kaan'a "telefonda MarketData kapalı mı, çalıştırayım mı?" diye sor. Aynı anda tek token süreci.
   - Expo yayını (`eas update`). Yalnızca Kaan isterse.
   - Sunucu, bulut, zamanlanmış görev, Telegram/ntfy, herhangi bir otomasyon (Aşama 7).
   - Gerçek emir, aracı kurum entegrasyonu: **bu görevde hiç yok.** Her şey kâğıt (simülasyon).
8. **Token'lar** koda, teste, fikstüre, belgeye, commit'e, log'a girmez; ekrana yazdırılmaz.
9. Türkçe sayı biçimi `src/lib/format.ts`; içeride saatler ET, kullanıcıya İstanbul saati gösterilir.
10. Expo API'lerinde hafızaya güvenme: SDK 58 sürümlü dokümanı oku (`AGENTS.md` "Expo rules").

### 2.4 Alt ajanlar (Claude sub-agent) ve dosya sahipliği
Claude, işi paralelleştirmek için en fazla 3 alt ajan açabilir. Çakışmayı önlemek için **dosya sahipliği kesindir**; sahibi olmayan ajan o dosyaya yazmaz,
değişiklik gerekiyorsa sahibine not bırakır.

| Alt ajan | Sahip olduğu dosyalar | Görevi |
|---|---|---|
| **A: Motor/Matematik** | `src/lib/signals/**`, `src/lib/paper/**` | Tipler, ticker profilleri, setuplar, RR, güven skoru, risk izleyici, kâğıt hesap durum makinesi |
| **B: Arayüz** | `src/screens/Firsat.tsx`, `src/ui/firsat*.ts(x)`, `src/ui/signalScan.ts`, `src/ui/scanCache.ts`, `src/ui/SignalTickers.tsx`, `src/app/index.tsx`, `src/ui/notify.ts` (yalnız ekleme) | Fırsat sekmesi, ayarlar, tarama döngüsü, bildirimler |
| **C: Test/Backtest** | `test/signals.test.ts`, `test/paper.test.ts`, `test/fixtures/signals/**`, `backtest/firsat.mts`, `backtest/mc.mts`, `docs/reports/*-firsat-*.md` | Birim testleri, backtest, Monte Carlo, raporlar |

Sıra: **A önce `src/lib/signals/types.ts` ve `src/lib/paper/types.ts`'i yazar ve commit'ler (sözleşme).** B ve C bu tiplere göre çalışır.
Tipte değişiklik gerekirse yalnız A yapar ve diğerlerine bildirir. `docs/TASKS.md` ve `docs/CHANGELOG.md`'yi yalnızca ana Claude oturumu günceller.

### 2.5 Her aşamanın sonunda (tanım: "bitti")
- [ ] Aşamanın kabul listesi (aşama altında) tamam
- [ ] `npm run check` geçti, çıktının özeti devir notunda
- [ ] `docs/TASKS.md` satırı güncellendi, `docs/CHANGELOG.md`'ye tarihli kayıt (ne, dosyalar, nasıl doğrulandı, açık sorular)
- [ ] **Başkan'a devir notu:** `docs/tasks/handoff/SINYAL-FIRSAT-asama-N.md` (en fazla 30 satır: yapılanlar, ekran görüntüsü yoksa nedeni, varsayımlar, Grok'tan istenen karar)
- [ ] Sonraki aşamaya geçmeden önce Kaan/Grok onayı gerekiyorsa dur ve bekle (Aşama 0, 3 ve 6 sonunda dur; diğerlerinde devam edebilirsin)

---

## 3. Aşama 0: port edilen dosyaları bağla ve doğrula (TASKS #20)
Başkan dosyaları repoya koymuş olacak (§1.2). Claude:
1. `npm install` ve `npm run check`. Kırılan bir şey varsa yalnızca bağlantıyı düzelt, mantığı değiştirme.
2. `src/lib/odte/strategies/index.ts`'de kaan-momentum 4 varyantının kayıtlı olduğunu, `pickStrike`'ın dışa aktarıldığını doğrula.
3. `package.json` betikleri: `bt:live`, `bt:replay` var; `test` betiği `run.ts`, `prob.test.ts`, `radar.test.ts` üçünü de çalıştırıyor.
   `bt:replay` Windows'ta da çalışır (`--env-file-if-exists=backtest/replay.defaults.env`, `BT_STEP=1` varsayılan; ortamda `BT_STEP` varsa o kazanır).
4. **Radar'a bu aşamada dokunma.** Not: `src/lib/radar/universe.ts` ile `kaanMomentum.ts` farklı `SECTOR` / `ETFS` tanımları içeriyor
   (ör. NBIS ve GLW: Radar'da QQQ, kaan-momentum'da SMH; ETF listeleri farklı). Bunlar Aşama 1'de `src/lib/signals/profiles.ts`'te tek kaynakta
   birleştirilir (ETF'ler birleşim kümesi; çakışan eşlemeler §11.2'deki NBIS/GLW maddesine göre), sonra Radar ve kaan-momentum oradan içe aktarır.
   Radar'ın geçici trend kuralı (ORB + VWAP + EMA) Aşama 2'de güven skorunun A1–A3 bileşenleriyle değiştirilmez, ayrı kalır.
5. CHANGELOG'a "port + bağlama" kaydı.

**Kabul:** `npm run check` geçer; `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON backtest/replay.mts --help` benzeri bir duman çalıştırması
token istemeden başlar (ağ yoksa hata mesajı Türkçe ve anlaşılır). **Bu aşamada dur, Başkan onaylasın.**

---

## 4. Aşama 1: "Sinyal tickerları" ve ticker profilleri (TASKS #21)

### 4.1 Ayar alanı
- Fırsat sekmesinin üstünde **"Sinyal tickerları"** satırı: çip listesi (dokun → kaldır), "+" ile ekle, "Varsayılana dön".
- Varsayılan: `['QQQ', 'GLD', 'SLV', 'NVDA']`. En fazla 8 ticker (kredi ve pil için; 8 sınırı ayar sabitidir).
- Eklerken doğrula: sembol biçimi (`loadSymbol` regex'i), opsiyon zinciri var mı, en yakın vade 0–3 DTE içinde mi. Değilse ekle ama
  "bu sembolde 0–3 DTE vade yok, yalnızca 1–3 DTE / haftalık vade" gibi Türkçe uyarı göster.
- Sinyaller **yalnızca bu listedeki** tickerlar için üretilir ve bildirilir. Radar'ın kendi evreni (`RADAR_WATCH`) ayrı kalır.
- Depolama: `src/ui/firsatStore.ts`, AsyncStorage anahtarı `firsat-v1`, alan `settings.tickers`.

### 4.2 Ticker profili (`src/lib/signals/profiles.ts`)
Her ticker için piyasa bağlamı farklıdır. GLD ve SLV emtia ETF'leridir; Nasdaq rejimi onlar için doğru bağlam değildir.

```ts
export interface TickerProfile {
  ticker: string;
  kind: 'endeks-etf' | 'hisse' | 'emtia-etf' | 'diger-etf';
  regime: { sym: string; sign: 1 | -1; weight: number }[];   // piyasa yönü vekilleri; sign -1 = ters ilişki (ör. dolar ↔ altın)
  sector: { sym: string; sign: 1 | -1 }[];                    // sektör/akış teyidi
  otm: OtmRule;                 // strike uzaklığı kuralı (§4.2.1): sabit k (Kaan çapası) veya oynaklıktan otomatik k
  dte: [number, number];        // izin verilen DTE aralığı
  window: [number, number];     // giriş penceresi, seans açılışından dakika (ET)
  minOi: number; minVol: number; maxSpreadPct: number;
  macro: boolean;               // makro takvim (CPI, FOMC, NFP) etkisi yüksek mi
  earnings: boolean;            // bilanço riski var mı
}
```

Varsayılan profiller (ilk değerler; Aşama 6 kalibrasyonu ve Kaan onayıyla değişir):

| Ticker | Tür | Piyasa rejimi | Sektör/akış teyidi | OTM kuralı (§4.2.1) | DTE | Pencere (ET) | Not |
|---|---|---|---|---|---|---|---|
| QQQ | endeks-etf | SPY (+1), QQQ'nun kendisi | SMH (+1), ^VIX (−1) | sabit k = 0,45 (Kaan çapası) | 0–1 | 09:45–13:00 | Kaan: QQQ ±2–3 $. Günlük vade var |
| NVDA | hisse | QQQ (+1), SPY (+1) | SMH (+1) | oto (başlangıç k = 1,0; aralık 0,4–2,0) | 0–3 | 09:45–13:00 | Bilanço günü veto |
| GLD | emtia-etf | UUP (−1, dolar), TLT (+1, faiz düşüşü) | GDX (+1, madenciler) | oto (başlangıç k = 0,6; aralık 0,3–1,2) | 0–3 | 09:45–13:00 | Endeks rejimi uygulanmaz. FOMC/CPI günleri makro bayrağı |
| SLV | emtia-etf | UUP (−1), GLD (+1) | SIL (+1, gümüş madencileri) | oto (başlangıç k = 0,7; aralık 0,3–1,4) | 0–3 | 09:45–13:00 | Spread geniş olabilir, likidite filtresi sıkı (maxSpread %12) |
| Kullanıcının eklediği hisse | hisse | QQQ, SPY | `SECTOR` haritasından; yoksa yok | oto (başlangıç k = 1,0; aralık 0,4–2,0); MU ve INTC sabit 1,8 (Kaan çapası) | 0–3 | 09:45–13:00 | Sektör yoksa o bileşenin puanı rejime dağıtılır |
| Kullanıcının eklediği ETF | diger-etf | SPY | yok | oto (başlangıç k = 0,5; aralık 0,3–1,2) | 0–3 | 09:45–13:00 | |

#### 4.2.1 OTM strike uzaklığı: sistem oynaklıktan seçer (Kaan kararı, 2026-11-13)
Dosya: `src/lib/signals/otm.ts` (saf). Kaan NVDA, GLD ve SLV için strike uzaklığını sistemin oynaklığa göre seçmesini istedi.
Kaan'ın kendi elle verdiği rakamlar (MU ±40–50 $, INTC ±4–5 $, QQQ ±2–3 $) **çapa** olarak sabit kalır.

```ts
export type OtmRule = { mode: 'sabit'; k: number } | { mode: 'oto'; k0: number; kMin: number; kMax: number };
// uzaklık d = k × EM_vade   (EM_vade = seçilen vadenin ATM straddle'ı, $; 0DTE'de günlük beklenen hareket)
```
**Otomatik k hesabı** (`autoK(history, rule, ivRank)`), günde bir kez seans açılışında hesaplanır ve günboyu sabit kalır:
1. Son 60 işlem günü için "trend günü uzanması" = o günün açılıştan **gün yönündeki** en uç noktaya hareketi / o günün açılış EM'i
   (`max(high − open, open − low) / EM0`). Veri: günlük OHLC (Yahoo, anahtarsız) ve günlük EM kaydı (Radar `DayRecord.atmIv` ile türetilir: EM0 ≈ S × IV × √(1/252)).
2. `k_ham = 0,9 × (bu oranların 60. yüzdeliği)`. Mantık: strike, sıradan bir trend gününde fiyatın ulaşabildiği yerin biraz içine konur.
3. IV düzeltmesi: IV rank > 80 ise × 0,85 (EM zaten şişkin); IV rank < 20 ise × 1,10.
4. `k = clamp(k_ham, kMin, kMax)`. Geçmiş < 20 gün ise `k0` kullanılır (tablodaki başlangıç değerleri) ve kartta "k başlangıç değeri" yazar.
5. `strike = roundStrike(S ± k × EM_vade, S)`; OTM tarafta kalır (`pickStrike` kuralı).
- §6.1 strike tarayıcısı ATM ile bu `d` arasını tarar, **önce skor sonra RR** ile seçer. Kartta: kullanılan k, k'nın kaynağı (çapa / oto / başlangıç),
  `d` ($) ve seçilen strike'ın `d`'ye göre konumu gösterilir.
- Sabit çapalar (`mode: 'sabit'`): QQQ 0,45; MU 1,8; INTC 1,8. Kaan değiştirmedikçe aynen kalır. Oto k bu tickerlar için de hesaplanıp **yalnızca kıyas** olarak gösterilir.
- Aşama 6'da her ticker için sabit k ile oto k'nın backtest kıyası raporlanır; k aralıkları (kMin/kMax) değişecekse Grok önerir, Kaan onaylar.

- Yardımcı semboller (UUP, TLT, GDX, SIL, SMH, SPY, ^VIX) için yalnızca **Yahoo 1 dk barları** çekilir (anahtarsız, kredi yok).
- **Vadeleri varsayma:** GLD/SLV/NVDA'nın hangi günlerde vadesi olduğu zincirden okunur; 0–3 DTE içindeki en yakın vade seçilir.
- Kaan'ın 16:30–20:00 İstanbul giriş saati, ABD yaz saatinde 09:30–13:00 ET, kış saatinde (şimdi, İstanbul UTC+3 / ET UTC−5) 08:30–12:00 ET'ye denk gelir.
  Pencere ET olarak tutulur (09:45–13:00) ve ekranda **İstanbul saati** gösterilir (kışın 17:45–21:00). Kaan'a soruluyor (§11.2 madde 2).

### 4.3 Tarama altyapısı
- `src/ui/signalScan.ts`: bir tur = her sinyal tickerı için anlık görüntü (`buildSnapshot` yeniden kullanılır) + yardımcı semboller + Radar dedektörleri
  + setup değerlendirmesi (Aşama 3) + güven skoru (Aşama 2) + kâğıt hesap adımı (Aşama 4) + bildirim.
- **Paylaşılan önbellek** `src/ui/scanCache.ts`: aynı sembolün zinciri/barları 60 sn içinde ikinci kez çekilmez (Radar ve Fırsat aynı turdan beslenir).
  Radar kodu bu önbelleği **isteğe bağlı** kullanır; Radar'ın davranışı değişmez.
- **Veri kaynağı sırası (zincir):** telefonda MarketData token'ı varsa ve ayarda "Fırsat için MarketData" açıksa `loadChain(..., { mdMode: 'cached', mdMaxAge: '1min' })`
  (1 kredi/istek); yoksa CBOE (gecikmeli). Barlar her zaman Yahoo önce.
- **Kredi tahmini** ekranda: 4 ticker × (60/2 dk) × 6,5 saat ≈ 780 zincir isteği ≈ günde ~800–1.600 kredi (cached). 100.000'lik bütçenin çok altında.
- Aralık: piyasa açıkken ön planda **2 dk** (ayar: 1/2/5). Açık kâğıt pozisyon varken **1 dk** (risk izleyici için).
- Bildirim: `notifyFirsat(title, body, id)` (`notify.ts`'e ekleme). Aynı ticker + setup için 30 dk soğuma; günde en fazla 10 Fırsat bildirimi.
  "Risk artıyor, çık" bildirimleri soğumaya takılmaz.
- Fırsat bildirimi bir **onay isteğidir**: başlıkta kalan süre ("2 dk içinde onayla") yazar, dokununca Fırsat sekmesinde ilgili kart açılır (§7.7).

### 4.4 Ön plan, arka plan ve sunucu (dürüst sınırlar)
- **Şimdi (Expo Go):** tarama yalnızca uygulama açıkken güvenilirdir. `expo-background-task` iOS'ta en az ~15 dk aralıkla ve garanti olmadan çalışır;
  anlık giriş sinyali için yetersizdir. Arka plan görevi yalnızca **açık kâğıt pozisyonun** risk/stop kontrolü için genişletilir
  (`monitor.ts`'deki desen; yeni görev adı `opsiyon-firsat-kontrol`).
- **"Seans modu"** anahtarı: açıkken ekran kararmaz (`expo-keep-awake`, Expo Go'da var; SDK 58 dokümanından doğrula), Kaan telefonu şarja takıp
  uygulamayı açık bırakır. Seans bitince (16:00 ET) kendiliğinden kapanır.
- **Sonra (Aşama 7, Kaan onayı gerekli):** sabit IP'li sunucu, tek MarketData tüketicisi, aynı `src/lib/signals` kodunu Node'da çalıştırır,
  bildirimi Telegram/ntfy veya Expo push ile gönderir (TASKS #12, #14, #16). Bu, tek cihaz sorununu da çözer. **Kaan onaylamadan başlanmaz.**

**Aşama 1 kabul:** ayar alanı çalışır ve kalıcıdır; varsayılan 4 ticker; profil testleri (GLD için endeks rejimi kullanılmadığı, UUP'nin ters işaretli olduğu);
tarama döngüsü uygulama açıkken çalışır; Radar testleri değişmeden geçer.

---

## 5. Aşama 2: Güven Skoru (0–100) ve kalibrasyon (TASKS #22)

### 5.1 İlke
Skor **açık kurallarla** hesaplanır, her bileşen ekranda görünür ("neden 72?"). Skor bir olasılık değildir; ne kadar "isabetli" olduğu
kayıtlarla ölçülür (§5.4). Veriyle doğrulanana kadar "güvenilir" etiketi verilmez.

### 5.2 Bileşenler ve ağırlıklar (toplam 100)
Dosya: `src/lib/signals/confidence.ts`, fonksiyon `scoreSignal(input): ConfidenceResult` (saf). Ağırlıklar tek bir `WEIGHTS` sabitinde.

| # | Bileşen | Puan | Tam puan koşulu (yön = sinyal yönü) | Kısmi / sıfır |
|---|---|---:|---|---|
| A1 | Piyasa rejimi | 10 | Profilin rejim sembollerinin **hepsi** (işaret uygulanmış) VWAP'ın sinyal tarafında **ve** 15 dk açılış aralığını o yöne kırmış | Yalnız VWAP tarafı uyumlu: 5. Karışık: 0. Ters: 0 ve "ters rejim" vetosu (§5.3) |
| A2 | Sektör/akış | 8 | Sektör sembolleri sinyal yönünde VWAP tarafında ve tickera göre göreli güç (RS) yönle uyumlu | Yalnız VWAP: 4. Sektör tanımı yoksa bu 8 puan A1'e eklenir |
| A3 | Tickerın çoklu zaman dilimi | 7 | 1 dk, 5 dk, 15 dk barlarda EMA9 > EMA21 (put için <) ve fiyat VWAP'ın doğru tarafında | Her zaman dilimi 7/3 puan |
| B | Hacim teyidi | 10 | Tetik barının hacmi ≥ 2,0 × son 20 bar ortalaması | ≥ 1,5×: 5. Altı: 0 |
| C | Opsiyon akışı / Radar uyumu | 15 | Son 30 dk'da aynı tickerda sinyal yönünde Radar sinyali (pcSurge, unusual, oiBuild, skew, gamma, trend) **ve** ters yönde yok | Puan = 15 × min(1, Σ şiddet). Ters yönde şiddet ≥ 0,5 sinyal: −10 (alt sınır 0) |
| D | RR fizibilitesi | 15 | Hedefe gereken dayanak hareketi ≤ 0,6 × kalan beklenen hareket **ve** `pTouch(hedef)` ≥ 0,30 | 0,6–1,2 × EM: doğrusal 15 → 0. `pTouch` < 0,15: 0 |
| E | Likidite / spread | 10 | Kontrat spread'i ≤ %5, hacim ≥ minVol veya OI ≥ minOi | ≤ %10: 5. > maxSpreadPct: veto |
| F | Zaman | 5 | 09:45–12:00 ET | 12:00–13:00: 3. 13:00 sonrası 0DTE: 0 (14:30 sonrası 0DTE veto). 1–3 DTE için 14:30'a kadar 3 |
| G | Haber / takvim riski | 5 | İlgili haber yok veya haber yönle uyumlu; bilanço DTE içinde değil; makro olay (FOMC/CPI/NFP) önümüzdeki 60 dk'da yok | Ters haber: 0. Makro olay yakın: 0 (S5 hariç). Bilanço DTE içinde: veto (S5 hariç) |
| H | Tarihsel isabet | 15 | Bu setup × ticker × skor kovası için gerçekleşen kazanma oranı (§5.4), Beta önsel ile küçültülmüş | n < 30: sabit 7,5 (nötr). n ≥ 30: 15 × clamp((p_post − p_be) / 0,15 + 0,5, 0, 1) |

- `p_be` = setup'ın başabaş kazanma oranı = 1 / (1 + RR_beklenen). Ör. 1:5 için ≈ %16,7.
- `p_post` = (kazanç + 2) / (n + 2 + 2/p_be) gibi basit Beta küçültme; formül `confidence.ts`'de tek yerde, testli.
- **Veri kalitesi cezası (toplamdan sonra):** zincir gecikmeli (CBOE, `delayedMin > 0`): −10 ve **tavan 70**. Bar yaşı > 2 dk: −5. Zincir yaşı > 5 dk: veto.

### 5.3 Vetolar (skor = 0, sinyal gösterilmez, yalnızca kayda geçer)
Ters piyasa rejimi (A1 ters) ve aynı anda ters sektör; spread > `maxSpreadPct`; bilanço DTE içinde (S5 hariç); 0DTE'de 14:30 ET sonrası;
piyasa kapalı; zincir > 5 dk eski; kontrat ask × 100 > kâğıt hesabın izin verdiği tutar (o zaman "sermaye yetersiz" bilgisi); RR < modun alt sınırı.

### 5.4 Etiketler ve doğrulama kapısı
| Skor | Etiket | Davranış |
|---|---|---|
| 0–49 | Zayıf | Listede gri, bildirim yok, "Onayla" butonu yok |
| 50–64 | Orta | Listede, bildirim yok, "Onayla" butonu yok (bilgi kartı) |
| 65–79 | İyi | Bildirim, "Onayla" butonu (mod asgari skoru sağlıyorsa) |
| 80–100 | Güçlü | Bildirim (öncelikli), "Onayla" butonu |

- **"Doğrulanmamış (n = x/30)"** rozeti: setup × ticker × kova için kapanmış kâğıt sonucu < 30 iken her sinyalde görünür.
- **"Güvenilir ✓"** rozeti yalnızca şunlar sağlanınca: (1) o setup Aşama 6 backtest geçiş kriterini geçti, (2) o kovada ≥ 30 kâğıt sonuç var,
  (3) gerçekleşen kazanma oranı backtest oranının en fazla 10 puan altında ve beklenti (R) > 0. Koşul bozulursa rozet kalkar.

### 5.5 Kayıt ve kalibrasyon
- **Her** değerlendirilen sinyal (veto edilenler dahil, skor ≥ 0) `src/lib/signals/log.ts` modeline göre kaydedilir: zaman, ticker, setup, yön,
  bileşen puanları, skor, kontrat, giriş/stop/hedef (dayanak ve prim), veri kaynağı ve yaşı.
- **Sonuç değerlendirmesi** (otomatik, ileriye dönük, kâğıt): sinyalden sonra 1 dk barlarla dayanak önce hedefe mi stopa mı dokundu, zaman çıkışı,
  MFE/MAE (R cinsinden), çıkış primi (zincir varsa gerçek, yoksa model). Kaan'ın onaylamadığı, süresi dolan veya reddettiği sinyaller de değerlendirilir (seçim yanlılığını ölçmek için; kayıtta `karar: onaylandı | reddedildi | süresi doldu | fiyat kaçtı`).
- **Kalibrasyon ekranı** (Fırsat › "İsabet"): skor kovası (50–64, 65–79, 80+) ve setup bazında n, kazanma %, ortalama R, beklenti, PF;
  basit güvenilirlik grafiği (kova ortası ↔ gerçekleşen oran). Kayıt AsyncStorage `firsat-log-v1`, en fazla 2.000 kayıt; CSV dışa aktarım.
- Ağırlıklar **otomatik değişmez.** Ayda bir Grok kayıtları inceler, ağırlık değişikliği önerir, Kaan onaylarsa Claude `WEIGHTS`'i günceller ve CHANGELOG'a yazar.

**Aşama 2 kabul:** `scoreSignal` için her bileşenin tam/kısmi/sıfır testleri; veto testleri; gecikmeli veri tavanı testi; Beta küçültme testi;
kayıt + sonuç değerlendirme testi (sentetik barlarla hedef önce / stop önce / zaman çıkışı).

---

## 6. Aşama 3: Fırsat setupları ve opsiyon RR hesabı (TASKS #23)

### 6.1 RR opsiyonda nasıl hesaplanır (prim bazlı)
Dosya: `src/lib/signals/rr.ts`, fonksiyon `optionRR(input): RRResult` (saf).

```
P_giriş  = ask + kayma                        (kayma varsayılan 0,01 $; ayarlanabilir)
P_stop   = Amerikan fiyat(dayanak = stop seviyesi, kalan süre = t_şimdi + τ_stop, IV = ivAt(smile, K) × iv_stop_çarpanı) − yarım spread
P_hedef  = Amerikan fiyat(dayanak = hedef seviyesi, kalan süre = t_şimdi + τ_hedef, IV = ivAt(smile, K) × iv_hedef_çarpanı) − yarım spread
Risk (R) = P_giriş − max(P_stop, P_giriş × (1 − primStopMaks)) + 2 × komisyon / 100
RR       = (P_hedef − komisyon/100) / (P_giriş + komisyon/100)     ← K8 (Kaan onayı 2026-11-13): 1:N = çıkış primi / giriş primi = N
           (komisyon kontrat başına, açılışta ve kapanışta ayrı; 1,50 $ → prim cinsinden 0,015 $ her uçta)
```
- `americanPrice(type, S, K, T, r, q, sigma, divs, FAST_STEPS)` kullanılır (`src/lib/american.ts`). r = 0,04 (backtest ile aynı sabit).
- **Zaman varsayımı:** `τ_stop = 15 dk`; `τ_hedef` = hedefe varış süresi tahmini = kalan seans × (gereken hareket / kalan beklenen hareket)², [20 dk, kalan seans] aralığına kırpılır.
  Ödül hesaplanırken **iki zaman** denenir (τ_hedef ve 2×τ_hedef, kalan seansla sınırlı) ve **küçük olan** ödül alınır (teta için temkinli).
- **IV varsayımı:** trend setuplarında çarpanlar 1,0; S5 (haber sonrası) için iv_hedef_çarpanı 0,8 (IV düşüşü); S6 (ucuz IV) için 1,05.
- **Komisyon RR'a dahildir:** 1,50 $ × 2 = 3 $/kontrat gidiş-dönüş, 0,30 $'lık bir primde riskin ~%10'u kadar. Ucuz OTM kontratlarda RR'ı belirgin düşürür; bu bilinçli.
- **Prim stop tavanı** `primStopMaks` **%67** (Kaan onayladı, 2026-11-13) (Kaan'ın örneği: 150 → 50, yani prim üçte birine düşünce kapanış). Asıl stop **dayanak seviyesidir**;
  prim tavanı yalnızca hızlı çöküşte (gap, IV düşüşü) devreye girer. Bu iki stoptan hangisi önce gelirse.
- **Kaan'ın örneğiyle tutarlılık (birim testi, komisyon 0 ayarıyla):** pozisyon 150, prim stopu %67 → R = 100. "1:3'te çıktık" = +300 → pozisyon 450, toplam 600. ✔
  1:5 (K8) = çıkış 750 → kazanç +600 (= 6R). 1:3 = çıkış 450 → +300 (= 3R). Zarar: 150 → 50 (−100 = −1R).
- **Strike seçimi:** ATM'den profilin OTM uzaklığına (`d = k × EM_vade`, §4.2.1) kadar olan **OTM** strike'lar taranır; her biri için RR ve skor hesaplanır.
  Delta 0,15–0,50 arası, likidite filtresinden geçen ve mod alt sınırını sağlayanlar arasından **önce skor, sonra RR** en yüksek olan seçilir.
  Kartta ayrıca "uzaklık kuralı strike'ı" (`d` noktası, k kaynağıyla: çapa / oto / başlangıç) ve onun RR'ı gösterilir, fark açıkça yazılır.

### 6.2 Setuplar
Ortak: dosyalar `src/lib/signals/setups/<id>.ts`, imza `(ctx: SetupCtx) => SetupCandidate | null`. Her setup ayrıca backtest için
`Strategy<P>` sarmalayıcısıyla (`src/lib/odte/strategies/firsat.ts`) kaydedilir. Seviyeler **dayanak fiyatı** cinsindendir; prim seviyeleri §6.1 ile türetilir.
Kısaltmalar: OR = 15 dk açılış aralığı, EM = günlük beklenen hareket (ATM straddle), EMr = kalan beklenen hareket ≈ EM × √(kalan dk / 390),
VWAP = seans VWAP'ı, hacim oranı = bar hacmi / son 20 bar ortalaması.

Bu setuplar 0–3 DTE opsiyonda 1:5'in matematiksel olarak mümkün olduğu durumlar için seçildi: kısa vadeli OTM opsiyonda gamma yüksektir,
dayanak hızlı ve tek yönlü hareket ederse prim birkaç kat artabilir; stop dayanak seviyesine sıkı bağlanırsa risk küçük kalır.
Yatay, gürültülü günlerde işe yaramazlar; bu yüzden rejim filtresi zorunludur.

**S1. Uyumlu açılış aralığı kırılımı (`orb-uyum`)** (Kaan'ın ana tarzı)
- Koşul: saat ≥ 09:45 ET; A1 ve A2 tam uyumlu; 1 dk kapanış OR dışında; hacim oranı ≥ 2; fiyat VWAP'ın aynı tarafında; OR yüksekliği ≤ 0,6 × EM
  (aralık çok genişse kırılımın kalan potansiyeli az).
- Giriş: kırılım barı kapanışından sonraki tarama.
- Stop (dayanak): OR orta noktası ile kırılım barının dibi (call) / tepesi (put) arasından **girişe yakın olanı**, ama girişten en az 0,15 × EM uzakta.
- Hedef (dayanak): giriş ± max(2 × OR yüksekliği, yön üstündeki ilk OI duvarı); en fazla açılış ± 1,2 × EM.
- Çıkış ek: Kaan'ın yüksek hacimli ters mumu (`kaanMomentum` `exitCheck`) ve §7.3 risk izleyici.

**S2. Sıkışma sonrası kırılım (`sikisma`)**
- Koşul: son ≥ 20 dakikalık aralık (yüksek − düşük) ≤ 0,25 × EM; 20 barlık Bollinger genişliği günün en düşük %20'sinde; A1 karışık değil;
  aralık sinyal yönünde kırılır, hacim oranı ≥ 2.
- Stop: kutunun orta noktası. Hedef: giriş ± 3 × kutu yüksekliği (en az 0,5 × EMr).
- Neden 1:5 olabilir: kutu dar olduğu için risk çok küçük, kırılım hareketi kutunun katları olabilir.

**S3. Trend içi VWAP geri alma (`vwap-geri-alma`)**
- Koşul: gün içinde trend kurulmuş (S1 benzeri kırılım olmuş veya fiyat ≥ 60 dk VWAP'ın bir tarafında); fiyat VWAP'a veya 5 dk EMA21'e geri çekilir,
  geri çekilme hacmi düşük (oran < 1), sonra trend yönünde hacimli (oran ≥ 1,5) bir dönüş mumu VWAP'ın doğru tarafında kapanır.
- Stop: geri çekilmenin dibi/tepesi (en az 0,1 × EM). Hedef: günün yüksek/düşüğü + 0,5 × EMr.

**S4. Gamma / OI duvarı kırılımı (`duvar-kirilim`)**
- Koşul: fiyat call duvarını yukarı (put duvarını aşağı) 1 dk kapanışla geçer; net GEX negatif veya fiyat gamma flip'in yanlış tarafında
  (dealer hedge'i hareketi hızlandırır, `analytics.gex`); hacim oranı ≥ 2; A1 uyumlu.
- Stop: duvarın geri altı/üstü (duvar − 0,1 × EM). Hedef: sonraki duvar veya giriş ± 0,7 × EMr (hangisi yakınsa, ama en az 4 × risk mesafesi).

**S5. Haber sonrası devam (`haber-devam`)**
- Koşul: Radar'da haber teyitli uyarı (`Alert.newsConfirm`) veya sınıflandırılmış haber (not artırımı, sözleşme, satın alma, makro veri);
  ilk sıçrama ≥ 0,5 × EM; sonra ≥ 5 dk konsolidasyon, sıçramanın ≥ %50'si korunur; konsolidasyon sinyal yönünde kırılır.
- Stop: konsolidasyonun dibi/tepesi. Hedef: ölçülü hareket (sıçrama uzunluğu kırılımdan itibaren). IV düşüşü varsayımı (çarpan 0,8).
- G bileşenindeki bilanço/makro vetosu bu setup için uygulanmaz (haberin kendisi tetik).

**S6. Ucuz IV + hareket öncesi (`ucuz-iv`)** (yalnızca 1–3 DTE)
- Koşul: IV rank < 20 (`baseline`), RV10 > ATM IV; S2 sıkışması; A1 uyumlu.
- Stop: kutu orta noktası. Hedef: EM sınırı (spot ± 1 × EM). Düşük sıklık beklenir.

**GLD/SLV özel:** S1, S2, S5 öncelikli; rejim UUP/TLT, teyit GDX/SIL (§4.2). FOMC (14:00 ET) ve CPI/NFP (08:30 ET) günleri makro bayrağı.
**NVDA:** S1, S3, S4; bilanço haftasında yalnızca S5.

### 6.3 Aday sonucu (tip)
```ts
export interface SetupCandidate {
  setup: SetupId; ticker: string; dir: 'call' | 'put'; at: number;
  und: { entry: number; stop: number; target: number };
  reason: string[];            // Türkçe kısa gerekçeler ("QQQ ve SPY VWAP üstünde, OR yukarı kırıldı", ...)
  exitCheck?: (bars: Bar[], i: number) => boolean;
}
export interface FirsatSignal extends SetupCandidate {
  contract: { expiry: string; dte: number; strike: number; type: 'call' | 'put'; bid: number; ask: number; iv: number | null; delta?: number };
  prem: { entry: number; stop: number; target: number }; rr: number; pTouch: number | null;
  otmRef: { k: number; kSource: 'capa' | 'oto' | 'baslangic'; d: number; strike: number; rr: number | null };
  confidence: ConfidenceResult; label: 'Zayıf' | 'Orta' | 'İyi' | 'Güçlü'; validated: boolean; sample: number;
  mode: PaperMode; sizing: { pct: number; contracts: number; cost: number; commission: number } | null;
  approval: { state: 'bekliyor' | 'onaylandi' | 'reddedildi' | 'suresi-doldu' | 'fiyat-kacti'; expiresAt: number; decidedAt?: number; fillAsk?: number };
  overnightOk: boolean;        // 1–3 DTE: gece taşınabilir mi (§7.8 ön koşulları o an için)
  dataSource: string; dataAgeSec: number; delayed: boolean;
  text: { title: string; body: string };   // "Başkan, ..." metni (§8.2)
}
```

**Aşama 3 kabul:** her setup için en az 1 pozitif ve 2 negatif sentetik bar fikstürü; `optionRR` için Kaan örneği testi (komisyon 0), komisyon testi
(aynı kurulum 1,50 $ komisyonla daha düşük RR; ucuz primde fark büyük), `autoK` testleri (60 günlük sentetik geçmiş → beklenen k; < 20 gün → k0;
IV rank düzeltmesi; kMin/kMax kırpma; sabit çapa MU/INTC/QQQ değişmez; strike adımına yuvarlama ve OTM tarafı), teta testi (aynı hedef, daha geç zaman → daha küçük ödül),
IV düşüşü testi; strike tarayıcı testi (likit olmayan strike atlanır, ITM'e kayılmaz). **Bu aşamada dur:** Başkan setup listesini ve ilk backtest
duman sonuçlarını görsün (modellenmiş fiyat, eldeki MU/QQQ/INTC günleriyle; GLD/SLV/NVDA verisi Aşama 6'da).

---

## 7. Aşama 4: kâğıt hesap ve para yönetimi durum makinesi (TASKS #24)

Dosyalar: `src/lib/paper/types.ts`, `src/lib/paper/account.ts` (saf durum makinesi), `src/lib/paper/sizing.ts`, `src/lib/paper/costs.ts`.
UI deposu `src/ui/firsatStore.ts` (`firsat-v1`). **Gerçek emir yok, aracı kurum yok.**

### 7.1 Durumlar (modlar)
| Mod | Ad (UI) | Aranan RR | Asgari güven skoru | Not |
|---|---|---|---|---|
| `AGRESIF` | Agresif 1:5 | ≥ 5 | 65 | Gün başı varsayılanı |
| `AGRESIF_4` | Yedek 1:4 | ≥ 4 | 65 | Aynı taramada ≥ 5 aday yoksa (Kaan: "1:5 bulamazsa 1:4") |
| `GUVENLI_KAR` | Güvenli (gün yeterli) | ≥ 2, yoksa ≥ 1,5 | 70 | Günde üst üste 4 kazanç sonrası |
| `GUVENLI_ZARAR` | Güvenli (zarar molası) | ≥ 2, yoksa ≥ 1,5 | 75 | Üst üste 2 kayıp sonrası |
| `DURDU` | Bugünlük bitti | yok | yok | §7.4 varsayımı; gün sonu (15:45 ET) her durumda |

- 1:4 de yoksa **işlem açılmaz** (Agresif modda 1:3 veya altı ile giriş yok). Ekranda "Başkan, şu an 1:5 veya 1:4 kurulum yok, bekliyorum." yazar.
- **Aynı anda tek açık pozisyon** (sermayenin %50'si kullanılıyor; ikinci pozisyon %100'e çıkarırdı). Gece taşınan 1–3 DTE pozisyon da açık pozisyondur;
  kapanana kadar yeni sinyaller "bilgi" olarak gösterilir, "Onayla" butonu çıkmaz.
- **Giriş yalnızca Kaan'ın onayıyla** (§7.7). Çıkışlar (stop, hedef, risk izleyici, zaman, gap) kâğıt hesapta **otomatiktir** ve bildirilir.

### 7.2 Pozisyon büyüklüğü (Kaan'ın kuralları, değiştirilemez)
- Pozisyon = **mevcut toplam sermaye × kademe yüzdesi.** Kademeler: **%50 → %40 → %30.** **Azami her zaman %50.**
- **Kayıp sonrası:** bir kademe aşağı (50 → 40 → 30; 30'un altına inmez). %30 kademesine inen kayıp ayrıca **Güvenli** moda geçirir
  (Kaan: "yine hata yaparsa %30 ile güvenli işleme başlasın").
- **Kazanç sonrası (Kaan kararı):** kayıplardan sonra gelen her kazanç kademeyi **bir adım** yükseltir (30 → 40 → 50); %50'deyken kazanç kademeyi değiştirmez (azami 50).
  Başabaş işlem (§7.4) kademeyi değiştirmez.
- **Kontrat adedi:** `adet = floor(pozisyon / (ask × 100 + komisyon_açılış))` (komisyon varsayılan 1,50 $/kontrat). Kapanış komisyonu çıkışta düşülür. 0 ise işlem yok, "Başkan, sermaye bu kontrat için yetmiyor" bilgisi.
  Kesirli kontrat **kapalı** (gerçekçi). Ayarda "kesirli simülasyon" anahtarı (Kaan'ın örnek rakamlarını birebir görmek için) olabilir; varsayılan kapalı.
- **Örnekler (birim testi olarak yazılır):**
  (1–4 Kaan'ın rakamlarıyla birebir; komisyon 0 ve kesirli simülasyon açık ayarıyla. 6–8 gerçek ayarlarla.)
  1. Sermaye 300, kademe %50 → pozisyon 150. Prim stopu %67 → R = 100. 1:3'te çıkış → +300 → sermaye 600 → sıradaki pozisyon 300.
  2. Sermaye 300, pozisyon 150, işlem 50'ye düşüp kapandı → sermaye 200 → sıradaki kademe %40 → pozisyon 80.
  3. Ardından bir kayıp daha → kademe %30 ve mod `GUVENLI_ZARAR` (aynı zamanda üst üste 2 kayıp).
  4. Günde üst üste 4 kazanç → mod `GUVENLI_KAR`, kademe kurala göre (azami %50).
  5. Hiçbir durumda pozisyon > sermaye × %50 olmaz (özellik testi: rastgele 10.000 işlem dizisi).
  6. Kademe dönüşü: %30'dayken kazanç → %40; bir kazanç daha → %50; bir kazanç daha → %50 (değişmez). %40'tayken kazanç → %50.
  7. Gün geçişi: gün %30 kademede kapandı → ertesi gün %30 ile başlar (mod `AGRESIF`, ardışık sayaçlar 0). Kazançla %40'a çıkar.
  8. Komisyon: ask 0,80 $, pozisyon 150 → adet = floor(150 / (80 + 1,50)) = 1; çıkış 2,40 $'da → net K/Z = (240 − 80) − 1,50 − 1,50 = 157 $.

### 7.3 Açık pozisyonda "risk artıyor" izleyicisi (`src/lib/signals/riskwatch.ts`)
Her taramada (açık pozisyon varken 1 dk) objektif tetikler değerlendirilir:

| Tetik | Tür | Tanım |
|---|---|---|
| T1 Ters mum | güçlü | Pozisyona ters, gövde/aralık ≥ 0,6, hacim oranı ≥ 2 (Kaan'ın çıkışı; `kaanMomentum` `exitCheck` ile aynı fonksiyon) |
| T2 VWAP kaybı | güçlü | 1 dk kapanış VWAP'ın ters tarafında |
| T3 Rejim dönüşü | güçlü | Profilin birincil rejim sembolü VWAP'ın ters tarafına geçti |
| T4 Momentum uyumsuzluğu | zayıf | Son iki itişte fiyat yeni tepe/dip yaptı ama RSI(14, 1 dk) ve itiş hacmi düştü |
| T5 IV düşüşü | zayıf | Girişten beri kontrat IV'si ≥ %15 düştü ve prim son 5 dk'da artmadı |
| T6 Teta / zaman | zayıf | 0DTE'de kalan süre < 60 dk ve hedefe kalan mesafe > 0,3 × EMr |
| T7 Kilit seviye | zayıf | Fiyat yön üstündeki OI duvarına veya günün yüksek/düşüğüne 0,1 × EM yakın ve fitilli ret mumu |

Kurallar (Kaan'ın "1:3'teyken risk artarsa uyar ve çıkar" isteği):
- Kâr ≥ **2R** iken **1 güçlü veya 2 zayıf** tetik → **"Başkan, risk artıyor, çıkıyorum"** bildirimi ve kâğıt pozisyon **kapanır** (o anki bid − kayma).
- Kâr 1R–2R arası iken aynı koşul → uyarı + stop girişe (başabaş) çekilir; ikinci tetikte çıkış.
- **İz süren stop:** kâr ≥ 2R → stop +1R'ye; ≥ 3R → +2R'ye; ≥ 4R → +3R'ye. Hedef (5R / 4R / 2R / 1,5R) gelince tam çıkış.
- Dayanak stopu veya prim tavanı (§6.1) → kayıpla çıkış. **0DTE: 15:45 ET'de zorunlu zaman çıkışı** (gün bitmeden kapanır).
  **1–3 DTE:** 15:45 ET'de §7.8 gece kararı verilir; vade günü geldiğinde o gün 15:45 ET'de kapanır.
- Güvenli modlarda 2R yerine 1R eşiği kullanılır.

### 7.4 Gün, sıfırlama ve sayaçlar
- İşlem günü 09:30 ET'de başlar. Gün başında: mod `AGRESIF`, ardışık kazanç/kayıp sayaçları 0, gün başı sermayesi kaydedilir.
- **Kademe** (50/40/30) gün geçişinde **taşınır** (Kaan kararı, 2026-11-13); düşüşten çıkış yalnızca kazançla, adım adım olur (§7.2).
- Gece taşınan pozisyonun sonucu, **kapandığı günün** sayaçlarına yazılır (ör. ertesi sabah gap stopuyla kapanırsa o günün ilk kaybıdır).
- **Kazanç / kayıp tanımı:** maliyetler sonrası net K/Z. |net K/Z| < pozisyonun %2'si ise "başabaş", sayaçları değiştirmez (varsayılan).
- **`DURDU` (K9, Kaan kararı 2026-11-13): varsayılan KAPALI.** Ayardan açılabilir: güvenli modda üst üste 2 kayıp daha, veya gün içi düşüş gün başı sermayesinin %50'si.

### 7.5 Maliyet ve dolum modeli (`costs.ts`)
- Komisyon: kontrat başına, **açılışta ve kapanışta ayrı ayrı** uygulanır; varsayılan **Midas 1,50 $** (Kaan bildirdi, 2026-11-13).
  Ayarda "Aracı: Midas (1,50 $) / IBKR (0,65 $) / Özel" seçimi ve elle değer girme; değer `costs.ts`'de tek sabit (`DEFAULT_COMMISSION = 1.5`).
  Backtest varsayılanı da kâğıt hesapla tutarlı olsun diye Fırsat raporlarında 1,50 $ kullanılır (`BT_FEE=1.5`; diğer eski raporlar 0,65 ile kalır).
- Giriş: ask + 0,01 $; çıkış: bid − 0,01 $. Gecikmeli zincirde giriş fiyatı = max(gecikmeli ask, model fiyatı şimdiki spot ile + yarım spread).
- En küçük dolum: 1 kontrat. Ask ≤ 0,05 $ olan kontratlar alınmaz (likidite).

### 7.6 Kayıt ve istatistik
- İşlem günlüğü: her kâğıt işlem (sinyal kimliği, mod, kademe, adet, giriş/çıkış primi ve dayanak, çıkış nedeni, R, K/Z, sermaye önce/sonra).
- Özsermaye eğrisi, günlük K/Z, maks. düşüş, kazanma %, ortalama R, beklenti, PF, mod bazında özet, en uzun kayıp serisi.
- "Hesabı sıfırla" (yeni sermaye ile), eski hesap arşivlenir (silinmez). CSV dışa aktarım. İsteğe bağlı: kâğıt işlemi Geçmiş sekmesine de "Fırsat (kâğıt)" olarak yaz.
- Günlükte onay bilgisi: sinyal zamanı, onay zamanı, onay gecikmesi (sn), sinyal anındaki ask ile dolum ask'ı farkı.

### 7.7 Manuel onay akışı ("Onayla"), Kaan kararı
Dosya: `src/lib/paper/approval.ts` (saf: süre ve geçerlilik kuralları), UI `src/screens/Firsat.tsx`.
- Kâğıt hesap **hiçbir sinyali kendiliğinden almaz.** Uygun sinyal (skor ≥ mod asgarisi, RR ≥ mod alt sınırı, açık pozisyon yok, adet ≥ 1) kartta
  **"Onayla"** ve **"Geç"** butonlarıyla gelir; bildirim gönderilir.
- **Süre (geçerlilik) kuralları:** sinyal aşağıdakilerden **ilki** gerçekleşince "süresi doldu" olur ve buton kaybolur:
  1. Zaman: 0DTE için **3 dk**, 1–3 DTE için **5 dk** (ayar: 1–10 dk; sabit `APPROVAL_TTL_MS`).
  2. Fiyat kayması: dayanak, girişten stopa olan mesafenin **%25**'inden fazla herhangi bir yöne kaydı (`|S − giriş| > 0,25 × |giriş − stop|`).
  3. Dayanak stop seviyesine dokundu veya hedefin yarısına ulaştı (fırsat kaçtı).
  4. Giriş penceresi bitti (0DTE için 14:30 ET veto saati dahil) veya piyasa kapandı.
  5. Yeni tarama aynı setup'ı geçersiz kıldı (skor mod asgarisinin altına düştü veya RR alt sınırın altına indi).
- **Onaya basınca yeniden fiyatlama:** zincir 60 sn'den eskiyse yeniden çekilir. Yeni ask ile RR ve adet yeniden hesaplanır.
  Yeni ask > sinyal ask'ı × 1,10 **veya** yeni RR < modun alt sınırı → işlem açılmaz, durum "fiyat kaçtı", Kaan'a "Başkan, fiyat kaçtı, girmedim" yazar.
  Aksi halde dolum = yeni ask + kayma, komisyon düşülür, pozisyon açılır.
- "Geç" veya süresi dolan sinyal kâğıt hesabı ve sayaçları **etkilemez**, ama kalibrasyon kaydına sonuçlarıyla birlikte girer (§5.5).
- Bildirime dokunmak uygulamayı Fırsat sekmesindeki karta açar. Uygulama kapalıyken gelen sinyal, süresi dolmuşsa açıldığında "süresi doldu" görünür.
- Çıkışlar onay beklemez (kâğıt hesapta otomatik). "Risk artıyor" bildirimi bilgi verir, pozisyonu sistem kapatır.

### 7.8 1–3 DTE pozisyonun gece taşınması ve gap riski, Kaan kararı
Dosya: `src/lib/paper/overnight.ts` (saf). 0DTE pozisyonlar **her zaman** 15:45 ET'de kapanır. 1–3 DTE pozisyonlar gece taşınabilir:
- **15:45 ET kararı.** Pozisyon şu koşulların **hepsi** sağlanırsa taşınır, yoksa 15:45'te bid − kayma ile kapanır:
  1. Ertesi seans vade gününden önce veya vade günü (vade günü 15:45 ET'de zorunlu kapanış).
  2. Ertesi açılıştan önce bilanço (kapanış sonrası / açılış öncesi) veya önemli makro olay (FOMC, CPI, NFP 08:30 ET) **yok**.
  3. Son 30 dk'da güçlü risk tetiği (T1–T3) yok ve rejim pozisyon yönünde.
  4. **Gap kötü senaryosu** kabul edilebilir: gece beklenen hareketi `σ_gece = S × IV_atm × √(Δt / yıl)` (Δt = 16:00 ET'den sonraki açılışa kadar takvim süresi;
     hafta sonunda ~65 saat). Pozisyon değeri `americanPrice` ile ertesi açılış anında `S ∓ 2 × σ_gece` (pozisyon aleyhine) ve IV × 0,9 ile hesaplanır.
     Bu senaryodaki kayıp **≤ 1,5R** ise taşınır.
- **Gece işaretleme:** özsermaye eğrisi gece pozisyonu kapanış bid'iyle gösterir; kartta "gece taşınıyor, kötü senaryo −x $ (y R)" yazar.
- **Ertesi sabah (gap yönetimi):** paper sistem açılış öncesi fiyatla işlem yapmaz.
  1. 09:31 ET'deki ilk tamamlanmış 1 dk barda: açılış dayanak stopunun ötesindeyse → **ilk alınabilir bid − kayma** ile çıkış, neden `gap`.
     Kayıp R'yi aşabilir; gerçek kayıp kaydedilir (R'ye kırpılmaz).
  2. Prim, %67 prim stop tavanının altında açıldıysa → aynı şekilde çıkış (`gap`).
  3. Açılış lehte gap ise: iz süren stop kuralı (§7.3) yeni fiyata göre hemen uygulanır; hedef ≥ ulaşıldıysa çıkış.
  4. İlk 15 dk (09:30–09:45) içinde yalnızca stop ve hedef çalışır; T1–T7 tetikleri 09:45'ten sonra devreye girer (açılış gürültüsü).
- Gece taşınan pozisyonun gün içi sayaç etkisi §7.4'teki gibidir. Raporlarda gece taşınan işlemler ayrı satırda (`gece: n, ort. gap R, en kötü gap R`).

**Aşama 4 kabul (birim testleri):**
- §7.2 örnekleri 1–8 (Kaan'ın rakamları komisyon 0 ile; kademe adım adım dönüşü; gün geçişinde kademe taşınması; 1,50 $ komisyonlu adet ve net K/Z).
- Durum geçiş tablosu (her mod × her olay: kazanç, kayıp, başabaş, gün başı, gece kapanışı).
- Risk izleyici tetikleri T1–T7 ve iz süren stop.
- Onay: süre dolumu kurallarının her biri (3 dk / 5 dk zaman, %25 kayma, stop dokunuşu, pencere sonu, geçersizleşme); "fiyat kaçtı" (ask +%10 veya RR düşüşü);
  onaysız sinyalin hesabı ve sayaçları değiştirmediği; "Geç" ve süresi dolanın kalibrasyon kaydına girdiği.
- Gece: 0DTE her zaman 15:45 kapanır; 1–3 DTE için her ön koşulun tek başına taşımayı engellediği; `σ_gece` hafta sonu ölçeklemesi; 2σ kötü senaryo eşiği (1,5R);
  ertesi sabah aleyhte gap → `gap` çıkışı ve R'yi aşan gerçek kayıp; lehte gap → iz süren stop; vade günü zorunlu kapanış.
- Maliyet: açılış ve kapanış komisyonu ayrı ayrı; aracı seçimi (Midas 1,50 / IBKR 0,65 / Özel).
- %50 tavanı özellik testi.

---

## 8. Aşama 5: Fırsat Penceresi ekranı (TASKS #25)

### 8.1 Sekme ve yerleşim
- Yeni sekme **"Fırsat"** (simge `◆` veya benzeri), `src/app/index.tsx` sekme listesine Radar'dan sonra eklenir; diğer sekmeler aynen kalır.
- Ekran (`src/screens/Firsat.tsx`), yukarıdan aşağı:
  1. **Hesap şeridi:** sermaye, bugünkü K/Z, mod (renkli rozet: Agresif / Yedek 1:4 / Güvenli / Durdu), kademe (%50/40/30), ardışık kazanç/kayıp.
  2. **Sinyal tickerları** (§4.1) ve "Seans modu" anahtarı, son tarama zamanı (İstanbul saati), veri kaynağı ve yaşı, kredi tahmini.
  3. **Açık pozisyon kartı** (varsa): kontrat, giriş, anlık prim, R cinsinden kâr, iz süren stop, risk tetikleri (yeşil/sarı/kırmızı).
  4. **Aktif fırsatlar:** her kart: ticker, yön, **setup adı**, **güven skoru (büyük, renkli) + etiket + "Doğrulanmamış n/30" veya "Güvenilir ✓"**,
     **RR**, vade + DTE, strike, giriş/stop/hedef (dayanak **ve** prim), boyut (kademe, adet, tutar), veri yaşı. Dokununca skor dökümü (A1…H, veto/ceza).
     **"Onayla"** ve **"Geç"** butonları ve geri sayım (kalan süre), "Hesapla'da aç" (Radar'daki desenle). Süresi dolan kartlar gri ve nedeniyle ("süresi doldu: fiyat kaydı").
     1–3 DTE kartlarda "gece taşınabilir / taşınamaz (neden)" satırı. Açık gece pozisyonunda kötü senaryo satırı.
  5. **Özsermaye eğrisi** (react-native-svg, mevcut `Chart.tsx` deseni) ve istatistikler.
  6. **İsabet** (kalibrasyon tablosu, §5.5) ve **Kayıt** (işlem günlüğü).
  7. Ayarlar: başlangıç sermayesi, aracı/komisyon (Midas 1,50 $ varsayılan), kayma, onay süresi (0DTE 3 dk, 1–3 DTE 5 dk), tarama aralığı, MarketData kullanımı, DURDU kuralı aç/kapa.
     **%50 / %40 / %30 kademeleri ayarda değiştirilemez sabittir** (Kaan kuralı).
- Alt bilgi her zaman: "Kâğıt işlem simülasyonu. Yatırım tavsiyesi değildir."

### 8.2 Metin üslubu (`src/lib/signals/text.ts`)
Radar'daki `text.ts` gibi, "Başkan," ile başlar, rakamlıdır, kısa ve nettir. Örnekler:
- Giriş: "Başkan, QQQ'da uyumlu açılış kırılımı. QQQ ve SPY VWAP üstünde, SMH güçlü, hacim 2,4 kat. 14 Kasım 0DTE 512C, giriş 0,84 $, stop 0,30 $ (dayanak 509,6),
  hedef 3,55 $ (dayanak 513,8). RR 1:5,0. Güven 74/100 (İyi, doğrulanmamış 12/30). Kâğıt hesap: %50 kademe, 1 kontrat, 84 $ + 1,50 $ komisyon. 3 dk içinde Onayla."
- Risk: "Başkan, risk artıyor: QQQ'da yüksek hacimli ters mum ve VWAP'a yaklaşıyor. Kâr 3,1R, kâğıt pozisyonu 2,62 $'dan kapattım."
- Mod: "Başkan, bugün üst üste 4 işlem tuttu. Gün yeterli, artık yalnızca 1:2 ve 1:1,5 kurulumlara bakıyorum."
- Onay: "Başkan, fiyat kaçtı (ask 0,84 → 0,97), girmedim." / "Başkan, QQQ fırsatının süresi doldu (fiyat kaydı)."
- Gece: "Başkan, NVDA 2DTE pozisyonu gece taşıyorum. Kötü senaryo (2σ gap) −46 $ (0,9R). Yarın 09:31'de gap kontrolü yapacağım."
- Mod: "Başkan, üst üste 2 kayıp. Bugünlük bu kadar zarar yeter, güvenli moda geçtim, kademe %30."

**Aşama 5 kabul:** sekme Expo Go'da açılır (Claude görsel test yapamıyorsa devir notunda açıkça yazar), boş durum metinleri Türkçe, ayarlar kalıcı,
Radar ve 0DTE ekranları değişmeden çalışır; `npm run check` geçer.

---

## 9. Aşama 6: backtest, Monte Carlo ve geçiş kriterleri (TASKS #26)

### 9.1 Veri
- GLD, SLV, NVDA için 12 ay geçmiş (EOD zincir + 1 dk barlar) gerekir. **Önce** `BT_DRYRUN=1 BT_TICKERS=GLD,SLV,NVDA npm run bt:fetch` ile kredi tahmini,
  sonra **Kaan'a sor** (telefonda MarketData kapalı olmalı, tek süreç). Yardımcı semboller (UUP, TLT, GDX, SIL, ^VIX) için `peers.mts`
  (MarketData kredisi gerekebilir; Yahoo yalnızca son ~30 günün 1 dk barını verir).
- QQQ ve MU/INTC günleri eldedir (Grok'un box'ında `/workspace/backtest/days`; başka makinede `BT_DAYS`).
- Gerçek gün içi kot kaydı (`bt:record`) QQQ, GLD, SLV, NVDA için başlatılması **Kaan onayı** ister (token, tek cihaz). 10–20 seans birikince `--source hybrid`.

### 9.2 Setup backtest'i (`backtest/firsat.mts` veya `compare.mts` ile)
- Maliyet: Fırsat raporlarında `BT_FEE=1.5` (Midas). OTM uzaklığı: sabit çapa ile oto k (§4.2.1) ayrı ayrı raporlanır.
- Her setup `Strategy<P>` olarak kayıtlı (`firsat-orb-uyum`, `firsat-sikisma`, ...). Motor: `pickStrike` + `exitCheck`; risk izleyicinin T1–T3'ü
  ve iz süren stop `exitCheck`'e dahil edilir.
- Walk-forward 5 kat, OOS sonuçları. Raporda setup × ticker × saat × yön kırılımı (mevcut rapor biçimi), **R cinsinden** beklenti, hedefe ulaşma oranı,
  ortalama gerçekleşen RR, MFE dağılımı, spread duyarlılığı (×0 / ×1,5).
- Modellenmiş fiyat uyarısı her raporun başında (mevcut uyarı metni).

### 9.3 Para yönetimi simülasyonu ve iflas raporu (`backtest/mc.mts`)
- OOS işlem dizisi (R cinsinden, gün etiketli) §7 durum makinesine sırayla verilir: özsermaye eğrisi, maks. düşüş, gün sonu modu dağılımı.
- **Monte Carlo:** OOS R dağılımından gün bloklu bootstrap, 10.000 yol, 20 / 60 / 250 işlem günü ufku. Rapor: medyan ve %10/%90 bitiş sermayesi,
  başlangıcın altında bitme olasılığı, **iflas olasılığı** (sermaye < başlangıcın %10'u veya < 1 kontrat alınamayacak tutar), en uzun kayıp serisi.
- Simülasyonlar Kaan'ın kararlarıyla: kademe adım adım dönüş, kademe gün geçişinde taşınır, komisyon 1,50 $ açılış + kapanış, gece taşınan 1–3 DTE işlemlerde
  gerçek gap (açılış fiyatı) ile kayıp. Onay gecikmesi için duyarlılık: giriş 1 ve 2 dk geç (bir sonraki barın açılışı) varyantları.
- Aynı simülasyonu **sabit kesirli** karşılaştırma için de çalıştır (bilgi amaçlı tablo). **Kaan'ın kuralı değişmez;** karşılaştırma yalnızca rapordadır,
  uygulamada önerilmez, varsayılan değiştirilmez.
- Grok'un ön hesabı (bilgi için, varsayımsal dağılımla, §12) aşağıdadır; Claude gerçek OOS dağılımıyla yeniden hesaplar.

### 9.4 Geçiş kriterleri ("güvenilir" etiketi için)
`backtest/criteria.mts`'ye `FIRSAT_CRITERIA` eklenir:
- Setup × ticker OOS: **n ≥ 60**, beklenti **≥ +0,15R**, **PF ≥ 1,3**, bootstrap %95 GA alt sınırı **> 0**, spread ×1,5'te beklenti hâlâ > 0.
- Sonra **ileriye dönük kâğıt test:** ≥ 30 sinyal (kova bazında), gerçekleşen kazanma oranı OOS oranının en fazla 10 puan altında, beklenti > 0.
- İkisi de geçmeden o setup için "Güvenilir ✓" yok; sinyaller "Doğrulanmamış" olarak gösterilmeye devam eder (Kaan yine görür).

**Aşama 6 kabul:** rapor `docs/reports/YYYY-MM-DD-firsat-backtest.md`; MC raporu aynı dosyada veya ayrı; geçen/kalan setuplar tablosu.
**Bu aşamada dur:** Başkan rapor özetini Kaan'a iletir.

---

## 10. Aşama 7 (yalnızca Kaan onayıyla): sunucu ve anlık bildirim (TASKS #27)
- `server/` (Node 24, `.mts`): tek MarketData tüketicisi (gerçek zamanlı opsiyon, cached/live), `src/lib/signals` ve `src/lib/paper` aynen kullanılır.
- Bildirim kanalı Kaan'ın kararı (TASKS #14): Telegram bot / ntfy / Expo push (Apple Developer hesabı ve dev build gerekebilir).
- Sabit IP (TASKS #16) tek cihaz kuralını çözer: telefon MarketData'ya doğrudan gitmez, sunucudan okur.
- Bu aşama **otomasyon** içerir; Kaan "şimdilik otomatize etme" dedi. Kaan açıkça onaylamadan dosya bile açılmaz.

---

## 11. Kaan'ın kararları ve açık varsayımlar

### 11.1 Kaan'ın cevapları (2026-11-13, kesin; Claude değiştirmez)
| # | Konu | Karar | Uygulandığı yer |
|---|---|---|---|
| K1 | Kazançtan sonra kademe | Kayıplardan sonra gelen her kazanç kademeyi adım adım yükseltir: 30 → 40 → 50 (azami 50) | §7.2, test 6 |
| K2 | Kademe gün geçişi | Kademe ertesi güne taşınır | §7.4, test 7 |
| K3 | Kâğıt hesaba giriş | Yalnızca Kaan "Onayla"ya basınca; onaylanmayan sinyalin süresi dolar (0DTE 3 dk, 1–3 DTE 5 dk, fiyat kayması %25, stop/hedef yarısı, pencere sonu, geçersizleşme) | §7.7, §8.1 |
| K4 | Gece taşıma | 1–3 DTE gece taşınabilir (ön koşullar ve gap yönetimiyle); 0DTE 15:45 ET'de kapanır | §7.3, §7.8 |
| K5 | Prim stopu | %67 kalır | §6.1 |
| K6 | NVDA/GLD/SLV OTM uzaklığı | Sistem oynaklıktan seçer: `d = k × EM_vade`, ticker başına oto k (60 günlük trend günü uzanması, IV rank düzeltmesi, kMin/kMax); MU/INTC/QQQ çapaları sabit | §4.2, §4.2.1, §6.1 |
| K7 | Komisyon | Midas 1,50 $/kontrat, açılışta ve kapanışta ayrı; ayardan değiştirilebilir | §6.1, §7.2, §7.5, §9 |
| K0 | Pozisyon boyutu | Azami %50, kademeler %50/40/30 (Kaan'ın bilinçli tercihi, ilk mesajdan) | §0, §7.2 |
| K8 | 1:N tanımı | 1:N = çıkış primi / giriş primi = N. 150 ile gir, 750 ile çık = 1:5; zarar 150 → 50 (−%67, −100 = −1R). RR bu çarpandır (eski "kazanç/risk" tanımı değil) | §6.1 (RR), §7.1 modları |
| K9 | DURDU kuralları | Varsayılan kapalı. Ör.3 (iki kayıp, GUVENLI_ZARAR ile devam) Kaan'ın sözüdür ve birebir çalışır. Ayardan açılabilir | §7.4, §11.2 #1 |

### 11.2 Açık (Kaan'ın cevabı bekleniyor; Claude varsayılanla uygular, tek sabit/ayarla değiştirilebilir bırakır)
1. ~~`DURDU` kuralı~~ → **K9 ile kapatıldı** (varsayılan kapalı, §11.1).
2. **Giriş penceresi, kış saati:** ET 09:45–13:00 olarak tutuluyor (kışın İstanbul 17:45–21:00, yazın 16:45–20:00). Kaan'ın "16:30–20:00" alışkanlığı yaz saatine göre;
   kışın pencere bir saat kaysın mı (ET sabit, varsayılan) yoksa İstanbul saati mi sabit kalsın?
3. **1 kontrat / kesirli simülasyon:** varsayılan kesirli kontrat kapalı (gerçekçi; 300 $ sermayeyle 150 $ bütçe, ≤ 1,48 $ primli kontrat demek). Kaan sermaye yetmediğinde
   "en az 1 kontrat" mı istesin (o zaman %50 tavanı aşılabilir, bu yüzden varsayılan kapalı), yoksa kesirli simülasyon mu?
4. **NBIS ve GLW sektörü:** SMH mi (kaan-momentum, 12 Kasım'da Grok'un tercihi) QQQ mu (Radar)? Varsayılan: SMH.

Küçük varsayılanlar (Kaan itiraz etmedi, aynen uygulanır): "gün yeterli" modunda kademe kurala göre aynı kalır; R = giriş primi − stop primi (+ komisyon);
aynı anda tek açık pozisyon; |net K/Z| < pozisyonun %2'si "başabaş" sayılır ve sayaçları değiştirmez.

---

## 12. İflas riski: Grok'un ön hesabı (bilgi amaçlı, kuralları değiştirmez)
Basit Monte Carlo (4.000 yol, günde en fazla 4 işlem, §7 kademe ve mod kuralları, kayıp −1R, %20 olasılıkla −1,3R kayma, Agresif kazancın yarısı 5R
yarısı 3R erken çıkış, Güvenli kazanç 2R/1,5R; iflas = sermaye < başlangıcın %10'u). Kazanma oranları **varsayımsaldır**, backtest'ten değil. Bu ön hesapta komisyon ve gece gap'i yoktu; Aşama 6 ikisini de içerir (1,50 $ komisyon ucuz primlerde R'yi büyütür, gap kayıpları R'yi aşabilir).

| Prim stopu (R / pozisyon) | Ufuk | Agresif isabet | Güvenli isabet | İflas olasılığı | Başlangıcın altında bitme |
|---|---|---:|---:|---:|---:|
| %67 (Kaan örneği) | 20 gün | %25 | %45 | %79 | %89 |
| %67 | 20 gün | %30 | %50 | %51 | %63 |
| %67 | 60 gün | %30 | %50 | %73 | %75 |
| %33 (daha sıkı stop) | 20 gün | %25 | %45 | %17 | %55 |
| %33 | 60 gün | %30 | %50 | %9 | %13 |
| %33 | 60 gün | %20 | %40 | %92 | %97 |

Okuma: %50 pozisyon ve %67 prim stopuyla tek kayıp sermayenin ~%33'ünü götürür; ardışık 3 kayıp hesabı neredeyse bitirir. Sonuç büyük ölçüde gerçek isabet
oranına bağlı; mevcut backtest'te `kaan-momentum-0dte` kazanma oranı %27, beklenti negatifti. 1:5 hedefte başabaş kazanma oranı ≈ %17–21 (maliyetle).
**Bu tablo Kaan'ın kuralını değiştirmek için değil, beklentiyi doğru kurmak içindir.** Kaan küçük bir tutarla başlayarak bu riski bilerek alıyor.
Claude, Aşama 6'da gerçek OOS dağılımıyla bu tabloyu yeniden üretir ve raporda aynı açıklıkla gösterir.

---

## 13. Dosya planı (özet)
```
src/lib/signals/types.ts        (A) sözleşme: SetupId, SetupCtx, SetupCandidate, FirsatSignal, ConfidenceResult
src/lib/signals/profiles.ts     (A) ticker profilleri (§4.2)
src/lib/signals/otm.ts          (A) OtmRule, autoK, strike uzaklığı (§4.2.1)
src/lib/signals/setups/*.ts     (A) orbUyum, sikisma, vwapGeriAlma, duvarKirilim, haberDevam, ucuzIv, index.ts
src/lib/signals/rr.ts           (A) optionRR, strike tarayıcı
src/lib/signals/confidence.ts   (A) scoreSignal, WEIGHTS, vetolar, Beta küçültme
src/lib/signals/riskwatch.ts    (A) T1–T7, iz süren stop
src/lib/signals/log.ts          (A) kayıt modeli, sonuç değerlendirme, kova istatistiği
src/lib/signals/text.ts         (A) Türkçe "Başkan, ..." metinleri
src/lib/paper/{types,account,sizing,costs}.ts  (A) durum makinesi
src/lib/paper/approval.ts       (A) Onayla akışı, süre dolumu, yeniden fiyatlama (§7.7)
src/lib/paper/overnight.ts      (A) gece taşıma kararı, σ_gece, gap çıkışı (§7.8)
src/lib/odte/strategies/firsat.ts (A) setupların Strategy<P> sarmalayıcıları + index.ts kaydı
src/ui/firsatStore.ts, src/ui/signalScan.ts, src/ui/scanCache.ts, src/ui/SignalTickers.tsx (B)
src/screens/Firsat.tsx, src/app/index.tsx (sekme), src/ui/notify.ts (notifyFirsat) (B)
test/signals.test.ts, test/paper.test.ts, test/fixtures/signals/** (C); package.json "test" betiğine eklenir (ana oturum)
backtest/firsat.mts, backtest/mc.mts, backtest/criteria.mts (FIRSAT_CRITERIA) (C)
docs/tasks/handoff/SINYAL-FIRSAT-asama-N.md, docs/tasks/SINYAL-FIRSAT-SORULAR.md (ana oturum)
```

## 14. Kaan'ın Claude'a yapıştıracağı başlangıç komutu
```
Merhaba Claude. OptionCalc reposunda çalışıyorsun. Önce AGENTS.md, CLAUDE.md, docs/TASKS.md ve docs/tasks/SINYAL-FIRSAT.md dosyalarını baştan sona oku.
Tasarımı Grok (Başkan) yaptı; sen uygulayıcısın. Aşama 0'dan başla, her aşamanın kabul listesini tamamla, npm run check geçmeden commit atma,
commit mesajları "[claude] <alan>: <ne>" olsun. Her aşama sonunda docs/tasks/handoff/SINYAL-FIRSAT-asama-N.md devir notu yaz, TASKS ve CHANGELOG'u güncelle.
Aşama 0, 3 ve 6 sonunda dur ve onay bekle. MARKETDATA_TOKEN gerektiren hiçbir şeyi bana sormadan çalıştırma, Expo'ya yayın yapma,
sunucu veya otomasyon kurma. %50 azami pozisyon kuralı benim bilinçli kararım, değiştirme. §11.1'deki kararlarım kesindir;
kâğıt hesaba giriş yalnızca benim "Onayla" butonuma basmamla olur. İş bölmek istersen §2.4'teki üç alt ajan ve dosya sahipliğini kullan.
Bana Türkçe yaz.
```
