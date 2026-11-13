# CHANGELOG / devir notları

En yeni üstte. Biçim: `## YYYY-MM-DD — Ajan — başlık`, sonra ne / dosyalar / nasıl doğrulandı / açık sorular.

## 2026-11-13 — Claude — [claude] Veri tazelik göstergesi (TASKS #30)

**Ne:**
- **Saf çekirdek** `src/lib/freshness.ts`: üç kaynak — `md-options` (MarketData zincir/quote), `quotes` (hisse fiyatı / 1 dk bar; sağlayıcı kaydı: marketdata/yahoo/cboe/tradier), `news` (Radar: yahoo/sec/finnhub). Durumlar: kapalı (gri), hata (kırmızı), güncel (yeşil), gecikmeli (sarı), kullanılmıyor (dışlanır). Genel durum = en kötüsü. Tolerans = max(2 × aralık, 2 dk); haber için 15 dk.
- **Piyasa takvimi** `usmarket.ts`: yeni `sessionCloseMs` / `isSessionOpenNow` (erken kapanış 13:00 ET: Şükran ertesi, 3 Temmuz, 24 Aralık — yalnız işlem günüyse). `closeMs` / `marketOpen` / backtest DEĞİŞMEDİ.
- **Kapalı piyasa:** tüm kaynaklar gri (Radar haberleri de seans içinde çekildiği için). Son başarı ve son hata detayda görünür.
- **MarketData hisse verisi:** `quotes` + sağlayıcı `marketdata` → "gecikmeli (15 dk)" notu; sarı/kırmızı yalnız gerçek hatada ya da 15 dk payı da aşılınca.
- **Mesaj temizleme:** URL query atılır; Authorization / Bearer / token= / apikey= değerleri, kayıtlı ve ortam tokenları, 32+ karakterlik token benzeri dizgiler maskelenir; ≤ 160 karakter. Bildirimler asla fırlatmaz.
- **Bildirim noktaları:** `market/index.ts` `loadSymbol` (her sağlayıcı denemesi; MarketData bayat yanıtı = hata), `loadChain` (yalnız MarketData), `market/bars.ts` `loadBars` (Yahoo / MarketData), `news/index.ts` `NewsHub.poll` (kısmi başarı = güncel; tümü başarısız = hata).
- **Beklenen aralık:** sahip başına (`odte`, `firsat`, `radar`); etkin = en kısa aktif sahip. Tarama kapalıysa sahip kaldırılır.
- **UI:** `src/ui/freshnessStore.ts` (useSyncExternalStore, 20 sn'de bir yeniden hesap), `src/ui/FreshnessPill.tsx` (hap + RN Modal: kaynak, sağlayıcı, son başarı/hata İstanbul saatiyle, sonraki yenileme, renk açıklaması). Hap: 0DTE, Fırsat, Radar başlıkları.
- Yeni bağımlılık YOK. Token yazdırılmıyor; testler ağsız (fetch sahte).

**Dosyalar:** `src/lib/freshness.ts` (yeni), `src/ui/freshnessStore.ts` (yeni), `src/ui/FreshnessPill.tsx` (yeni), `test/freshness.test.ts` (yeni, npm test zincirinde), `src/lib/usmarket.ts` (ekleme), `src/lib/market/{index,bars}.ts`, `src/lib/news/index.ts`, `src/app/index.tsx`, `src/screens/{Odte,Firsat,Radar}.tsx`, `docs/TASKS.md`.

**Doğrulama:** `npm run check` geçti (testler, typecheck, lint, bt:selftest). Tazelik testi: durum geçişleri, hafta sonu / tatil / 13:05 ET erken kapanış, MD 15 dk notu, en kötü birleşim, mesaj temizleme (token, query, ≤160), reportFail'in fırlatmaması, sahte-401 ile loadSymbol bildirimleri ve token sızıntısı yok.

**Açık / Kaan'a sorular:**
- Görsel test yok: hap ve modal Expo Go'da henüz görülmedi (cihazda kontrol gerekli).
- MarketData hisse verisinde 15 dk payı aşılırsa sarı yapılıyor (yorum: "kırmızı/sarı yok" isteğinin yorumu). Yalnız "hiç yellow olmasın" istenirse tek satır değişir.
- Beklenen aralık sahipleri ekran başına; Odte ve Fırsat aynı `quotes` kaynağını farklı aralıkla tarar, etkin aralık en kısa olan olur.
- Yahoo fiyatlarının gecikmesi bilinmiyor → not düşülmedi (AGENTS: iddia etme).

## 2026-11-13 — Claude — [claude] QULLAMAGGIE: Q1/Q1S/Q2/Q3 setupları, Fırsat ayarları, çevrimdışı backtest (Kaan onayı yok)

**Ne:**
- **Etiket:** tüm Q kuralları "Qullamaggie uyarlaması — Kaan onayı yok". WEIGHTS değişmedi. Q setupları kâğıda uygun değil (`Q_PAPER_ELIGIBLE` boş); Q kartları görünür, Onayla yok.
- **Günlük bağlam** (`src/lib/signals/qull/daily.ts`): EMA, ATR%, RS21/63 (SPY), daralma, yakın tepe/dip, uzama, Q-kalite (bilgi amaçlı).
- **Setuplar** (`setups/q1-orh.ts`, `q2-ep.ts`, `q3-parabolik.ts`, `q-common.ts`): kırılım tetiği ızgara-bağımsız — OR dışındaki ilk kapanış son 5 dk içinde, hacim kırılım barında. İlk sürümdeki bar-bazlı kural (önceki bar içeride) kırılımların ~1/5'ini yakalıyordu; backtest'te Q1 neredeyse sinyal üretmiyordu. Düzeltildi, testli.
- **UI/ayar** (`src/screens/Firsat.tsx`, `src/ui/signalScan.ts`, `firsatStore.ts`): Q rozeti, Q-kalite satırı, Q1/Q1S/Q2 açık, Q3 kapalı; LOD/HOD ve 5 dk EMA10 çıkışları varsayılan kapalı (`src/lib/signals/qull/exits.ts`, paper `qExit`). Günlük Yahoo barları (1d, 6 ay, ticker başına günde bir kez, AsyncStorage). Firsat şema 3 (`migrateSettings` yalnız şema<2'de DURDU açar — `test/paper.test.ts` ile uyumlu).
- **Backtest:** `src/lib/odte/strategies/qull.ts` (qull-q1/q1s/q2/q3), `backtest/qull.mts`, `backtest/tables-common.mts` (firsat.mts ortak yardımcılarına geçti; duman koşusu çalıştı).
- **Rapor:** `docs/reports/qullamaggie-backtest.md`.

**Dosyalar:** `src/lib/signals/{qull/*,setups/*,types.ts,opp.ts}`, `src/lib/odte/strategies/{qull,index,types}.ts`, `src/lib/paper/{engine,account}.ts`, `src/lib/market/bars.ts`, `src/ui/{firsatStore,signalScan}.ts`, `src/screens/Firsat.tsx`, `backtest/{qull,tables-common,firsat,bt,engine}.mts`, `test/qull.test.ts` (npm test'e eklendi), `docs/{TASKS,reports/qullamaggie-backtest}.md`.

**Doğrulama:** `npm run check` geçti. Backtest çevrimdışı: `unset MARKETDATA_TOKEN; BT_OFFLINE=1 BT_START=2025-11-14 BT_END=2026-11-11 BT_FEE=1.5 node backtest/qull.mts --n 60 --folds 5 --paths 10000` (76 sn). MarketData'ya bağlanılmadı.

**Sonuç:** hiçbir setup × ticker × grup kriteri geçmedi (hepsi YETERSİZ VERİ). OOS'taki 13 işlemin hepsi kayıp; Q1 OOS'ta hiç sinyal yok. Huni: yapısal günlük koşul (Q1) 1484 hisse-günün 28'inde. RS63 yüzünden 2026-02-04'e kadar Q1/Q1S yok (veri 2025-11-03'ten başlıyor).

**Açık / Kaan'a sorular:**
- Q-kalite skora katılsın mı; LOD/HOD ve EMA10 çıkışları backtest'e eklensin mi (şu an ölçülmüyor)?
- MU/INTC sinyal listesine eklensin mi? (Uygulama listesi değişmedi.)
- 2025-11 öncesi günlük D-mumu çekimi (RS63 erken hazır olsun) için MarketData onayı.
- Backtest'te Q3 (IS n=2, OOS n=2) ve MC yorumu: küçük havuzda MC bilgi vermiyor (rapor §Monte Carlo).

## 2026-11-13 — Claude — [claude] SINYAL-FIRSAT Aşama 6 tamamlandı (çevrimdışı backtest, D13)
**Ne:**
- **D13 (Kaan kararı, TASKS):** (1) 1:5 brüt ölçülür, komisyon hariç; komisyon yalnız P&L'de. (2) 4 kazanç → 1:2 modunda 2 kayıp → güvenli; güvenli modda 2 kayıp daha → o gün dur; mevcut davranış, `test/paper-path.test.ts` D13(2) testiyle doğrulandı. (3) NVDA bilanço: Finnhub anahtarı yalnız ortam değişkeni/uygulama ayarı; kodda ve çıktıda yok.
- **Walk-forward + replay + MC:** `backtest/firsat.mts` (5 kat, 60 parametre, 10 000 yol, $300, kademe 50/40/30, DURDU açık). Yol MC'si `src/lib/paper/path.ts` (gerçek OOS işlemleri, hedef başına ayrı sonuç, güvenli mod hedefi 1:2).
- **Sonuç:** `docs/reports/asama-6-backtest.md` (rapor), `docs/reports/asama-6-tablolar.md` (otomatik tablolar). Hiçbir hücre kriteri geçmedi; OOS ortalama R negatif; S4–S6 veri yok.
- **NVDA bilanço tarihleri:** `backtest/aux-earnings.mts` (tek seferlik çekim). Finnhub bu planda yalnız gelecek tarihi (2026-11-17) döndürdü; `backtest/aux/earnings-NVDA.json` `complete: false` → kapı NVDA'yı "bilinmiyor" sayıyor.
- **Hata düzeltmeleri:** zincir önbellek anahtarında son kullanım tarihi (E) yoktu; 0DTE zinciri 1–3 DTE koşusuna sızıyordu (`backtest/sources.mts`, `backtest/bt.mts`). 1–3 DTE sayıları düzeldi (OOS 137 → 143). Yol MC'sinde işlem dizisi kırpıldı (495 sn → 49 sn duman koşusu).
**Dosyalar:** `backtest/{firsat,aux-earnings}.mts` (yeni), `backtest/{engine,peers,sources,bt}.mts`, `package.json` (test betiğine paper-path), `src/lib/paper/path.ts` (yeni), `test/paper-path.test.ts` (yeni), `docs/reports/asama-6-*.md`, `docs/TASKS.md` (#26 done, D13), bu kayıt.
**Doğrulama:** MarketData'ya bağlanılmadı (`unset MARKETDATA_TOKEN`; firsat.mts token varsa çıkar). Tam koşu: `BT_OFFLINE=1 BT_START=2025-11-14 BT_END=2026-11-11 BT_FEE=1.5 node backtest/firsat.mts --n 60 --folds 5 --paths 10000` (88 sn). `npm test` (paper-path dâhil), typecheck çalıştırıldı.
**Açık / Kaan'a sorular:**
- Yarım kalan MC iflas tanımı: sermaye 1 kontratı alamayınca hesap durur ama "iflas" sayılmaz (spec: < %10). Kaan tanımı değiştirmek isterse söylesin.
- 1–3 DTE gece taşıma backtest'te modellenmedi (gün içi kapanış). Taşıma kazancı/gap riski ölçülmedi.
- S4 (duvar), S5 (haber), S6 (IV rank) için veri yok; test edilemedi.
- NVDA geçmiş bilanço tarihleri: Finnhub planı/başka kaynak gerekir (`complete: true` olmadan kapı açılmaz).
- Grok'a: `src/lib/paper/path.ts` ile `mc.ts` (sentetik sonuçlu MC) iki ayrı yol MC'si var; path.ts Aşama 6'da kullanılan, mc.ts karşılaştırma. Birleştirme isterseniz söyleyin.

## 2026-11-13 — Claude — [claude] Başkan incelemesi 6 (oc-review-6) düzeltmeleri: D12, DURDU, takvim, B7/B9

**Ne:**
- **Etiketler:** "Kaan onayı" diye işaretlenmiş K8/K9 kaldırıldı (kod yorumları, SINYAL-FIRSAT §6.1/§7.4/§11, TASKS D10 → GEÇERSİZ). Kaan'ın kararı D12 olarak kaydedildi.
- **1:N risk bazlı (B1, `rr.ts`, `opp.ts`):** hedef = giriş + N × risk (150/50 → risk 100 → 1:5 = 650, 1:4 = 550). RR = (model çıkış − giriş)/risk. Kart hedefi risk bazlı; `MODE_RULES` eşikleri (5/4/2/1,5) aynı.
- **MC (`mc.ts`):** birincil `RISK` (+5R, 650 $) + DURDU açık; K8 yalnız karşılaştırma etiketli; R650 kaldırıldı.
- **DURDU (B2–B5, `account.ts`, `types.ts`, `firsatStore.ts`):** varsayılan AÇIK. 2 kayıp → GUVENLI_ZARAR; güvenli moda girişten sonra `safeLossStreak` 2 → DURDU (kazanç sıfırlar, başabaş değiştirmez). Kaldırıldı (onaysız): gün içi %50 düşüş (B2), kademe 30'a inen tek kayıp (B4), 4 kayıp eşiği (B3). Kayıt şeması 2: eski kayıtlarda `durduEnabled` bir kere true (`migrateSettings`).
- **Takvim (B6, `src/lib/calendar/events.ts`, yeni):** gece taşıma yalnız `calendarCheck` temizse. FOMC 2026 karar günleri hafızadan yazıldı (**doğrulanmadı**); CPI/NFP tablosu boş → kapsam yok → taşıma yok. Bilanço: Finnhub (anahtar yoksa "bilinmiyor" → taşıma yok; ETF muaf). Kontrol yalnız 15:45 ET'de, dte≥1 için, gün başına bir kez sorgulanır.
- **Backtest (B7, `backtest/engine.mts`, `bt.mts`, `sources.mts`):** komisyon 1,50; gün sonu 15:45 ET; `RunOpts.kaan` ile prim stopu %67 (giriş×0,33) ve prim hedefi (giriş + N×risk). `maxHoldMin` firsat'tan kaldırıldı.
- **Strike (B9, `firsat.ts`):** varsayılan `otmMode: 'oto'` → S ± k×EM0 (QQQ sabit 0,45; NVDA/GLD/SLV oto). `delta` yalnız karşılaştırma. Oto k geçmişi (`DayInfo.ratios`) yalnız önceki günlerden (selftest ile sızıntı yok kontrolü).

**Dosyalar:** `src/lib/signals/rr.ts`, `opp.ts`, `riskwatch.ts`; `src/lib/paper/account.ts`, `types.ts`, `mc.ts`, `overnight.ts`, `engine.ts`; `src/lib/calendar/events.ts` (yeni); `src/lib/news/finnhub.ts`; `src/lib/odte/strategies/firsat.ts`, `types.ts`; `src/ui/signalScan.ts`, `src/ui/firsatStore.ts`; `backtest/engine.mts`, `bt.mts`, `sources.mts`, `selftest.mts`; testler `test/setups`, `paper`, `mc`, `firsat`, `firsat-strategy`, `calendar` (yeni); `package.json` (calendar testi); `docs/TASKS.md` (D10, D12, #26), `docs/tasks/SINYAL-FIRSAT.md`.

**Doğrulama:** `npm run check` çıkış 0 (test, tsc, lint, bt:selftest). Yeni testler: 1:5 = 650, 1:4 = 550, DURDU sayaçları (K K → güvenli, K K ✓ K K → DURDU), tek kayıp kademe 30'da güvenli değil, takvim kapısı, oto k, prim stop/hedef ve 15:45 backtest kontrolleri.

**Yapılmadı / açık:**
- **Adım 9 (koşu) yapılmadı:** `/workspace/bt-data-QQQ-GLD-SLV-NVDA.zip` yok. MarketData'ya bağlanılmadı, ağdan veri çekilmedi. Adım 10 (MC OOS, moda göre hedef — B8) ve 11 (rapor) koşuya bağlı, yapılmadı.
- **B8 henüz yok:** MC hâlâ her işlemi tek N ile sayar (moda göre hedef seçimi yok). Adım 10'da.
- **Takvim:** CPI/NFP tarihleri girilene kadar gece taşıma hiç olmaz (güvenli taraf). FOMC tarihleri doğrulanmalı. NVDA bilançosu için Finnhub anahtarı gerekir (Radar ayarı).
- **Gece taşıma backtest'te modellenmiyor:** tüm pozisyonlar 15:45'te kapanır.
- **Dayanak hedef/stop hâlâ çıkış olarak duruyor** (prim kuralına ek). Prim hedefi önce gelirse o çıkılır; sonuçlar buna göre yorumlanmalı.
- **`fixedKademe` gün içi** (mc.ts) ve **MC'de moda göre N** (B8) açık (adım 10).
- **Kaan'a sorulacak:** gün içi %50 düşüş ve 120 dk maks. tutma kaldırıldı; isterse "öneri, varsayılan kapalı" olarak geri gelebilir.
- **Eski "Kaan onayı" kayıtları** (bu dosyadaki eski girişler, `docs/tasks/handoff/*`): tarihsel kayıt olarak bırakıldı, yukarıdaki düzeltme notuyla.

**Sonraki:** Başkan (Grok) inceleme. Veri zip'i gelince adım 9–11 (ayrıca TASKS #26).

## 2026-11-13 — Grok — [grok] Aşama 4–5 incelemesi

**Ne:** Claude'un Aşama 4 (kâğıt hesap) ve Aşama 5 (Fırsat sekmesi + tarama bağlama) kodu doğrulandı. İlk `npm test` / `tsc --noEmit` / lint / `bt:selftest` yeşildi. Kaan'ın sayısal örnekleri (300→150→1:3 çıkış→600; 150→50 kayıp→200→%40=80; ikinci kayıp → %30 + güvenli mod), %50 tavan, kademe 50→40→30 ve 30→40→50, güne taşıma, 4 kazanç / 2 kayıp güvenli mod, 1:5 sonra 1:4, %67 prim stopu, 1,50 $ komisyon, 0DTE 15:45, onay 3/5 dk ve "fiyat kaçtı" testlerde tutuyor. %50 kuralına dokunulmadı.

**Düzeltmeler:**
- 15:45 ET'de 1–3 DTE gece kararı hedef/stop/risk kontrolünden önce çalışıyordu; hedefe veya stopa gelmiş pozisyon taşınabilirdi. Sıra tersine çevrildi.
- "Onayla" taraması başarısız olunca `leftMin=0` yüzünden kart yanlışlıkla "pencere kapandı" ile düşüyordu. Artık yerel seans saati kullanılır; taze fiyat yoksa kart durur ve Başkan'a tekrar denemesi söylenir.
- Kart geçersizliği ve yeniden fiyatlama, kart etiketi AGRESIF diye 1:5'e kilitleniyordu (1:4,2 "fiyat kaçtı" olabilirdi). Tabana hesap modu uygulanır (Agresif'te 1:4 geçerli).
- Açık kâğıt pozisyon varken bekleyen kartlarda "Onayla" görünüyordu; bilgi notuna alındı.
- `firsat-v1` yüklemesinde kâğıt hesap ayarları ve kademe arındırılır.

**K8 / K9 (düzeltildi, D12):** Claude bunları "Kaan onayı 2026-11-13" diye işaretlemişti; yanlıştı. Kaan'ın kararı risk bazlı 1:N ve DURDU açık. Kaan'ın 1:3 örneği (150→450) hem eski "kazanç/risk" hem K8 (çıkış/giriş=3) ile uyumlu; 1:5 ise ayrılır (eski +5R → çıkış 650, K8 → çıkış 750). DURDU varsayılan kapalı, Kaan'ın form cevaplarında açıkça yoktu (§11.2 varsayılanı). Kod K8/K9 ile bırakıldı; Başkan teyidi istenir.

**Dosyalar:** `src/lib/paper/engine.ts`, `src/lib/paper/account.ts`, `src/ui/signalScan.ts`, `src/ui/firsatStore.ts`, `src/screens/Firsat.tsx`, `test/firsat.test.ts`, `docs/TASKS.md` (D11), `docs/tasks/handoff/SINYAL-FIRSAT-asama-5-inceleme.md`.

**Doğrulama:** `npm test` (yeni 15:45 hedef/stop testleri dâhil), `npx tsc --noEmit`, `npm run lint`, `npm run bt:selftest` geçti. Token, ağ çekimi, Expo yayını yok.

**Açık:** T4/T5/T7 bağlı değil; gece kararında `eventBeforeOpen` her zaman false (bilanço/FOMC/CPI/NFP yok sayılıyor); T1–T3 "son 30 dk" aslında anlık bar; A2 RS yok; görsel Expo testi yok.

## 2026-11-13 — Claude — SINYAL-FIRSAT Aşama 6 (kısmi: Monte Carlo, kriterler, setup sarmalayıcısı)

**Ne:**
- MarketData: Kaan "MarketData kapalı, devam et" dedi; token yalnızca çekim sürecinin ortamına alındı, repoya, log'a ya da sohbete yazılmadı. BT_DRYRUN: GLD/SLV/NVDA/QQQ 12 ay ≈ 1480 kredi. Çekim başladı, Başkan'ın talimatıyla durduruldu. Önbellek yarım (`C:\dev\bt-data`, repo dışı, 258 dosya). **Gerçek veri koşusu Başkan'dan gelecek.**
- `src/lib/odte/strategies/firsat.ts`: setup → Strategy sarmalayıcısı, `firsat-s1`…`firsat-s6` (STRATEGIES'e kayıtlı). A1 yalnız kendi sembolünün VWAP tarafı; kalan EM = günlük EM × √(kalan dk/390); S4 (duvar), S5 (haber), S6 (IV rank) verisi olmadığı için üretmez.
- `src/lib/paper/mc.ts` güncellendi: hedef tanımı iki varyant. **Birincil K8** (1:5 = çıkış 750 $) — *Claude'un yanlış etiketi, Kaan onayı değildi; 2026-11-13 D12 ile birincil risk bazlı (650 $) oldu, K8 karşılaştırma.* **DURDU birincilde açık** (D12), kapalı karşılaştırma olarak. `runMcVariants` dört kombinasyonu aynı tohum ve gün dizisiyle koşar.
- `src/lib/signals/criteria.ts`: `FIRSAT_CRITERIA`, backtest kapısı, "Güvenilir ✓" koşulları.
- Testler: `test/mc.test.ts` (K8 900 $ / R650 800 $ tek hedef; DURDU 4 kayıp sonrası 4 işlem / kapalıyken 5), `test/firsat-strategy.test.ts` (S1 kırılımı: hedef 2×OR, hacim/EM/pencere koşulları, S4–S6 veri yokken boş, bağlam).

**Doğrulama:** `npm run check` (aşağıda commit öncesi sonuç).

**Açık:** 1:5 hedefi 750 (K8) mı 650 mı, Başkan teyidi bekleniyor; MC her iki tanımı da raporlar. Gerçek veri koşusu, walk-forward raporu ve geçen/kalan tablosu yok (Başkan'dan veri bekleniyor).

## 2026-11-13 — Claude — SINYAL-FIRSAT Aşama 5 (Fırsat ekranı + tarama bağlama) ve K8/K9 kararları

**Ne:**
- **Kararlar (Claude etiketi — Kaan onayı DEĞİL; 2026-11-13 Başkan incelemesinde düzeltildi, D12):** K8 — 1:N = çıkış/giriş (1:5 = 750). K9 — DURDU varsayılan kapalı. Her ikisi de Kaan'ın kararı değildi. `src/lib/signals/rr.ts`, `src/lib/paper/account.ts`, `SINYAL-FIRSAT.md` §6.1/§7.4/§11.1 güncellendi.
- **Aşama 5:** Fırsat sekmesi (`src/screens/Firsat.tsx`): hesap şeridi, sinyal tickerları (Radar'dan taşındı), açık pozisyon, onay kartları (skor dökümü, geri sayım, Onayla/Geç), özet/kayıt, İsabet, ayarlar.
- **Tarama bağlama** (`src/ui/signalScan.ts`): skor (A1–H), RR (1:N), mod uygunluğu, boyut önizlemesi, kart yaşam döngüsü (süre, fiyat kayması, geçersizleşme, 30 dk soğuma, günde 10), pozisyon tick'i (T1/T2/T3/T6, 15:45, gece kararı, ertesi sabah gap), "Onayla" zinciri 60 sn'den eskiyse yeniden çeker.
- **Saf çekirdek:** `src/lib/signals/opp.ts` (kart), `src/lib/paper/engine.ts` (pozisyon tick), `riskwatch.ts` (`TRIGGER_AD`), `overnight.ts` (IV yoksa taşıma yok), `approval.ts`.
- Radar sekmesinden "Sinyal tickerları" kaldırıldı; artık Fırsat sekmesinde.

**Dosyalar:** yeni `src/lib/signals/opp.ts`, `src/lib/paper/engine.ts`, `src/screens/Firsat.tsx`, `test/firsat.test.ts`, `docs/tasks/handoff/SINYAL-FIRSAT-asama-5.md`. Değişen `src/ui/signalScan.ts`, `src/ui/firsatStore.ts`, `src/app/index.tsx` (sekme, açık pozisyonda 1 dk tarama), `src/screens/Radar.tsx`, `src/lib/signals/rr.ts`, `src/lib/signals/riskwatch.ts`, `src/lib/paper/{account,types,overnight}.ts`, `test/paper.test.ts`, `test/setups.test.ts`, `package.json` (test betiği), `docs/TASKS.md` (#25 done, D10), `docs/tasks/SINYAL-FIRSAT.md`.

**Doğrulama:** `npm run check` çıkış 0 (tsc, lint 0 uyarı, test, bt:selftest). `test/firsat.test.ts` kart (1:5 uygun, 1:4 AGRESIF_4, 1:3 veto, piyasa kapalı, DURDU, sermaye yetersiz) ve pozisyon adımı (hedef +300, stop −100, uyarı→çıkış, 15:45, 2DTE gece taşıma, ertesi sabah gap) için yeşil. **Ekran görsel olarak test edilmedi; tarama ağ üzerinde çalıştırılmadı.**

**Açık / eksik:** T4, T5, T7 tetikleri bağlı değil; haber/makro/bilanço bayrakları `false`; sektör göreli güç yok; H (tarihsel) n=0 nötr; D'de dokunma olasılığı EM tabanlı yaklaşım; "Güvenilir" rozeti yok (Aşama 6); CSV yok; özsermaye eğrisi liste.

**Sonraki:** Aşama 6 (backtest, Monte Carlo, iflas raporu). MarketData token'ı için Kaan onayı gerekir.

## 2026-11-13 — Claude — SINYAL-FIRSAT Aşama 4 (kâğıt hesap ve para yönetimi)

**Ne:** §7 durum makinesi, kademe/boyut, maliyet, "Onayla" akışı, gece taşıma ve risk izleyici (T1–T7, iz süren stop) saf fonksiyon olarak yazıldı. Kaan'ın sayısal örnekleri birim testi yapıldı. Gerçek emir, aracı ve UI yok.
- `src/lib/paper/types.ts`, `costs.ts`, `sizing.ts`, `account.ts`, `approval.ts`, `overnight.ts` (yeni)
- `src/lib/signals/riskwatch.ts` (yeni: T1–T7, `evaluatePosition`, `trailPrem`, `effectiveStopPrem`, `modeTargetR`)
- `test/paper.test.ts` (yeni, 143 kontrol) — `package.json` `test` betiğine eklendi
- `docs/tasks/handoff/SINYAL-FIRSAT-asama-4.md`, `docs/TASKS.md` (#24 done, #28 notu)

**Kaan kuralları:** %50 azami ve kademe 30/40/50 değişmedi (`MAX_KADEME`, `KADEMELER`). Kayıp → bir adım düş; kazanç → bir adım yüksel; başabaş değişmez; kademe gün geçişinde taşınır. Komisyon Midas 1,50 $ açılış+kapanış. Prim stopu %67. Onay süreleri 0DTE 3 dk / 1–3 DTE 5 dk. 1–3 DTE gece taşınabilir, 0DTE 15:45'te kapanır.

**Doğrulama:** `npm run check` çıkış 0 (test dahil paper 143 OK, tsc, lint 0 uyarı, bt:selftest). Ör.1–8 ve §6.1 örnekleri birebir (R 100, 600, 300, 80, 146,67, 650, 157); 10.000 işlemlik özellik testi (kesirli ve tam kontrat) pozisyonun sermayenin %50'sini hiç aşmadığını gösterdi.

**Açık / Başkan kararı:**
1. **Çelişki:** Kaan ör.3 (iki kayıp sonrası GUVENLI_ZARAR ile devam) ile §7.4 "gün içi %50 düşüş → DURDU" (varsayılan açık) aynı günde çakışıyor (%51). Varsayılan değiştirilmedi; §11.2 #1 Kaan'a sorulmalı.
2. Prim stopu 0,67 formülü R = 100,5 veriyor; Kaan'ın yuvarlak 100/600 örneği 2/3 ile tutuyor. Test iki varyantı da kapsıyor.
3. Mod sayaçları yapışkan (gün sonuna kadar). Hedef primi sinyalin RR'ından gelir.

**Sonraki:** Aşama 5 (Fırsat ekranı, `firsatStore`, tarama döngüsüne bağlama). Veri kaynağı yok, MarketData token kullanılmadı, Expo yayını yok.

## 2026-11-13 — Grok — [grok] fix of stage 3 verification

**Ne:** Claude'un SINYAL-FIRSAT Aşama 3 kodu (S1–S6, `optionRR`, strike tarayıcı, `signalScan` bağlantısı) doğrulandı. İlk `npm test` / `tsc --noEmit` / lint / `bt:selftest` yeşildi; Claude'un şüpheleri (eksik import, çalışmayan align testleri, `firsatStore` başlangıç `setups`) typecheck/testte doğrulanmadı. İncelemede net hatalar bulundu ve düzeltildi:
- `T0` takvim `dte × 390` kullanıyordu (Cuma→Pazartesi 3 hayali seans). Artık yalnız işlem günleri sayılıyor.
- `sessionLeftMin` hafta sonu ve tatilde de pozitif kalabiliyordu; artık 0.
- Kalan EM canlı ATM straddle'ı `√(kalan/390)` ile tekrar küçültüyordu (0DTE'de çift iskonto). Artık `EM_vade × √(kalan seans / vadeye işlem dk)`.
- QQQ rejiminde kendisi var; `aux` kendi barlarını içermediği için A1 asla true olmuyordu. `scanOne` artık `aux[t] = sessionBars`.
- Tarama hatasında `TickerStatus.setups` tanımsız kalabiliyordu; boş dizi varsayılanı eklendi.
- `test/setups.test.ts` ortasındaki `import` üstte toplandı; T0 / `leftMin` / `emRemain` / QQQ uyum testleri eklendi.
**Dosyalar:** yeni `src/lib/signals/session.ts`; değişen `src/ui/signalScan.ts`, `test/setups.test.ts`, `docs/TASKS.md` (#23 done, D9), bu kayıt, `docs/tasks/handoff/SINYAL-FIRSAT-asama-3.md`.
**Doğrulama:** `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run bt:selftest` geçti. MarketData token kullanılmadı, ağ çekimi ve Expo yayını yok.
**Açık / sonraki:** Aşama 4 (kâğıt hesap durum makinesi, %50 kademe değişmez, risk izleyici, maliyet). Skor ve bildirim hâlâ taramaya bağlı değil. A2 göreli güç (RS) henüz yok (sektör = yalnız VWAP). IV takvim yılı (`buildSnapshot`) ile T0 işlem yılı (252×390) karışımı duruyor; canlı veriyle fiyat kıyası gerekir. `sessionBars` günü `now` değil son barın tarihine bakıyor.

## 2026-11-13 — Claude — SINYAL-FIRSAT Aşama 1 (tamam) + Aşama 2 (çekirdek)
**Ne:**
- **Aşama 1 (#21):** sinyal tickerları ayarı (varsayılan QQQ, GLD, SLV, NVDA; en fazla 8; doğrulama; 0–3 DTE uyarısı), ticker profilleri (`profiles.ts`), OTM sabit/oto k (`otm.ts`), `firsatStore` (AsyncStorage `firsat-v1`), 60 sn paylaşılan önbellek (`scanCache.ts`), tarama turu (`signalScan.ts`, 2 dk), `notifyFirsat`, ayar bileşeni (geçici olarak Radar ayarlarında).
- **Aşama 2 (#22, çekirdek):** `scoreSignal` (A1–H, vetolar, gecikmeli veri tavanı, Beta küçültme, etiketler), `features.ts`, `outcome.ts` (hedef/stop/zaman, MFE/MAE R), `log.ts` (kayıt + kalibrasyon özeti). Kalibrasyon ekranı, CSV, canlı bağlama ve "Güvenilir" rozeti açık.
- **Replay hatası:** `backtest/replay.mts` için `--help` ve Türkçe ağ hatası; token kullanmaz.
**Dosyalar:** yeni `src/lib/signals/*` (9 dosya), `src/ui/firsatStore.ts`, `src/ui/scanCache.ts`, `src/ui/signalScan.ts`, `src/ui/SignalTickers.tsx`, `test/signals.test.ts`. Değişen: `src/ui/notify.ts` (ekleme), `src/screens/Radar.tsx` (ayar bileşeni), `src/app/index.tsx` (firsat.load + 2 dk tarama aralığı), `package.json` (test betiği), `backtest/replay.mts`.
**Doğrulama:** temiz kopyada typecheck, `npm test` (signals 67 + radar + prob + run), lint, `bt:selftest` geçti. `replay --help` çıkış 0; ağsız çalıştırma Türkçe hata verir.
**Açık:** seans modu (keep-awake paketi yok); NBIS/GLW sektör kararı (§11.2 #4, SMH varsayılan; Radar hâlâ QQQ); minOi/minVol/spread varsayılanları Aşama 6'da; Aşama 3–7 yapılmadı; Expo'da görsel test ve yayın yok; MarketData token kullanılmadı.
**Grok'a devir:** `docs/tasks/handoff/SINYAL-FIRSAT-asama-1.md` ve `-asama-2.md`.

## 2026-11-13 — Claude — SINYAL-FIRSAT Aşama 0 (port + bağlama)
**Ne:** Grok'un box dosyaları ana repoya kopyalandı (kaanMomentum, strateji tipleri/util/index, backtest engine/bt/compare/prep/validate/peers/live/replay, replay.defaults.env, test/run.ts, backtest/README, docs/tasks, docs/reports). `package.json`'a yalnız `bt:live` ve `bt:replay` eklendi.
**Doğrulama:** temiz kopyada `npm ci` (835 paket). `npm test`, `npm run typecheck`, `npm run lint`, `npm run bt:selftest` geçti. `replay.mts --help` bayrağı yok; komut Yahoo'ya gidiyor, ağ yokken ham hata veriyor (Türkçe değil, açık).
**Açık:** replay hata mesajı; Radar ve kaanMomentum SECTOR/ETF tanımları Aşama 1'de birleşecek; Aşama 0 sonunda dur, Başkan onayı bekleniyor. Expo yayını yapılmadı (Kaan istemedi); commit henüz yok.
**Grok'a devir:** `docs/tasks/handoff/SINYAL-FIRSAT-asama-0.md`.

## 2026-11-13 — Grok — SINYAL-FIRSAT: Kaan'ın cevapları işlendi

**Ne:** `docs/tasks/SINYAL-FIRSAT.md` güncellendi. §11 ikiye ayrıldı: §11.1 Kaan'ın kesin kararları (K0–K7), §11.2 açık sorular (DURDU, kış saati, 1 kontrat/kesirli, NBIS/GLW).
- Kademe: kayıptan sonra her kazanç bir adım yükseltir (30 → 40 → 50); kademe ertesi güne taşınır (§7.2, §7.4).
- Manuel onay: yeni §7.7 "Onayla" akışı; süre dolumu (0DTE 3 dk, 1–3 DTE 5 dk, %25 fiyat kayması, stop/hedef yarısı, pencere sonu, geçersizleşme), onayda yeniden fiyatlama ("fiyat kaçtı": ask +%10 veya RR düşüşü). Çıkışlar otomatik.
- Gece: yeni §7.8; 0DTE 15:45 ET'de kapanır, 1–3 DTE ön koşullarla taşınır (olay yok, rejim uyumlu, 2σ gece gap senaryosu ≤ 1,5R), ertesi sabah 09:31 gap çıkışı.
- Prim stopu %67 kesinleşti. OTM uzaklığı: yeni §4.2.1 `otm.ts` / `autoK` (60 günlük trend günü uzanması, IV rank düzeltmesi, kMin/kMax); MU/INTC/QQQ çapaları sabit.
- Komisyon: Midas 1,50 $/kontrat açılış ve kapanışta, RR'a ve adet hesabına dahil; Fırsat backtest'lerinde `BT_FEE=1.5`.
- Birim test listeleri (Aşama 3 ve 4) ve dosya planı (`otm.ts`, `approval.ts`, `overnight.ts`) güncellendi. TASKS #28 daraltıldı, D8 eklendi.
**Kod değişikliği yok** (yalnızca belgeler).

## 2026-11-13 — Grok — box işlerinin portu + SINYAL-FIRSAT görev tanımı
**Ne:**
- Box'ta kalıp GitHub'a gitmemiş işler GitHub sürümüne uyarlandı: `src/lib/odte/strategies/kaanMomentum.ts` (4 varyant), `types.ts` (`peer`, `strike`, `exitCheck`, `peers`),
  `util.ts` (`pickStrike`, yalnız OTM), `index.ts` (kayıt), `backtest/engine.mts` / `compare.mts` / `bt.mts` / `prep.mts` / `validate.mts` / `README.md`,
  yeni `backtest/peers.mts`, `live.mts`, `replay.mts`, `replay.defaults.env` (yalnız `BT_STEP=1`; Windows'ta da çalışsın diye `--env-file-if-exists`),
  `test/run.ts` (kaan-momentum + pickStrike testleri), `package.json` (`bt:live`, `bt:replay`; Claude'un `test` betiği korundu),
  `docs/tasks/RADAR.md`, `docs/reports/2026-11-12-*.md`.
- Yeni görev tanımı `docs/tasks/SINYAL-FIRSAT.md` (Sinyal tickerları, Güven Skoru, Fırsat Penceresi 1:5 RR, kâğıt hesap durum makinesi, backtest + iflas raporu);
  TASKS #20–#28; `AGENTS.md` §1/§2/§8/§10 güncellendi, yeni §11 (orkestra/uygulayıcı akışı); `CLAUDE.md` iş akışı maddeleri.
**Doğrulama:** GitHub sürümünün kopyasında port uygulanmış halde `npx tsc --noEmit` temiz, `npm test` (run + prob + radar) geçti,
`npm run bt:selftest` geçti (`BT_CACHE`/`BT_SNAPS` geçici dizin), `npx eslint src test` temiz; `live/replay/peers/compare/engine.mts` ayrı tsc ile temiz. Token kullanılmadı.
**Claude için:** Aşama 0 = bu dosyaları bağla/doğrula (SINYAL-FIRSAT §3). Radar `universe.ts` ile kaan-momentum `SECTOR`/`ETFS` farklı; Aşama 1'de birleştirilecek.

## 2026-11-13 — Claude — Radar (Aşama A–E)
**Ne:**
- **A. Olasılık** `src/lib/prob/implied.ts`: OTM smile (ln(K/F), 3'lü medyan, doğrusal enterpolasyon, düz ekstrapolasyon), risk-nötr `pAbove` (N(d2) − e^{rT}·vega·∂σ/∂K), `pBelow`/`pBetween`, dokunma olasılığı (≈ 2·P), kantiller, dijital çapraz kontrol, 25Δ risk reversal ve put kanadı eğimi.
- **B. Dedektörler** `src/lib/radar/`: baseline (20 gün P/C ve hacim, 1 yıl ATM IV ile IV rank/percentile, RV10/20, RR25 ort./std), 11 dedektör dosyası (P/C yığılması, olağan dışı kontrat, OI birikimi, IV sıçraması, skew kayması, rehavet/panik, pin/gamma, sektör ayrışması, bilanço, trend adayı). Her biri saf fonksiyon `(snapshot, baseline) => Signal[]`.
- **C. Haber** `src/lib/news/`: Yahoo RSS, SEC EDGAR (8-K, Form 4; User-Agent gerekli), Finnhub (anahtar isteğe bağlı), sözlük sınıflandırıcı, sembol ve şirket adı eşleme, 5 dk'da tek çekim, görülmüş-öğe kümesi.
- **D. Uyarı motoru ve Radar sekmesi**: `engine.ts` (30 dk gruplama, skor = 1 − Π(1 − şiddet), haber ve sektör teyidi, bildirim eşiği 0,6, liste eşiği 0,35, 60 dk soğuma, günlük bildirim tavanı 12), `text.ts` (Türkçe, "Başkan," ile başlar, ne oldu / neden önemli / olası senaryo / dikkat, veri yaşı, seans dışında "yarın için not"), `ui/radarStore.ts`, `ui/radarScan.ts`, `screens/Radar.tsx`. Tarama 5 dk aralıkla, uygulama aktifken ve piyasa açıkken çalışır.
- **E. İsabet**: 30 dk, 2 sa, gün sonu ve ertesi gün açılış fiyatları otomatik doldurulur; yön isabeti ve dedektör bazında özet; 👍/👎 geri bildirimi (`track.ts`).
**Dosyalar:** yeni: `src/lib/prob/implied.ts`, `src/lib/radar/**`, `src/lib/news/**`, `src/ui/radarStore.ts`, `src/ui/radarScan.ts`, `src/screens/Radar.tsx`, `test/prob.test.ts`, `test/radar.test.ts`. Değişen: `src/app/index.tsx` (Radar sekmesi, Hesapla'ya geçişte yeniden bağlama anahtarı), `src/ui/notify.ts` (`notifyRadar`), `package.json` (`test` betiğine iki dosya eklendi).
**Veri:** Radar yalnızca anahtarsız kaynakları kullanır (CBOE, sonra Yahoo). MarketData'ya hiçbir çağrı yapılmaz; token yalnızca `MARKETDATA_TOKEN` ortam değişkeninden okunur, kodda, testte, fikstürde veya commit'te yoktur.
**Doğrulama:** `npm test` (run + prob + radar) geçti; prob 28/28, radar 74/74. `npm run typecheck`, `npx eslint src test` ve `npm run bt:selftest` geçti. `bt:selftest` için `BT_CACHE` ve `BT_SNAPS` geçici dizine yönlendirildi (varsayılan `/workspace` yazılabilir değil). Radar testleri: her dedektör için pozitif ve negatif örnek, CBOE SPY 0DTE fikstürüyle anlık görüntü, dört türün birlikte tetiklendiği senaryo ve Türkçe metin kontrolleri.
**Doğrulanamadı / açık sorular:**
- Yahoo haber, SEC ve finans uç noktaları bu ortamdan 403 ile erişilemedi; ayrıştırıcılar sentetik örneklerle test edildi, canlı çağrı yapılmadı.
- Expo Go'da Radar sekmesi görsel olarak test edilmedi; Expo yayını yapılmadı.
- `kaanMomentum.ts` repoda yok; trend dedektörü geçici kuralla çalışıyor (1 dk açılış aralığı + VWAP + EMA9/21; hedef strike = spot ± k·beklenen hareket, hisse 1,8, ETF 0,45).
- Bilanço dedektörü pasif: son 8 bilanço hareketi kaynağı yok. Finnhub bilanço ayrıştırıcısı hazır ama tarama turuna bağlı değil.
- SEC için User-Agent iletişim e-postası Kaan'dan bekleniyor; boşsa SEC kapalı.
- Aşama F (sunucu tarayıcısı, Telegram/ntfy) başlatılmadı; Kaan onayı gerekiyor.
- Commit kapsamı: bu çalışma ağacında önceki oturumlardan commit'lenmemiş değişiklikler de var (`backtest/`, `docs/`, strateji modülleri, monitor/alert dosyaları, `package.json` bağımlılıkları). Radar'a ait olmayanlar bu commit'e karıştırılmadı; karar Kaan'da.
**Grok'a devir:** Radar evreni `src/lib/radar/universe.ts` ve `RADAR_WATCH` listesinde. Gün içi isabet verisi `radar-v1` AsyncStorage anahtarında birikiyor; 4–6 haftalık veriyle eşik kalibrasyonu yapılabilir. Dedektör eşikleri `src/lib/radar/detectors/` altında, her biri ayrı test edilebilir.

## 2026-11-12 — Grok — backtest altyapısı v2, aday stratejiler, plan ve ajan belgeleri
**Ne:**
- `src/lib/odte/strategies/`: takılabilir `Strategy<P>` arayüzü (saf TS, uygulamada da çalışır), `pickContract`, `withTimeFilter`;
  stratejiler `confluence-v2/v1` (mevcut motor sarmalı), `orb-vwap`, `gamma-regime`, `oi-wall`, `em-breach`, `orb-vwap@sabah`, `gamma-regime@ogleden-sonra`.
- `backtest/engine.mts` (genel motor), `sources.mts` (modeled / recorded / hybrid fiyat kaynağı), `wf.mts` (walk-forward), `compare.mts` (rapor JSON+MD),
  `criteria.mts`, `record.mts` (gerçek gün içi zincir kaydı), `probe.mts` (onay sonrası doğrulama), `validate-intraday.mts`, `selftest.mts`.
- `backtest/md.mts`: `BT_MAX_CREDITS` / `BT_RESERVE` bütçe koruması, `BT_DRYRUN=1` kredi tahmini, `noCache` (canlı istekler), gecikme ölçümü.
- Uygulama: `bars.ts` artık önce Yahoo (MarketData candles hiçbir planda gerçek zamanlı değil → eskiden 15 dk gecikmeli barlar kabul ediliyordu);
  `ProvOpts.mdMode: 'live' | 'cached'` (MarketData zincirinde cached mod — henüz UI'da yok, TASKS #6). Diğer UI davranışı değişmedi.
- `package.json`: `bt:*` betikleri ve `npm run check`.
**Doğrulama:** `npm run check` geçti. `confluence-v2` yeni motorda eski `bt.run` ile birebir aynı (290 işlem, −%4,65).
İlk duman karşılaştırması (deneme verisi, modellenmiş, 91 gün): hiçbir strateji ADAY değil; en iyisi `orb-vwap@sabah` OOS 18 işlem +%5 (anlamsız örneklem).
**Önemli bulgular:** MarketData'da geçmiş gün içi opsiyon verisi yok (yalnızca EOD) → gerçek gün içi fiyat için ileriye dönük kayıt şart.
12 ay × 19 sembol geçmiş ≈ 5.100 istek / ~7.000 kredi; 24 ay ≈ 10.100 istek / ~13.800 kredi (kuru çalıştırma; 45 günlük yedek zincir istekleri için +%10–20 pay).
**Claude için açık sorular:** TASKS #5 (motor denetimi) özellikle `simulateEntry` giriş/çıkış zamanlaması ve `precompute` gösterge penceresi.
