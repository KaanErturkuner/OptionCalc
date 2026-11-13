# SINYAL-FIRSAT — Aşama 3 devir notu (Claude uyguladı, Grok doğruladı, 2026-11-13)

**Yapılan (Claude)**
- Setuplar S1–S6 (`src/lib/signals/setups/`), `allowedFor` (GLD: S1/S2/S5; NVDA: S1/S3/S4).
- `optionRR` (Amerikan fiyatlayıcı, komisyon 1,50 $, prim stopu %67, teta için iki τ) ve `scanStrikes` (OTM, delta 0,15–0,50, likidite).
- `signalScan.scanOne`: snapshot + A1/A2 uyumu + setuplar + strike/RR; skor ve bildirim bu tura henüz bağlı değil.
- `test/setups.test.ts`: her setup için pozitif/negatif fikstürler, RR, strike, GLD align testleri.
- MarketData token kullanılmadı; zincir CBOE/Yahoo.

**Grok'un doğrulaması**
- İlk çalıştırmada `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run bt:selftest` yeşildi.
- Claude'un şüpheleri bu kopyada doğrulanmadı: `signalScan` importları (`trimChain`, `openRange`, `etOffset`, `etDate`, `MIN_PER_YEAR`, `loadBars`, `sessionBars`, `buildSnapshot`) mevcut ve imzalar uyumlu; `firsatStore` tipinde `setups: string[]` tanımlı (başlangıç `EMPTY.status` boş nesne, sorun tarama hata yolundaydı); align testleri (`GLD` vs UUP/TLT) çalışıyordu (dosya ortasındaki `import` Node'da hoist ediliyor).
- Net hatalar düzeltildi (aşağıda). TASKS #23 `done`, CHANGELOG kaydı `[grok] fix of stage 3 verification`.

**Grok'un düzeltmeleri**
- Yeni `src/lib/signals/session.ts`: `etMinutes`, `sessionLeftMin` (hafta sonu/tatil = 0, açılış öncesi tavan 390), `tradingDaysAfter`, `timeToExpiryMin` / `timeToExpiryYears`, `scaleEm`.
- `T0` artık takvim `dte × 390` değil, işlem seansları + bugünün kalanı (Cuma 15:00 → Pazartesi vade = 390+60 dk, 3×390+60 değil).
- Kalan EM: canlı ATM straddle vadeye kadarki hareket kabul edilir; `emRemain = straddle × √(kalan seans / vadeye işlem dk)`. 0DTE'de tekrar `√(kalan/390)` uygulanmaz (çift iskonto yok). Setup bağlamındaki `em` günlük ölçekli EM'dir; durum kartındaki `expectedMove` canlı straddle olarak kalır.
- Seans kapalıyken (`leftMin = 0`) setup çalışmaz.
- QQQ rejiminde kendisi var; `scanOne` `aux[t] = sb` enjekte eder, aksi halde A1 hiç true olmazdı.
- Tarama hata yolunda eksiksiz `TickerStatus` + `setups: []`.
- `test/setups.test.ts`: ortadaki import üste alındı; T0 / `leftMin` / `emRemain` / QQQ uyum testleri eklendi.

**Doğrulama:** `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run bt:selftest` geçti. Token, ağ veri çekimi, Expo yayını yok. %50 pozisyon kuralına dokunulmadı.

**Yapılmadı / açık**
- Güven skoru, bildirim ve "Onayla" taramaya bağlı değil (Aşama 2 çekirdeği hazır, bağlama Aşama 4–5).
- A2 göreli güç (RS) yok; sektör ayağı yalnız VWAP.
- `buildSnapshot` IV'si takvim yılı (`YEAR_MS`) kullanır, `T0` işlem yılı (252×390); canlı prim kıyası gerekir.
- `sessionBars` günü `now` değil son barın `etDate`'ine bakıyor (önbellekte dün kalırsa risk).
- Kalibrasyon ekranı, CSV, "Güvenilir" rozeti, Fırsat sekmesi, kâğıt hesap: sonraki aşamalar.
- Expo görsel test ve yayın yok.

**Sonraki: Aşama 4 (TASKS #24)**
Kâğıt hesap durum makinesi (Agresif 1:5 / Yedek 1:4 / Güvenli / Durdu), %50→40→30 kademe (**%50 azami, Kaan kararı, değişmez**), risk izleyici T1–T7, maliyet modeli, "Onayla" akışı (§7.7), 1–3 DTE gece taşıma (§7.8). Spec: Aşama 3 sonunda dur, Başkan onayından sonra başla.
