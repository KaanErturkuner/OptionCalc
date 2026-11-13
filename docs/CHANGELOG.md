# CHANGELOG / devir notları

En yeni üstte. Biçim: `## YYYY-MM-DD — Ajan — başlık`, sonra ne / dosyalar / nasıl doğrulandı / açık sorular.

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
