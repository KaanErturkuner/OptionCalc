# Qullamaggie (Q1 / Q1S / Q2 / Q3) — çevrimdışı backtest

Tarih: 2026-11-13 · Tasarım: Başkan (Grok) · Uygulama ve koşu: Claude · **Qullamaggie uyarlaması — Kaan onayı yok.**
Veri: yalnız önbellek ve yerel gün kayıtları (MarketData'ya bağlanılmadı, `MARKETDATA_TOKEN` yok).
Komut: `unset MARKETDATA_TOKEN; BT_OFFLINE=1 BT_START=2025-11-14 BT_END=2026-11-11 BT_FEE=1.5 node backtest/qull.mts --n 60 --folds 5 --paths 10000` (76 sn).
Ham çıktı: `/workspace/backtest/reports/qullamaggie/` (`tables.md`, `report.json`, `trades.json`). Veri klasörü git'te değil.

## Sonuç (5 satır)

1. **Hiçbir Q setup × ticker × grup kriteri geçmedi.** Her hücre `YETERSİZ VERİ` (OOS n < 20). En büyük OOS hücresi n = 3 (1–3 DTE, Q1S, GLD). Kriter (`FIRSAT_CRITERIA`, değişmedi): n ≥ 60, beklenti ≥ 0,15R, PF ≥ 1,3, GA alt > 0, spread×1,5 > 0.
2. **Örneklem çok küçük ve tek yönlü.** Tüm Q setupları birlikte: 0DTE'de 6 OOS sinyali (3 alındı), 1–3 DTE'de 7 OOS sinyali (3 alındı). OOS'taki 13 işlemin **13'ü kayıp**, hiçbiri 1,5R'ye ulaşmadı. Kazanma %0, ort. R −0,79 (0DTE) / −0,72 (1–3 DTE).
3. **$300 ile kâğıt replay:** 0DTE tüm Q → 176 $ (−%41, maks. düşüş 124 $); 1–3 DTE tüm Q → 187 $ (−%38, maks. düşüş 113 $). Sinyallerin çoğu tam kontrat ve %50 kademe bütçesiyle alınamadı (yetersiz sermaye).
4. **Monte Carlo bu örneklemde bilgi vermiyor.** Havuz 13 kayıp işlemden oluşuyor; hedef varyantları (1:2, 1:1,5) birebir aynı sonuç verdi (nedeni aşağıda). "İşlem yapamaz" olasılığı %100. Sonuçlar karar için kullanılamaz.
5. **Karar:** Q setupları kâğıt işleme uygun değil (`Q_PAPER_ELIGIBLE` boş, değiştirilmedi). Bu veride Q1 hiç OOS sinyali üretmedi; Q1S ve Q3 yalnız kayıp üretti. Kaan onayıyla açılması için sonuç yok.

## Ne test edildi

- **Setuplar** (`src/lib/signals/setups/q1-orh.ts`, `q2-ep.ts`, `q3-parabolik.ts`, `q-common.ts`; günlük bağlam `src/lib/signals/qull/daily.ts`). Q3 varsayılan uygulamada kapalı; backtest'te yine de ölçüldü.
- **Kırılım tetiği:** OR (5 dk; parametre 5|30) dışındaki **ilk** kapanış son 5 dakika içinde ve son kapanış hâlâ dışarıdaysa kırılım; hacim kırılım barında (önceki 20 bar ort. ×). Gerekçe: ızgara değerlendirmesinde (5 dk) bar-bazlı "önceki bar içeride" kuralı kırılımların ~1/5'ini yakalıyordu; ilk sürümde Q1 neredeyse hiç sinyal üretmedi. Bu düzeltme koddadır ve testlidir.
- **Günlük bağlam:** EMA10/20, ATR%(14), RS21/RS63 (SPY'ye karşı), daralma (son 5 gün / önceki 20 gün aralık), yakın tepe/dip (63 gün), uzama (ext = (kapanış − EMA10)/ATR). Yalnız D < gün; sızıntı testi `test/qull.test.ts`.
- **Walk-forward:** 5 kat, 60 parametre seti, ilk %40 seçim; IS ve OOS ayrı. Param uzayı: OR 5|30, hacim 1,5|2, Q2 gap 1,5|2.
- **Maliyet ve çıkış:** Kaan çıkışları aynen (%67 prim stopu, hedef 1:5 brüt, komisyon $1,50/kontrat/yön, 15:45 ET kapanış, gece taşıma yok). Spread ×1,5 kontrolü. R tanımı motorla aynı (1R = giriş × 0,67).
- **Paper replay:** $300, kademe 50/40/30, tek açık pozisyon, DURDU açık, güvenli mod 1:2 (`src/lib/paper/path.ts`).

## Veri ve kapsam

- **Tickerlar:** QQQ, GLD, SLV, NVDA, MU, INTC. Gruplar: 0DTE (`days/`, 1484 hisse-gün) ve 1–3 DTE (`days-dte13/`, 1298). MU/INTC `days/` kaydı DTE 0–2 (raporda not).
- **Günlük barlar:** önbellekteki MarketData D-mumları (ticker başına 2025-11-03 → 2026-11-11, 258 bar; SPY dâhil). Gün kayıtlarından türetilmedi, çünkü gün kayıtları yalnız 2025-11-14'ten başlıyor ve RS63 için geçmiş yetmiyor.
- **RS63 ilk hazır gün: 2026-02-04.** RS63 için 64 işlem günü geçmiş gerekiyor; veri 2025-11-03'te başladığı için penceredeki ilk ~3 ay RS koşulu yüzünden Q1/Q1S üretemez. (Spec'teki "ilk ~25 gün" tahmini geçersiz: rs63 bunu aşıyor.)
- **SPY:** spec `days/SPY.json` diyordu; bu dosya yalnız 2026-07-06 → 11-10'u kapsıyor. Bunun yerine SPY D-mumları kullanıldı (tam pencere).
- **Haber/bilanço:** backtest'te haber verisi yok; Q2 katalizörü "zorunlu değil" olarak işaretlendi.
- **Tarama ızgarası:** motor 5 dk ızgarasında değerlendirir; giriş ızgara noktasındaki son kapanıştır (gerçek giriş en fazla 4 dk gecikmeli olabilir).

## Huni (neden az sinyal)

Koşul koşul hisse-gün sayısı (tüm günler; üst sınır; `tables.md`):

| Grup | Setup | Toplam gün | Günlük koşul | + gün içi kırılım | + hacim (aday gün) | Sinyal (IS+OOS) |
|---|---|---:|---:|---:|---:|---:|
| 0DTE | Q1 | 1484 | 28 | 715 | 4 | 2 |
| 0DTE | Q1S | 1484 | 66 | 694 | 7 | 4 |
| 0DTE | Q2 | 1484 | 27 | 9 | 3 | 1 |
| 0DTE | Q3 | 1484 | 7 | 1203 | 6 | 4 |
| 1–3 DTE | Q1 | 1298 | 28 | 633 | 4 | 3 |
| 1–3 DTE | Q1S | 1298 | 62 | 621 | 6 | 5 |
| 1–3 DTE | Q2 | 1298 | 23 | 7 | 3 | 1 |
| 1–3 DTE | Q3 | 1298 | 7 | 1072 | 6 | 4 |

Darboğaz **yapısal günlük koşul** (Q1: trend + RS>0 + daralma ≤ 0,8 + yakın tepe; 6 hisse üzerinde yılda 28 gün) ve ardından **kırılım + hacim** birleşimi. Gün içi kırılımların kendisi yaygın (715 gün); hacim ve günlük yapı birlikte nadir. Q2 için gap eşiği (|gap| ≥ max(%3, 1,5×ATR%)) 27 gün, ama ilk 15 dk hacmi + kırılım birlikte 3 gün. Bu bir hata değil, spec'in seçici koşullarının sonucu; örneklem yüzünden hiçbir istatistik güvenilir değil.

Not: Huni rakamları tüm günler üzerinde sayılır (walk-forward dışı). "Sinyal" sütunu ise strateji sayısıdır; huni ile sinyal arasındaki fark (ör. Q3 1–3 DTE: 6 aday gün, 4 sinyal) `maxPerDay`, pencere ve strike/fiyat adımlarından gelir.

## Setup × ticker (OOS) — kriter kapısı

Yalnız n > 0 hücreler (n = 0 hücreler `tables.md`'de; hepsi `YETERSİZ VERİ`):

| Grup | Setup | Ticker | OOS n | Kazanma | Ort. R | IS n | IS ort. R | Karar |
|---|---|---|---:|---:|---:|---:|---:|---|
| 0DTE | Q1S | GLD | 2 | %0 | −0,91 | 0 | — | YETERSİZ VERİ |
| 0DTE | Q1S | SLV | 2 | %0 | −0,80 | 0 | — | YETERSİZ VERİ |
| 0DTE | Q3 | MU | 2 | %0 | −0,65 | 0 | — | YETERSİZ VERİ |
| 1–3 DTE | Q1S | GLD | 3 | %0 | −0,70 | 0 | — | YETERSİZ VERİ |
| 1–3 DTE | Q1S | SLV | 2 | %0 | −0,80 | 0 | — | YETERSİZ VERİ |
| 1–3 DTE | Q3 | MU | 2 | %0 | −0,65 | 0 | — | YETERSİZ VERİ |

Kriteri geçen hücre yok.

## IS (seçim) vs OOS — $300 replay, aynı para yönetimi

| Grup | Setup | IS n | IS kazanma | IS ort. R | IS nihai | OOS n | OOS kazanma | OOS ort. R | OOS alınan | OOS nihai | OOS maks. düşüş |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0DTE | Q1 | 2 | %0 | −0,32 | 300 $ | 0 | — | — | 0 | 300 $ | 0 $ |
| 0DTE | Q1S | 0 | — | — | 300 $ | 4 | %0 | −0,86 | 3 | 176 $ | 124 $ |
| 0DTE | Q2 | 1 | %0 | −1,02 | 214 $ | 0 | — | — | 0 | 300 $ | 0 $ |
| 0DTE | Q3 | 2 | %50 | +1,99 | 214 $ | 2 | %0 | −0,65 | 0 | 300 $ | 0 $ |
| 0DTE | **Tümü** | 5 | %20 | +0,46 | 214 $ | 6 | %0 | −0,79 | 3 | **176 $** | 124 $ |
| 1–3 DTE | Q1 | 3 | %0 | −0,36 | 300 $ | 0 | — | — | 0 | 300 $ | 0 $ |
| 1–3 DTE | Q1S | 0 | — | — | 300 $ | 5 | %0 | −0,74 | 3 | 187 $ | 113 $ |
| 1–3 DTE | Q2 | 1 | %0 | −0,74 | 300 $ | 0 | — | — | 0 | 300 $ | 0 $ |
| 1–3 DTE | Q3 | 2 | %50 | +2,13 | 300 $ | 2 | %0 | −0,65 | 0 | 300 $ | 0 $ |
| 1–3 DTE | **Tümü** | 6 | %17 | +0,41 | 300 $ | 7 | %0 | −0,72 | 3 | **187 $** | 113 $ |

IS'te birkaç kazanan görünüyor (Q3, n = 2, +5R GLD dâhil); OOS'ta bunların karşılığı yok. n = 2 olduğundan bu bir "aşırı uyum" ya da "gerçek kenar" ayrımı yapmaya yetmez.

## Ticker replay (OOS, tüm Q birlikte, her ticker kendi hesabında)

| Grup | Ticker | Sinyal n | Alınan | Yetersiz sermaye | Nihai |
|---|---|---:|---:|---:|---:|
| 0DTE | GLD | 2 | 1 | 1 | 198 $ |
| 0DTE | SLV | 2 | 2 | 0 | 200 $ |
| 0DTE | MU | 2 | 0 | 2 | 300 $ |
| 1–3 DTE | GLD | 3 | 1 | 2 | 220 $ |
| 1–3 DTE | SLV | 2 | 2 | 0 | 200 $ |
| 1–3 DTE | MU | 2 | 0 | 2 | 300 $ |

QQQ, NVDA, INTC: OOS'ta sinyal yok. MU'nun 6–10 $/kontrat primi $300 ile (kademe 50%) hiç alınamadı.

## Monte Carlo (gün bloklu, 10 000 yol, OOS günleri)

| Grup | Varyant | Ufuk | Medyan | %5 | P(< 300 $) | İşlem yapamaz | Ort. işlem |
|---|---|---:|---:|---:|---:|---:|---:|
| 0DTE | birincil (1:5 / güvenli 1:2) | 20 | 300 $ | 192 $ | %33 | %100 | 0,39 |
| 0DTE | birincil | 60 | 198 $ | 138 $ | %71 | %100 | 1,13 |
| 0DTE | hedef 1:2 / 1:1,5 | 60 | 198 $ | 138 $ | %71 | %100 | 1,13 |
| 0DTE | kesirli (bilgi) | 60 | 159 $ | 91 $ | %92 | %100 | 2,43 |
| 1–3 DTE | birincil | 20 | 300 $ | 192 $ | %34 | %100 | 0,41 |
| 1–3 DTE | birincil | 60 | 220 $ | 139 $ | %72 | %100 | 1,17 |
| 1–3 DTE | hedef 1:2 / 1:1,5 | 60 | 220 $ | 139 $ | %72 | %100 | 1,17 |
| 1–3 DTE | kesirli (bilgi) | 60 | 157 $ | 91 $ | %95 | %100 | 2,93 |

**Neden hedef varyantları aynı?** OOS havuzundaki 13 işlemin hiçbiri 1,5R veya 2R'ye ulaşmadı (`trades.json`, `hit1_5 = hit2 = false`); hedefi düşürmek çıkışı değiştirmez. Havuz tüm günlerde ayrı: yalnız sinyal kaynaklarının her biri kayıp.

**MC'nin neden bilgi vermediği (küçük havuz).** Gün bloklu bootstrap aynı işlem günlerini tekrar çeker. Havuz küçük ve kazananı yoksa sonuç yalnızca kayıp/yetersiz sermaye sayımıdır. Bunu sınamak için varsayılan parametrelerle, yalnız 0DTE Q1S'in 3 işlemini (aralarında +2R'ye ulaşan GLD işlemi) 1:2 politikasıyla MC'ye koyduğumda medyan 3 548 $ çıktı (1:5 politikası: 90 $). Bu, bir kazananın aynı günden tekrar tekrar çekilip bileşmesinin yapaylığıdır, bir kenar kanıtı değildir. Pipeline'daki OOS havuzunda kazanan olmadığı için bu etki orada yok; ama aynı nedenle MC'nin medyanı ve %95'i bu n'de güvenilir değil.

**Kesirli varyant** (Kaan kuralı değil, bilgi): bütçenin tamamı kullanılıyor (yetersiz sermaye yok), ama sonuç yine kayıp ağırlıklı (medyan 91–159 $ at 60 gün) ve "işlem yapamaz" sütunu %100 (bitişte medyan dolumda tam kontrat alınamıyor). Bu varyant da karar için kullanılamaz.

## Çıkış uyarlamaları (Ayarlar, varsayılan kapalı)

"LOD/HOD kırılırsa çık" ve "5 dk EMA10 iz süren stop" yalnız uygulamada (paper motoru, `qExit`) tanımlı; backtest'te **uygulanmadı** (Kaan çıkışları aynen kuralı). Bu nedenle backtest sonucu bu iki çıkışın etkisini içermez. 0–3 DTE'de Qullamaggie'nin 3–5 gün sonra kısmi satış ve 10/20 günlük MA ile iz sürmesi uygulanamaz (günlük bar yok, yalnız 0–3 DTE vade).

## Sınırlar

1. **Örneklem:** toplam 13 OOS işlem. Hiçbir hücre istatistik için yeterli değil; "kenar yok" değil, "ölçülemedi" sonucu.
2. **Yapısal kısıt:** RS63 yüzünden 2026-02-04'e kadar Q1/Q1S yok; pencerenin yaklaşık dörtte biri kaybolur. Bu bir veri eksiği, setupın kendisi değil; 2025-11 öncesi günlük veri çekilirse düzelir.
3. **Izgara:** 5 dk değerlendirme; giriş gecikmesi ve kaçırılan kısa kırılımlar olabilir.
4. **Fiyat modeli:** `modeled` (önceki gün EOD IV ile). Gerçek gün içi kot yok (`bt:record` 2026-11-12'de başladı). Kâğıt sonuçları gerçek kotlarla karşılaştırılmadı.
5. **Gece taşıma:** modellenmedi (15:45 kapanış). 1–3 DTE'deki gap riski ve taşıma kazancı ölçülmedi.
6. **Haber/bilanço/katalizör:** yok; Q2 katalizörü ölçülmedi.
7. **Q3** deneysel; IS n = 2, OOS n = 2.

## Kaan'a sorular

1. **Q-kalite güven skoruna katılsın mı?** (WEIGHTS değişikliği; şu an bilgi amaçlı.) Bu veride Q-kalite ile sonuç arasında ilişki ölçülemedi.
2. **LOD/HOD çıkış tetiği ve 5 dk EMA10 iz süren stop açılsın mı?** Backtest bunları ölçmedi; ölçmek için çıkış modelinin backtest'e eklenmesi gerekir.
3. **Kriteri geçen Q setup'ı kâğıt işleme açılsın mı?** Bu koşuda hiçbiri geçmedi; soru şu an gereksiz, ama daha uzun veriyle tekrar sorulacak.
4. **MU/INTC sinyal listesine eklensin mi?** Uygulama listesi değişmedi (varsayılan QQQ, GLD, SLV, NVDA). Backtest'te MU/INTC ile 0 kriter geçildi; MU'da yalnız kayıp var.
5. **Daha uzun günlük geçmiş:** Q1/Q1S için RS63 hazır olması ~3 ay daha erken istenirse 2025-11 öncesi günlük D-mumları (MarketData planı/çekimi) gerekir. Kaan veri çekimini onaylarsa yapılabilir (MarketData'ya bağlanmak için onay gerekir).

## Yeniden üretim

```bash
unset MARKETDATA_TOKEN
BT_OFFLINE=1 BT_START=2025-11-14 BT_END=2026-11-11 BT_FEE=1.5 node backtest/qull.mts --out /workspace/backtest/reports/qullamaggie --n 60 --folds 5 --paths 10000
```
Ham dosyalar: `report.json`, `tables.md`, `trades.json` (her IS/OOS işlemi, R ve hedef bayrakları).
