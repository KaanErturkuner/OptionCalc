# Uyarlanabilir çıkış niteliksel geri testi — 12 ve 13 Kasım 2026

Kaynak: `backtest/riskwatch-replay.mts` (yalnız Yahoo 1 dk, MarketData yok). Tam zaman çizelgesi: `/workspace/backtest/reports/riskwatch-replay-2026-11-12_13.md`.
Kapsam: dayanak fiyatı üzerinde karar, opsiyon primi modellenmedi. Karar her dakika, yalnız tamamlanmış barlarla, onaylı rejimle.
Girişler hindsight seçildi (dip = o pencerenin en düşük low'u); yani test **giriş sonrası çıkış davranışını** ölçer, giriş kalitesini değil.

## Sonuç (4 hipotetik pozisyon)

| Pozisyon | Enstrüman | Giriş (İst) | ÇIK (İst) | Dayanak ÇIK fiyatı | Sonra +30 dk (pozisyon yönünde) | Değerlendirme |
|---|---|---|---|---|---|---|
| P1 | QQQ PUT | 13/11 18:10 | 19:29 | 675,84 | +0,13% | erken (devam etti) |
| P2 | QQQ CALL | 12/11 09:31 ET dibi | 18:07 | 684,58 | +0,20% (+60 dk +1,11%) | erken (devam etti) |
| P3 | SPY PUT | 13/11 20:00 | 20:08 | 751,81 | −0,05% | yatay |
| P4 | QQQ CALL | 13/11 13:03 ET dibi | 22:51 | 678,17 | +0,18% | erken (devam etti) |

Ölçüm: 4 pozisyonun 4'ünde ÇIK çıktı; 3'ü erken çıkış (çıkıştan sonra seans sonuna kadar en iyi: P1 +0,33%, P2 +1,44%, P4 +0,47%), 1'i yatay (P3, en iyi +0,16%). Dört örnek istatistik değildir.

**Gözlem (tasarım):** ÇIK, karşı hareket %0,3'ü geçince verildi; bu eşik 1 dk gürültüsünün içinde. P3'te ÇIK girişten 8 dk sonra geldi (VWAP kaybı + momentum, 3 puan karşı devam kanıtı zayıf); P2'de 35 dk sonra (5 dk dip kırılımı + momentum, 3 puan; VWAP doğru tarafta). Kaan'ın sözü ("dönüyorsa geçsin, devam gösterge varsa devam") uygulandı; eşiğin ve ağırlıkların sıkılığı için karar veri birikince verilmeli.

## Rejim histerezisi (ham → onaylı, 5 dk kapanışları)

| Gün | Sembol | Ham değişim | Onaylı değişim | Not |
|---|---|---|---|---|
| 12/11 | QQQ | 16 | 10 | 22:45–23:40 arası 6 ham geçiş → 4 onaylı |
| 12/11 | SPY | 15 | 7 | |
| 13/11 | QQQ | 12 | 8 | 20:20 tek kapanışlık konsolidasyon sıçraması elendi; 20:25 karışık → 20:40 konsolidasyon onaylı kaldı (≥10 dk sürdü) |
| 13/11 | SPY | 12 | 10 | |

13/11 20:00–20:40 flip-flop'u: ham 4 geçiş (20:10, 20:20, 20:25, 20:40), onaylı 3 (20:10, 20:25, 20:40). Yani tek kapanışlık sıçrama süzüldü; 15 dakikalık karışık dönem onaylı kaldı. Bu tam bir süzme değil; daha sert bir eşik (ör. 3 kapanış) istenirse `REGIME_K.HYST_BARS` ile ayarlanır.

## Kullanılan kurallar
- Adaptif çıkış: `src/lib/signals/adaptive.ts` (`ADAPT`). Karşı hareket ≥ %0,3 → dönüş (VWAP kaybı 2, hacimli ters mum 2, 5 dk dip/tepe kırılımı 2, onaylı rejim aleyhte 2, momentum ters 1) ↔ devam (VWAP doğru taraf 2, HH/HL veya LH/LL 2, hacimli trend mumu 1, rejim lehte 1, momentum yönde 1).
- Sert %67 prim stopu, hedef ve 15:45 zorunlu çıkış ÇIK'tan önce gelir.
