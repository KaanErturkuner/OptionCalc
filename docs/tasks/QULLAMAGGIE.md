# QULLAMAGGIE: Qullamaggie (Kristjan Kullamägi) setupları — 0–3 DTE opsiyon uyarlaması

Sahip: Başkan (Grok) tasarım, Claude uygulama. Kaan isteği (2026-11-13): "quallimage tekniklerini eklesene expoya göndermeden".
**Expo yayını yok, push yok, MarketData'ya bağlanma yok, token yazdırma yok.** Yeni native bağımlılık YOK (OTA, runtime exposdk:58.0.0).

## 0. Etiket kuralı (zorunlu)
- Kaan'ın onaylı listesi (D12/D13): risk bazlı brüt 1:5 hedef (1:4 yedek), −%40 prim stopu (2026-11-14; önceden %67), $1,50/kontrat/yön, yüksek hacimli dönüş mumu çıkışı,
  15:45 ET kapanış / takvim kapısı ile gece taşıma, kademe 50/40/30, DURDU, güvenli mod (1:2/1:1,5), 4 kazanç modu, manuel onay.
- Bunun dışındaki HER kural (Q setup tanımları, LOD çıkış tetiği, 5 dk EMA iz süren stop, eşikler) koda/spec'e
  **"Qullamaggie uyarlaması — Kaan onayı yok"** diye yazılır. Çıkışı/para yönetimini değiştiren uyarlamalar **varsayılan KAPALI**.
- Güven skoru ağırlıkları (`confidence.ts` WEIGHTS) DEĞİŞMEZ (Kaan onayı gerekir).

## 1. Günlük bağlam (yeni, saf): `src/lib/signals/qull/daily.ts`
Girdi: `DailyBar[]` ({D,o,h,l,c,v}, bugün HARİÇ, kronolojik), opsiyonel SPY günlük barları.
Fonksiyonlar (saf, testli): `ema(xs,n)`, `atrPct(bars,14)` (ATR/close), `rs(bars, spyBars, n)` (n günlük getiri farkı, 21/63),
`consolidation(bars)` → { days, rangeContraction (son 5 gün ort. aralık / önceki 20 gün ort. aralık), higherLows, nearHigh (close ≥ 0,9 × 63g yüksek) },
`priorMove(bars)` → 21/63 gün getiri, `extension(bars)` → (close − EMA10)/ATR ve ardışık yükseliş günü sayısı.
`qullDaily(bars, spy)` → `QDaily` { trendUp, trendDown, rs21, rs63, atrPct, consol, extUp, upDays, downDays, gapPct (bugünkü açılış verilince) , quality 0–100 }.
- trendUp: close > EMA10 > EMA20 ve EMA20 eğimi (5 gün) > 0. trendDown simetrik.
- quality (Q-kalite): prior move + RS + daralma + yüksek yakınlığı, 0–100; formül tek yerde, sabitler dosya başında.

Uygulamada günlük barlar: Yahoo v8 chart `interval=1d&range=6mo` (anahtarsız, mevcut `bars.ts` deseni), ticker başına günde 1 kez, AsyncStorage önbelleği.
Hata/veri yoksa Q setupları üretmez (sessizce değil: ticker durumunda "Q: günlük veri yok").
Backtest'te günlük barlar 1 dk gün kayıtlarından türetilir (o,h,l,c,Σv), yalnız ÖNCEKİ günler (sızıntı yok); ilk ~25 gün Q üretmez.

## 2. Setuplar (`src/lib/signals/setups/q1-orh.ts`, `q2-ep.ts`, `q3-parabolik.ts`)
`SetupId` birleşimine eklenir: `Q1` (ORH kırılımı, call), `Q1S` (ORL kırılımı, put — zayıf isimde ayna), `Q2` (Episodic Pivot), `Q3` (parabolik short, put).
`SetupCtx`'e opsiyonel `qd?: QDaily | null` ve `orWin?: { m5: {hi,lo}, m30: {hi,lo} }` eklenir. Giriş penceresi 09:30–13:00 ET (Kaan: 16:30–20:00 İstanbul).

- **Q1 ORH Breakout (call):** qd.trendUp, rs63 > 0 (SPY'den güçlü), consol.rangeContraction ≤ 0,8 ve nearHigh; fiyat açılış aralığı yükseğini kırar
  (varsayılan 5 dk OR; parametre 5|30), kırılım barında hacim oranı ≥ 1,5×. Dayanak stop = gün içi en düşük (LOD), hedef = giriş + 2 × (giriş − LOD) (yalnız RR/strike için; çıkış Kaan'ın prim hedefi).
- **Q1S ORL Breakdown (put):** ayna (trendDown, rs63 < 0, yakın dip, ORL kırılımı, stop = HOD).
- **Q2 Episodic Pivot:** |gapPct| ≥ max(%3, 1,5 × atrPct) (önceki kapanışa göre), ilk 15 dk hacmi ≥ 3 × (20 günlük ort. günlük hacim / 26) [≈ normal 15 dk'nın 3 katı];
  katalizör: Radar haber/bilanço varsa gerekçeye yazılır (zorunlu değil — backtest'te haber yok; bunu raporda belirt). Yukarı gap → ORH kırılımı call, aşağı gap → ORL kırılımı put. Stop LOD/HOD.
- **Q3 Parabolik short (put, DENEYSEL, varsayılan KAPALI):** extUp ≥ 3 (close ≥ EMA10 + 3 ATR) ve upDays ≥ 3; bugün ORL kırılımı veya ilk 30 dk'da VWAP altına sarkıp geri alamama → put. Stop HOD.
- Ticker kısıtı: Q setupları tüm sinyal tickerlarında izinli (ayarla kapatılabilir). Varsayılan sinyal listesi değişmez (QQQ, GLD, SLV, NVDA).

## 3. Güven skoru ve kart
- WEIGHTS değişmez. Q adayları mevcut `scoreSignal` ile puanlanır (aynı vetolar).
- Kartta ek satır: **"Q-kalite NN/100"** + kısa Türkçe açıklama (ör. "Q1: 3 ay güçlü trend, 8 gün daralma, 5 dk açılış yükseği kırıldı (hacim 2,1×). Stop gün dibi.").
- Q-kaliteyi skora katmak Kaan kararı (bkz. §8). Şimdilik bilgi amaçlı.

## 4. UI ve ayarlar (Fırsat/Sinyal ekranı)
- Q kartlarında **"Q"** rozeti (setup adı yanında), açıklama Türkçe.
- Ayarlar (Fırsat ayarları kartı): "Qullamaggie setupları" bölümü — Q1, Q1S, Q2, Q3 ayrı anahtar. Varsayılan: Q1 açık, Q1S açık, Q2 açık, Q3 kapalı.
  Altında not: "Qullamaggie uyarlaması — Kaan onayı yok. Q setupları backtest kriterini geçene kadar yalnız sinyal listesinde; kâğıt işleme uygun değil."
- **Uygunluk:** Q adayları `eligible = false`, sebep "Q: backtest kriteri geçilmedi" — kart görünür, "Onayla" görünmez. Bayrak tek yerde (`Q_PAPER_ELIGIBLE` set'i, boş).
- Opsiyonel çıkış uyarlamaları (Ayarlar, varsayılan KAPALI, etiketli): "LOD/HOD kırılırsa çık" ve "5 dk EMA10 iz süren stop". 0–3 DTE'de
  Qullamaggie'nin 3–5 gün sonra kısmi satış ve 10/20 günlük MA ile iz sürme **uygulanamaz** — spec ve UI notunda yaz.
- Firsat store şema sürümü artırılır, eski kayıtlar varsayılan Q ayarlarıyla yüklenir.

## 5. Backtest (çevrimdışı) — `backtest/qull.mts` (firsat.mts'i örnek al, ortak kodu kopyalamak yerine import et)
- `src/lib/odte/strategies/qull.ts`: `qull-q1`, `qull-q1s`, `qull-q2`, `qull-q3` stratejileri (firsat.ts sarmalayıcısı gibi; `DayInfo`'ya `daily?: DailyBar[]` (önceki günler) + SPY günlük).
- Ortam: `unset MARKETDATA_TOKEN; BT_OFFLINE=1 BT_FEE=1.5 BT_START=2025-11-14 BT_END=2026-11-11`.
- Tickerlar: QQQ, GLD, SLV, NVDA + **MU, INTC** (veri var: `/workspace/backtest/days/` ve `days-dte13/`). SPY günlük: `days/SPY.json` (yoksa RS bileşeni atlanır, raporda yaz).
- Gruplar: "0DTE/en yakın vade" (`days/`) ve "1–3 DTE" (`days-dte13/`). Not: MU/INTC'nin `days/` kaydı en yakın vade (DTE 0–2) — raporda belirt.
- Kaan çıkışları aynen (`kaan: { targetN: 5 }`, −%40 prim stopu (2026-11-14; önceden %67), 15:45 ET, $1,50). Walk-forward 5 kat, ilk %40 seçim; IS/OOS ayrı.
- Parametre uzayı küçük: OR 5|30 dk, hacim eşiği 1,5|2, Q2 gap çarpanı 1,5|2. Tek koşu 10 dk'yı geçerse örneklemi küçült.
- Tablolar Aşama 6 ile aynı biçim: ticker × grup (OOS), IS vs OOS ($300 replay: n, kazanma, ort. R, nihai, maks. düşüş), setup × ticker kriter kapısı
  (`backtestVerdict`, aynı `FIRSAT_CRITERIA`), MC (birincil + hedef varyantları, "işlem yapamaz" sütunu), kesirli bilgi varyantı.
- Rapor: `docs/reports/qullamaggie-backtest.md` (Türkçe, en başta 5 satır sonuç; sayılar yalnız kodun çıktısı; az örnek açıkça yazılır).
- Bir Q setup'ı kriteri GEÇERSE bile `Q_PAPER_ELIGIBLE`'a otomatik eklenmez; rapora "Kaan onayı ile açılabilir" yazılır.

## 6. Testler
`test/qull.test.ts` (package.json test betiğine ekle): daily.ts fonksiyonları (EMA, ATR%, daralma, RS, uzama), her Q setup için tetik/tetik yok örnekleri,
pencere dışı → yok, günlük veri yok → yok, Q3 varsayılan kapalı, Q adayları kâğıda uygun değil, ayar migrasyonu, backtest günlük bar sızıntısızlığı (gün i → yalnız < i).

## 7. Teslim
`npm run check` geçer. `[claude]` önekli küçük commit'ler (daily, setuplar, UI/ayar, backtest, rapor). Push yok. Bitince `/workspace/oc-claude-report-9.md` (kısa Türkçe özet).

## 8. Kaan'a sorulacaklar (rapora da yaz)
1. Q-kalite güven skoruna katılsın mı (WEIGHTS değişikliği)?
2. LOD/HOD çıkış tetiği ve 5 dk EMA iz süren stop açılsın mı?
3. Kriteri geçen Q setup'ı kâğıt işleme açılsın mı?
4. MU/INTC sinyal listesine eklensin mi?
