# MarketData Trader onayı sonrası plan

Durum (12 Kasım 2026): MarketData.app **Trader** planı satın alındı (gerçek zamanlı, günde 100.000 kredi, geçmiş veri sınırı yok),
OPRA (bireysel / non-professional) onayı bekleniyor. Önceki backtest (deneme verisi, 91 gün, modellenmiş opsiyon fiyatı) mevcut motorda
**avantaj bulmadı** (v2 test beklentisi işlem başı −%1,7). Bu plan, gerçek veriyle ya bir strateji kanıtlamak ya da dürüstçe reddetmek içindir.
Altyapı hazır: `backtest/README.md`. Görev listesi: `docs/TASKS.md`.

> **Kritik bulgu:** MarketData geçmiş opsiyon verisini yalnızca **gün sonu (EOD)** veriyor. "Geçmiş gün içi opsiyon kotu" diye bir uç nokta yok
> (`/options/quotes?from&to` → günde 1 satır, IV/Greek yok). Gerçek gün içi opsiyon fiyatını ancak **bugünden itibaren kaydederek** elde ederiz
> (`backtest/record.mts`). Ayrıca hisse mumları (candles) hiçbir planda gerçek zamanlı değil (en iyi 15 dk gecikmeli) → uygulama gün içi barları
> artık Yahoo'dan alıyor (kredisiz), MarketData yedek.

> **Tek cihaz kuralı:** Aynı token iki cihaz/IP'den aynı anda kullanılırsa hesap 5 dk bloklanır. Box'ta indirme/kayıt çalışırken telefonda
> MarketData seçili olmamalı (0DTE ekranında CBOE kullan ya da uygulamayı kapat). Uzun vadeli çözüm: tek tüketici sunucu (Adım 8).

## Kredi bütçesi (özet)
| İş | İstek | Kredi | Süre |
|---|---:|---:|---|
| Adım 1 doğrulama (`probe.mts`) | ~9 | ~25 | 1 dk |
| 12 ay × 19 sembol geçmiş (1 dk mum + günlük EOD zincir) | ~5.100 | **~7.000** | ~65 dk (0,75 sn/istek) |
| 24 ay × 19 sembol | ~10.200 | ~14.000 | ~2 saat |
| Gün içi kayıt, cached mod, 3 sembol / 2 dk | 585/gün | ~585/gün | seans boyu |
| Gün içi kayıt, cached mod, 19 sembol / 2 dk | 3.700/gün | ~3.700/gün | seans boyu |
| Gün içi kayıt, canlı mod, 3 sembol / 5 dk, 30 strike | 234/gün | ~14.000/gün | seans boyu |
| Uygulama taraması, canlı zincir, 15 sembol / 5 dk | — | ~74.000/gün | — |
| Uygulama taraması, cached zincir, 15 sembol / 5 dk | — | ~3.500/gün | — |

Fiyatlandırma (MarketData belgeleri, Kasım 2026): geçmiş zincir **1 kredi / 1.000 kontrat**, mum 1 kredi / 1.000 mum, canlı zincir kontrat başına 1 kredi,
`mode=cached` **istek başına 1 kredi** (veri birkaç sn–dk eski olabilir; `maxage` ile sınırlanır). Sayaç 09:30 ET'de (İstanbul 17:30) sıfırlanır.
Tahminler `BT_DRYRUN=1 npm run bt:fetch` ile her zaman yeniden hesaplanabilir. Yani **kredi darboğaz değil; darboğaz gün içi opsiyon verisinin geçmişte olmaması.**

## Adım 1 — Onay günü: gerçek zamanlılık ve gecikme doğrulaması (seans açıkken, ~25 kredi)
1. Telefonda MarketData'yı kapat (CBOE seç). Box'ta: `MARKETDATA_TOKEN=... npm run bt:probe`.
2. Beklenen: `realtimeStock` ve `realtimeOptions` = true (kot yaşı < 20 sn), `cachedFreshSec` (cached zincirin yaşı), `candlesDelayedMin` ≈ 15,
   `intradayOptionHistory` = false. Sonuç `/workspace/backtest/probe-<tarih>.json`.
3. Ölçülecek: istek gecikmesi (ms), cached tazeliği SPY/QQQ/IWM için kaç saniye. Cached ≤ 60 sn ise uygulama ve kayıt cached modda çalışır (kredi ~20× düşer).
4. Telefonda token'ı Hesapla › Ayarlar'a yapıştır, 0DTE ekranında kaynak "MarketData (gerçek zamanlı)" ve gecikme 0 görünmeli.

## Adım 2 — 12 (tercihen 24) ay gerçek geçmiş veri (tek gün, ~7–14 bin kredi)
1. Tahmin: `BT_DRYRUN=1 BT_START=2025-11-12 npm run bt:fetch` (istek atmaz).
2. İndir: `BT_START=2025-11-12 BT_MAX_CREDITS=40000 BT_RESERVE=20000 npm run bt:fetch` (kesilirse aynı komut kaldığı yerden; Temmuz–Kasım zaten önbellekte).
   24 ay için `BT_START=2024-11-12`. Seans dışında (İstanbul gece / hafta sonu) çalıştır, uygulamayla çakışmasın.
3. `BT_OFFLINE=1 BT_START=2025-11-12 npm run bt:prep` → gün kayıtları. `node backtest/validate.mts` → EOD model hatası (önceki: medyan ~%6).
4. Not: eski "deneme" verisi en fazla ~4 ay geriye gidiyordu; Trader'da sınır yok.

## Adım 3 — İleriye dönük gerçek gün içi kayıt (onay gününden itibaren her seans)
1. Box'ta her seans: `nohup npm run bt:record > /workspace/backtest/record-$(date +%F).log 2>&1 &` (16:00 ET'de kendisi durur).
   Varsayılan: SPY,QQQ,IWM, 2 dk, cached. Adaylar netleştikçe `REC_TICKERS` genişlet (19 sembol ≈ 3.700 kredi/gün).
2. Ertesi gün `npm run bt:fetch` + `bt:prep` (kayıtlı günün EOD/mum kaydı), haftalık `node backtest/validate-intraday.mts`:
   model ↔ gerçek gün içi orta fiyat hatası ve gerçek spread / model spread oranı.
3. 10–15 seans sonra kalibrasyon: spread çarpanı (`BT_SPREAD_MULT`), gün içi IV kayması → 12 aylık modellenmiş backtest'i kalibre maliyetle yeniden koş.

## Adım 4 — Tüm aday stratejileri yeniden test
`npm run bt:compare -- --folds 5 --n 60` (modeled, 12–24 ay) ve kayıt biriktikçe `--source hybrid`. Adaylar (`src/lib/odte/strategies/`):
| id | Fikir |
|---|---|
| `confluence-v2` / `-v1` | Uygulamadaki mevcut motor (taban) |
| `orb-vwap` | Açılış aralığının ilk kırılımı + VWAP eğimi + hacim (SPY/QQQ/IWM) |
| `gamma-regime` | +GEX ve flip üstü → VWAP'a dönüş; −GEX/flip altı → trend takibi |
| `oi-wall` | En büyük OI strike'ında red (fade) ya da net kırılım (break) |
| `em-breach` | Fiyat günlük beklenen hareketin k katını aşınca momentum |
| `*@sabah`, `*@ogleden-sonra` | Zaman dilimi filtreli sürümler (`withTimeFilter`) |
İlk duman testi (deneme verisi, modellenmiş, 91 gün): hiçbiri aday eşiğini geçmedi; en iyisi `orb-vwap@sabah` (OOS 18 işlem, +%5, istatistiksel olarak anlamsız).
Rapor: `/workspace/backtest/reports/latest/report.md`.

## Adım 5 — Sağlamlık kontrolleri (aday için hepsi gerekli)
- **Walk-forward OOS** (parametreler yalnızca geçmişte seçilir) — karar yalnızca OOS'a göre.
- **Maliyet**: spread ×1,5 ve kayma $0,02'de beklenti hâlâ > 0.
- **Alt dönemler**: her çeyrek ayrı; en az 3/4 çeyrek pozitif. **Semboller**: tek sembole bağımlı değil (SPY'siz de pozitif mi?).
- **Parametre komşuluğu**: seçilen değerin komşuları da pozitif (sivri tepe = aşırı uyum).
- **Aykırı değer**: en iyi 5 işlem çıkarılınca beklenti > 0. **Yön**: yalnızca call ya da yalnızca put'a bağımlıysa dikkat.
- **Çoklu test**: ~8 strateji × 60 parametre denendi → tek bir t > 2 şans olabilir; ADAY için OOS t ≥ 2,5 tercih et.
- **Gerçek fiyat**: hybrid (kayıtlı gün) sonuçları modellenmişle aynı yönde olmalı.

## Adım 6 — Seç ya da reddet
Eşikler `backtest/criteria.mts` (rapor otomatik etiketler):
- **ADAY** (kâğıt işleme geçer): OOS ≥ 60 işlem, beklenti ≥ +%3/işlem (maliyet sonrası), PF ≥ 1,15, %95 güven aralığı alt sınırı ≥ −%2.
- Hiçbiri geçmezse: dürüst sonuç "avantaj yok". Uygulama hesaplayıcı + bilgi ekranı olarak kalır, gerçek parayla sinyal işlemi yapılmaz;
  yeni fikirler (Kaan'ın kendi giriş kuralları dahil) aynı altyapıyla test edilir.

## Adım 7 — Kâğıt üzerinde işlem (4–8 hafta, Geçmiş sekmesi)
1. Uygulamada yalnızca ADAY strateji(ler) bildirim üretir (strateji kimliği sinyal ve günlük kaydına yazılır — TASKS.md).
2. Her sinyalde "✓ Aldım" → kâğıt pozisyon (gerçek ask'tan giriş, çıkış bildirimiyle çıkış). Geçmiş'te strateji bazlı özet.
3. Değerlendirme: ≥ 40 kâğıt işlem; beklenti backtest %95 aralığı içinde; gerçek giriş fiyatı ≤ model ask + 1 tik; bildirim gecikmesi < 1 dk.

## Adım 8 — Canlıya geçiş kriterleri (hepsi)
- Backtest OOS: ≥ 100 işlem, beklenti ≥ +%5/işlem, PF ≥ 1,25, %95 GA alt sınırı ≥ 0, maks. düşüş ≤ 10 × ortalama kayıp.
- Kâğıt: ≥ 40 işlem, beklenti > 0 ve backtest aralığında, maks. düşüş planlanan sınırın içinde.
- Başlangıç: 1 kontrat, günlük en fazla 2 stop sonra o gün dur, risk/işlem sermayenin ≤ %1'i.
- **Durdurma kuralı**: son 20 canlı işlemin beklentisi < −%10 ya da düşüş backtest maks. düşüşünün 1,5 katını aşarsa → kâğıda geri dön.

## Adım 9 (opsiyonel) — Uygulama kapalıyken bildirim: sunucu tarafı tarayıcı
Neden: iOS arka planda uygulamayı durdurur; fırsat taraması ve hedef/stop takibi yalnızca uygulama açıkken çalışıyor.
```
 [box / küçük VPS: Node 24 süreci, pm2/systemd, 09:25–16:05 ET]
   ├─ MarketData (TEK tüketici → tek cihaz kuralı çözülür; telefon artık token kullanmaz)
   │    cached zincir + toplu hisse kotu (/stocks/quotes/A,B,C/), barlar Yahoo
   ├─ src/lib/odte/strategies + scan.ts (aynı TS kodu, Node'da çalışır)
   ├─ kayıt (record.mts ile birleşir: tarama verisi = backtest verisi)
   ├─ durum: SQLite/JSON — sinyaller, kayıtlı push token'ları, açık pozisyonlar ("Aldım" senkronu)
   └─ bildirim: (a) hemen: Telegram bot ya da ntfy.sh (dev build gerekmez, ücretsiz)
                (b) Expo push: https://exp.host/--/api/v2/push/send
 [telefon] ← HTTPS (Cloudflare Tunnel / Tailscale, paylaşılan gizli anahtar): sinyal akışı, pozisyon senkronu, push token kaydı
```
- **Expo push için development build şart**: SDK 53'ten beri Expo Go'da uzak (remote) bildirim Android'de yok; iOS'ta da güvenilir yol
  `eas build --profile development` + APNs anahtarı → **Apple Developer hesabı (99 $/yıl)** gerekir. Bu yüzden önce Telegram/ntfy önerilir.
- Kredi: 15 sembol / 2 dk cached ≈ 3.000 + hisse kotları ≈ 3.000 → < 10.000/gün.
- Box'un sürekli açık kalıp kalmadığı doğrulanmalı; değilse 5 $/ay VPS.

## Zaman çizelgesi (öneri)
| Ne zaman | İş |
|---|---|
| Onay günü | Adım 1 (probe) + kayıt başlat + Adım 2 indirme (gece) |
| +1 gün | prep + compare (12–24 ay, modellenmiş) → ilk gerçek-veri sıralaması |
| +2–3 hafta | 10–15 kayıtlı seans → model kalibrasyonu → compare yeniden; hybrid ilk sonuçlar |
| +3–4 hafta | Seç/reddet (Adım 6); aday varsa kâğıt işlem başlar |
| +2–3 ay | Kâğıt sonucu → canlı kriterleri (Adım 8); paralelde sunucu tarayıcı (Adım 9) |
