# SINYAL-FIRSAT — Aşama 1 devir notu (Claude, 2026-11-13)

**Yapılan**
- `src/lib/signals/tickers.ts`: doğrulama (loadSymbol biçimi), varsayılan 4 ticker, en fazla 8, 0–3 DTE uyarısı.
- `src/lib/signals/profiles.ts`: QQQ, NVDA, GLD, SLV profilleri; MU/INTC sabit 1,8; diğer hisseler/ETF'ler için genel kurallar; `auxSymbols`.
- `src/lib/signals/otm.ts`: sabit ve oto k (60 gün, %60 yüzdelik × 0,9, IV rank düzeltmesi, kMin/kMax; <20 gün → k0).
- `src/ui/firsatStore.ts` (AsyncStorage `firsat-v1`), `src/ui/scanCache.ts` (60 sn paylaşılan önbellek), `src/ui/signalScan.ts` (tur: veri → vade → snapshot → k → VWAP/çoklu dilim/hacim durumu).
- `src/ui/SignalTickers.tsx`: ayar alanı (çip, ekle, varsayılana dön, durum satırları). Geçici olarak Radar ayarlarında; Fırsat sekmesi Aşama 5'te.
- `src/ui/notify.ts`: `notifyFirsat` (yalnız ekleme). Tarama turu 2 dk aralıkla (ayar 1/2/5), seans içinde ve uygulama açıkken.

**Doğrulama:** typecheck, lint, `npm test` (signals 67 kontrol dahil), bt:selftest geçti. Radar testleri değişmedi.

**Varsayımlar (Grok onaylasın)**
- minOi 100, minVol 50, maxSpread %8 (SLV %12): spec'te sayı yok, Aşama 6'da kalibre edilecek.
- NBIS/GLW → SMH (§11.2 #4 varsayılanı). Radar'ın `universe.ts`'i değişmedi (NBIS/GLW hâlâ QQQ). Tek kaynak birleşmesi Kaan kararından sonra.
- kaanMomentum ve Radar SECTOR tablolarının birleşmesi yapılmadı.
- Oto k'da "60. yüzdelik" = 0,6 kantil olarak alındı.

**Yapılmadı / açık**
- Seans modu (ekran açık tutma): paket kurulu değil; SDK 58 dokümanı doğrulanmadı.
- Yardımcı sembollerin (UUP, TLT, GDX, SIL, SMH, SPY, ^VIX) barları çekilmiyor; Aşama 2 skorlamasında kullanılacak.
- Expo Go'da görsel test yapılmadı, yayın yok.

**Grok'tan istenen karar:** Aşama 1 kabulü; NBIS/GLW sektör kararı; minOi/minVol/spread varsayılanları.
