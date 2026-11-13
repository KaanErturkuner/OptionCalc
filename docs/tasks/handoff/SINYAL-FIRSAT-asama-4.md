# SINYAL-FIRSAT — Aşama 4 devir notu (Claude, 2026-11-13)

**Yapılan**
- `src/lib/paper/`: `types.ts`, `costs.ts` (Midas 1,50 $, kayma 0,01, ask ≤ 0,05 alınmaz, gecikmeli giriş), `sizing.ts` (kademe 30/40/50, azami 50, adet = floor), `account.ts` (durum makinesi: mod, sayaçlar, açılış/kapanış, sinyal seçimi, özet), `approval.ts` (Onayla: 3 dk / 5 dk, %25 kayma, stop/hedef yarısı, pencere, geçersizleşme, "fiyat kaçtı" %10), `overnight.ts` (σ_gece, 1,5R kötü senaryo, 15:45 karar, gap çıkışı).
- `src/lib/signals/riskwatch.ts`: T1–T7, iz süren stop (2R/3R/4R → +1/+2/+3R), uyarı→başabaş→çıkış, 15:45 zorunlu çıkış.
- `test/paper.test.ts` (143 kontrol), `package.json` test betiğine eklendi.

**Kaan'ın örnekleri (birebir)**: §7.2 örnek 1–8 (R = 100, +300 → 600, sıradaki 300; 50 → %40 → 80; %30 + GUVENLI_ZARAR; 4 kazanç → GUVENLI_KAR; kademe dönüşü; gün geçişi; 1,50 $ komisyonla adet 1 ve net 157). §6.1: 1:5 = +500, 650 pozisyon, prim ≈ 4,33×. Özellik testi: 10.000 rastgele işlem (kesirli ve tam kontrat), pozisyon ≤ sermaye × %50.

**Varsayımlar (Başkan onayı istenir)**
1. **Çelişki — ör.3 ↔ DURDU:** iki kayıp, gün başı sermayenin %51'i → §7.4 "gün içi %50 düşüş → DURDU" (varsayılan açık) devreye giriyor; Kaan ör.3'te GUVENLI_ZARAR ile devam diyor. Varsayılan değiştirilmedi; ör.3 `durduEnabled: false` ile doğrulandı, açık haliyle DURDU davranışı ayrıca test edildi.
2. **Prim stopu:** formül `giriş × (1 − 0,67)` → R = 100,5 ve 1:3 sonrası 601,5 (Kaan yuvarlıyor: 150 → 50 = giriş/3 → R 100, 600). Test iki varyantı da kapsar. Hangisi?
3. **Mod yapışkan:** GUVENLI_* gün sonuna kadar kalır; DURDU gün sonuna kadar.
4. Boyut `ask + kayma` ile hesaplanır (bütçe asla aşılmaz); ör.8 sonucu aynı.
5. Hedef primi sinyalin RR'ından gelir; mod hedefi (5/4/2/1,5R) yalnız kayıt ve risk eşiğinde kullanılır.
6. Başabaş: |net| < pozisyon maliyetinin %2'si; sayaç ve kademe değişmez.
7. Gece: taşıma için vade ≥ ertesi işlem günü; kötü senaryo `americanPrice`, T = vade 16:00 − ertesi 09:30.

**Yapılmadı / sonraki**
- `firsatStore`, Fırsat ekranı, arayüz bağlama ve tarama döngüsüne bağlama (Aşama 5). T1–T7 bayrakları çağıran tarafta veriden hesaplanacak.
- Gerçek veriyle çalıştırma yok; MarketData token kullanılmadı; Expo yayını yok.

**Doğrulama:** `npm run check` çıkış 0 (test, tsc, lint 0 uyarı, bt:selftest).

**Grok'tan istenen karar:** (1) ör.3 ↔ DURDU çelişkisi (Kaan'a sorulsun mu?), (2) 0,67 mi 2/3 mi, (3) yapışkan mod kuralı.
