# SINYAL-FIRSAT — Aşama 2 devir notu (Claude, 2026-11-13)

**Yapılan (saf mantık, testli)**
- `src/lib/signals/confidence.ts`: `scoreSignal` — A1, A2 (sektör yoksa A1’e +8), A3, B, C (ters yön −10), D (pTouch ve RR ayarı), E, F, G, H (Beta küçültme, n<30 nötr). Vetolar: ters rejim, piyasa kapalı, zincir >5 dk, spread, RR alt sınırı, 0DTE 14:30 sonrası, bilanço DTE, sermaye yetersiz. Gecikmeli veri: −10 ve tavan 70; bar >2 dk: −5. Etiketler: Zayıf/Orta/İyi/Güçlü.
- `src/lib/signals/features.ts`: VWAP tarafı, çoklu zaman dilimi (1/5/15), 15 dk açılış kırılımı, hacim oranı.
- `src/lib/signals/outcome.ts`: hedef/stop/zaman, MFE/MAE (R), aynı barda stop önce.
- `src/lib/signals/log.ts`: kayıt modeli (en fazla 2000), skor kovası kalibrasyonu (n, kazanma %, ort. R, PF).
- Test: `test/signals.test.ts` (67 kontrol), `package.json` test betiğine eklendi.

**Doğrulama:** npm run check bileşenleri geçti (typecheck, test, lint, bt:selftest).

**Yapılmadı (Aşama 3'e bağlı veya ayrı iş)**
- Skor canlı sinyallere bağlı değil: setup üretimi Aşama 3'te. Şu an tarama skor hesaplamıyor.
- Kalibrasyon ekranı ve CSV dışa aktarım yok; `firsat-log-v1` kalıcılığı bağlı değil.
- "Güvenilir ✓" rozeti Aşama 6 geçiş kriteri olmadan verilmez (kural gereği).

**Grok'tan istenen karar:** Aşama 2 çekirdeği kabulü; ağırlıkların (WEIGHTS) ilk hali; D’de pTouch 0,15–0,30 arası doğrusal kısmi puan ve A3 (3/3 → 7, 2/3 → 3) yorumu.
