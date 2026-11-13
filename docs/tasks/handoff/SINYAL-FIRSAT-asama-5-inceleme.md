# SINYAL-FIRSAT — Aşama 4–5 incelemesi (Grok, 2026-11-13)

**Kapsam:** commit 0ef4a05 ağacı (Aşama 4 kâğıt hesap + Aşama 5 Fırsat sekmesi). `npm test`, `tsc --noEmit`, lint, `bt:selftest` ilk çalıştırmada yeşildi; ardından kural incelemesi ve net hata düzeltmeleri.

## Kurallar (Kaan K0–K7) — kodda tutuyor

- **K0 %50 azami:** `MAX_KADEME = 0.5`, özellik testi (10.000 rastgele işlem, kesirli ve tam kontrat). Değiştirilmedi.
- **Kademe:** kayıpta 50→40→30 (30'un altı yok); kazançta 30→40→50 (50'de durur); başabaş değiştirmez. Ertesi güne taşınır, mod ve sayaçlar sıfırlanır (ör.7).
- **Örnekler:** 300, %50 → 150; 1:3 çıkış → sermaye 600, sonraki pozisyon 300. 150→50 kayıp → 200, kademe %40, pozisyon 80. İkinci kayıp → %30 + `GUVENLI_ZARAR`. 4 kazanç → `GUVENLI_KAR`.
- **Modlar:** Agresif önce 1:5, yoksa 1:4; 1:3 ile giriş yok. 4 kazanç veya 2 kayıp → güvenli (1:2, yoksa 1:1,5). Aynı anda tek açık pozisyon.
- **K5 / K7:** prim stopu %67 (150→50); komisyon 1,50 $ açılış ve kapanışta ayrı; adet `floor(bütçe / (fill×100 + komisyon))`.
- **K3:** giriş yalnız "Onayla"; 0DTE 3 dk, 1–3 DTE 5 dk; fiyat kayması %25; "fiyat kaçtı" (ask ×1,10 veya RR tabanın altı). Çıkışlar otomatik.
- **K4:** 0DTE 15:45 ET zorunlu kapanış; 1–3 DTE ön koşullarla gece taşınır, ertesi sabah gap çıkışı.

## K8 ve K9 (Claude ekledi — Başkan teyidi gerekir)

**K8 — 1:N = çıkış primi / giriş primi.** Kaan'ın "1:3'te çıktık, 150→450, elimizde 600" örneği bu okumayla uyumlu (prim 3 katına çıktı). Aynı rakamlar eski tanımla da tutar: risk 100 (150→50), +3R = +300 → 450. **1:5 ise ayrılır:** eski tanıma göre hedef +5R = çıkış 650 (kazanç +500); K8'e göre çıkış 750 (kazanç +600 = 6R). Claude bunu "Kaan onayı 2026-11-13" diye yazmış; form cevaplarında bu cümle yok. Kod K8 ile bırakıldı, çünkü 1:3 örneği çarpan okumasını da destekliyor. Başkan'a sorulmalı: "1:5 hedef 750 mi, 650 mi?"

**K9 — DURDU varsayılan kapalı.** §11.2 açık sorusuna Claude'un varsayılanı; ayardan açılabiliyor. Kaan'ın formunda açık bir evet/hayır yok. Varsayılan kapalı, ör.3 (iki kayıp sonra güvenli devam) Kaan'ın sözüyle uyumlu. "Kaan kararı" ifadesi abartılı; varsayılan olarak makul.

## Bulgular ve düzeltmeler

| Önem | Bulgu | Sonuç |
|---|---|---|
| Yüksek | 15:45'te gece kararı hedef/stop'tan önce çalışıyordu; kâr hedefindeki veya stopteki 1–3 DTE pozisyon taşınabilirdi | Düzeltildi: önce risk izleyici, sonra gece kararı. Test eklendi |
| Yüksek | "Onayla" taraması düşünce `leftMin=0` kabul edilip kart "pencere kapandı" ile düşüyordu | Düzeltildi: yerel seans saati; taze fiyat yoksa kart durur, "tekrar dener misin?" |
| Orta | Kart geçersizliği / yeniden fiyatlama kartın AGRESIF etiketine göre 1:5 tabanı kullanıyordu; 1:4,2 "fiyat kaçtı" olabilirdi | Düzeltildi: hesap modunun tabanı (Agresif'te 1:4) |
| Orta | Açık pozisyon varken bekleyen kartlarda Onayla görünüyordu | Düzeltildi: bilgi notu, buton yok |
| Düşük | Eski `firsat-v1` kaydında kâğıt ayar / kademe eksik kalabilirdi | Yüklemede varsayılanlarla arındırma |
| Düşük | Güvenli modda RR yetersiz mesajı hâlâ "1:5 veya 1:4 yok" diyordu | Metin düzeltildi |

## Başkan'a açık sorular (sade)

1. **1:5 hedef kaç?** 150 $'lık prim 750'ye mi çıksın (Claude / K8), yoksa 650'ye mi (eski 1:5 = 5 kat risk, risk 100 $)?
2. **DURDU kapalı kalsın mı?** Şu an iki kayıptan sonra güvenli moda geçiliyor, gün bitmiyor. Açılırsa: güvenli modda iki kayıp daha, veya gün içi sermayenin yarısını kaybedince o gün durur.
3. Gece taşıma henüz **bilanço / FOMC / CPI / NFP takvimine bakmıyor** (hep "olay yok" sayılıyor). Aşama 6'dan önce bağlansın mı?

## Expo önizleme

**Üretim / gerçek işlem için değil.** Fırsat sekmesi kâğıt simülasyon; ekranda da öyle yazıyor. Görsel Expo testi yapılmadı, canlı tarama çalıştırılmadı.

Önizleme (preview) yayını, Başkan ekranı görmek istiyorsa ve şunları kabul ediyorsa düşünülebilir: kâğıt hesap, gecikmeli zincir, T4/T5/T7 kapalı, gece kararı takvimsiz, K8 teyitsiz. **Production kanalına veya "hazır işlem aracı" diye yayınlanmamalı.** Aşama 6 (backtest + iflas raporu) ve takvim bağlantısı olmadan "güvenilir" etiketi de verilmez.

## Aşama 6 için gerekenler

- QQQ / GLD / SLV / NVDA geçmişi ve gün içi kayıt (MarketData token, Kaan onayı).
- Setup walk-forward, para yönetimi Monte Carlo, iflas raporu (`FIRSAT_CRITERIA`).
- K8 teyidi (hedef çarpanı backtest sonucunu değiştirir).
- İdealde: makro/bilanço bayrağı, T4/T5/T7, A2 göreli güç, CSV.

**Yayın bu incelemede yapılmadı.** Token kullanılmadı. %50 kuralı değişmedi.
