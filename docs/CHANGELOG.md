# CHANGELOG / devir notları

En yeni üstte. Biçim: `## YYYY-MM-DD — Ajan — başlık`, sonra ne / dosyalar / nasıl doğrulandı / açık sorular.

## 2026-11-13 — Claude — SINYAL-FIRSAT Aşama 5 (Fırsat ekranı + tarama bağlama) ve K8/K9 kararları

**Ne:**
- **Kararlar (Kaan onayı):** K8 — 1:N = çıkış/giriş prim çarpanı (RR = (P_hedef − komisyon/100) / (P_giriş + komisyon/100)); 1:5 = 150 → 750. K9 — DURDU varsayılan kapalı (ayar olarak açılabilir). `src/lib/signals/rr.ts`, `src/lib/paper/account.ts`, `SINYAL-FIRSAT.md` §6.1/§7.4/§11.1 güncellendi.
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
