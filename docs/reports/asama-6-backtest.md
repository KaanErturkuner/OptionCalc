# Aşama 6 — Fırsat setupları: backtest, kâğıt hesap replay'i ve Monte Carlo

Tarih: 2026-11-13 · Veri: yalnız çevrimdışı önbellek (MarketData'ya bağlanılmadı, `MARKETDATA_TOKEN` yoktu) · Komut: `BT_OFFLINE=1 BT_START=2025-11-14 BT_END=2026-11-11 BT_FEE=1.5 node backtest/firsat.mts --n 60 --folds 5 --paths 10000` (88 sn)

## Sonuç (5 satır)

1. **Hiçbir setup × ticker × grup kriteri geçmedi** (`GEÇTİ` yok). 5 hücre `KALDI`; geri kalanlar OOS n < 20 olduğu için `YETERSİZ VERİ`. Kriter: n ≥ 60, beklenti ≥ 0,15R, PF ≥ 1,3, GA alt sınırı > 0, spread×1,5'te beklenti > 0.
2. **OOS ortalama R tüm ticker ve grupta negatif** (0DTE −0,42R, 1–3 DTE −0,23R). 1:5 hedefine 0DTE'de 175 işlemin 3'ünde, 1–3 DTE'de 143 işlemin hiçbirinde ulaşıldı.
3. **$300 ile kâğıt replay:** 0DTE tümü 300 → 50 $ (−%83); 1–3 DTE tümü 300 → 116 $ (−%61). Tam kontrat ve %50 kademe bütçesiyle sinyallerin çoğu alınamadı (0DTE 25/175, 1–3 DTE 23/143; geri kalanı "sermaye yetmiyor").
4. **Monte Carlo (10 000 yol, OOS günleri):** birincil politikada 60 gün medyan 80 $ (0DTE) / 147 $ (1–3 DTE); P(< 300 $) %99'un üzerinde. Tanıma göre iflas (< %10) %0 çıktı, ama 60 gün sonunda hesabın **işlem yapamaz** hâle gelme olasılığı (%50 kademeyle medyan dolumda 1 kontrat alınamıyor) 0DTE'de %92, 1–3 DTE'de %99,5. Hedefi 1:2 veya 1:1,5'e indirmek sonucu iyileştirmiyor (bkz. MC tablosu). Kesirli kontrat (bilgi amaçlı) varyantında 60 gün iflas %52–99.
5. **Karar:** kâğıt işlem için ADAY yok, "Güvenilir ✓" rozeti yok. Bu sonuç, mevcut setup tanımlarının bu veride kârlı olmadığını gösteriyor; Kaan'ın para yönetimi kuralları kötü bir sinyal setiyle kârlı bir hesap üretemez. S4–S6 veri eksikliği nedeniyle test edilmedi.

## Ne test edildi

- **Setuplar:** `firsat-s1…s6` (`src/lib/odte/strategies/firsat.ts`). S4 (duvar), S5 (haber), S6 (IV rank) bu sarmalayıcıda veri olmadığı için **hiç işlem üretmiyor**; sonuçları "test edilmedi" olarak okunmalı.
- **Veri:** QQQ, GLD, SLV, NVDA; 0DTE (`days/`, 987 hisse-gün) ve 1–3 DTE (`days-dte13/`, 937 hisse-gün). Fiyatlar önceki gün EOD IV ile modellendi (`--source modeled`); gerçek gün içi kot yok. Yardımcı semboller önbellekten (SPY, SMH, UUP, TLT, GDX, SIL, QQQ, GLD); ^VIX için 1 dk veri yok, günlük Yahoo kapanışı kullanıldı.
- **Walk-forward:** 5 kat, 60 parametre seti, eğitim = ilk %40 (seçim), test = sonraki görülmemiş dönem. IS ve OOS ayrı raporlandı.
- **Maliyet:** komisyon $1,50/kontrat/yön (Midas), kayma $0,01, spread ×1 (ve ×1,5 kontrolü).
- **R tanımı (D13(1)):** 1R = giriş × 0,67 (prim stopu %67). 1:5 = giriş + 5R (150 giriş / 50 stop / 650 hedef). R **brüt** ölçülür; komisyon yalnız P&L'den düşülür.
- **Para yönetimi (replay ve MC):** $300 başlangıç, kademe 50/40/30 (kazanç +1 adım, kayıp −1 adım, azami %50), tek açık pozisyon, DURDU açık, 2 ardışık kayıp → güvenli mod (1:2), güvenli modda 2 kayıp daha → o gün DURDU (D13(2), `test/paper-path.test.ts` ile doğrulandı), 4 ardışık kazanç → 1:2 modu.
- **Gece taşıma kapısı (1–3 DTE):** Motor gün içi kapanış simüle eder; gece taşıma modellenmedi. Kapı yalnız bilgi amaçlı sayım (bkz. aşağı).

## Ticker × grup (OOS, replay $300)

| Grup | Ticker | Sinyal n | Kazanma (R>0) | Ort. R | PF(R) | GA alt (R) | Spread×1,5 R | Alınan | Yetersiz sermaye | Nihai | Maks. düşüş | Getiri |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0DTE | QQQ | 44 | 6,8% | −0,48 | 0,28 | −0,71 | −0,50 | 8 | 36 | 167 $ | 291 $ | −%44 |
| 0DTE | GLD | 50 | 10,0% | −0,41 | 0,18 | −0,56 | −0,45 | 6 | 44 | 114 $ | 186 $ | −%62 |
| 0DTE | SLV | 52 | 5,8% | −0,37 | 0,30 | −0,58 | −0,40 | 14 | 36 | 52 $ | 248 $ | −%83 |
| 0DTE | NVDA | 29 | 10,3% | −0,41 | 0,33 | −0,71 | −0,43 | 13 | 16 | 96 $ | 383 $ | −%68 |
| **0DTE** | **Tümü** | **175** | **8,0%** | **−0,42** | **0,27** | **−0,54** | **−0,44** | **25** | **139** | **50 $** | **405 $** | **−%83** |
| 1–3 DTE | QQQ | 30 | 16,7% | −0,12 | 0,54 | −0,27 | −0,13 | 2 | 28 | 401 $ | 44 $ | +%34 |
| 1–3 DTE | GLD | 47 | 8,5% | −0,30 | 0,08 | −0,35 | −0,33 | 3 | 44 | 232 $ | 68 $ | −%23 |
| 1–3 DTE | SLV | 44 | 2,3% | −0,28 | 0,19 | −0,37 | −0,31 | 16 | 26 | 108 $ | 192 $ | −%64 |
| 1–3 DTE | NVDA | 22 | 18,2% | −0,16 | 0,50 | −0,37 | −0,18 | 6 | 16 | 205 $ | 95 $ | −%32 |
| **1–3 DTE** | **Tümü** | **143** | **9,8%** | **−0,23** | **0,26** | **−0,29** | **−0,26** | **23** | **116** | **116 $** | **329 $** | **−%61** |

Not: QQQ 1–3 DTE'nin +%34'ü yalnız 2 işleme dayanıyor; anlamlı değil. "Alınan" ticker satırlarında her ticker kendi başına, "Tümü" satırında ortak hesapta oynanır (toplamlar eşit değildir).

## IS (seçim dönemi) vs OOS — $300 replay, aynı para yönetimi

IS = walk-forward'ın ilk %40'ı (varsayılan parametreler); OOS = görülmemiş test katları. Her ticker kendi hesabında; "Tümü" ortak hesap.

| Grup | Ticker | IS n | IS kazanma | IS ort. R | IS nihai | IS maks. düşüş | OOS n | OOS kazanma | OOS ort. R | OOS nihai | OOS maks. düşüş |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0DTE | QQQ | 16 | %6,3 | −0,65 | 213 $ | 113 $ | 44 | %6,8 | −0,48 | 167 $ | 291 $ |
| 0DTE | GLD | 29 | %17,2 | −0,11 | 228 $ | 280 $ | 50 | %10,0 | −0,41 | 114 $ | 186 $ |
| 0DTE | SLV | 53 | %13,2 | −0,28 | 70 $ | 230 $ | 52 | %5,8 | −0,37 | 52 $ | 248 $ |
| 0DTE | NVDA | 21 | %9,5 | −0,20 | 155 $ | 494 $ | 29 | %10,3 | −0,41 | 96 $ | 383 $ |
| **0DTE** | **Tümü** | **119** | **%12,6** | **−0,27** | **70 $** | **508 $** | **175** | **%8,0** | **−0,42** | **50 $** | **405 $** |
| 1–3 DTE | QQQ | 18 | %16,7 | −0,15 | 300 $ (0 işlem) | 0 $ | 30 | %16,7 | −0,12 | 401 $ | 44 $ |
| 1–3 DTE | GLD | 36 | %13,9 | −0,16 | 250 $ | 50 $ | 47 | %8,5 | −0,30 | 232 $ | 68 $ |
| 1–3 DTE | SLV | 60 | %15,0 | −0,11 | 143 $ | 157 $ | 44 | %2,3 | −0,28 | 108 $ | 192 $ |
| 1–3 DTE | NVDA | 19 | %15,8 | −0,19 | 249 $ | 51 $ | 22 | %18,2 | −0,16 | 205 $ | 95 $ |
| **1–3 DTE** | **Tümü** | **133** | **%15,0** | **−0,14** | **143 $** | **157 $** | **143** | **%9,8** | **−0,23** | **116 $** | **329 $** |

IS de negatif: sorun aşırı uyum değil, setup tanımları seçim döneminde de kâr üretmiyor.

## Setup × ticker kriter kapısı (özet)

| Grup | GEÇTİ | KALDI | YETERSİZ VERİ (S1–S3) | S4–S6 (veri yok, işlem üretmedi) |
|---|---:|---:|---:|---:|
| 0DTE | 0 | 3 | 9 | 12 hücre |
| 1–3 DTE | 0 | 2 | 10 | 12 hücre |

S4–S6 hücreleri tabloda "YETERSİZ VERİ" olarak görünür ama bu, sonucun değil veri eksikliğinin işaretidir. Tam hücre tablosu: `docs/reports/asama-6-tablolar.md`. En büyük hücre OOS n'i 27; kriter n ≥ 60 olduğu için bu hücrelerin hiçbiri bu veriyle "GEÇTİ" olamaz.

## Monte Carlo (gün bloklu, OOS günleri, 10 000 yol, tohum 20261113)

| Grup | Varyant | Ufuk | Medyan | %5 | %95 | P(< 300 $) | İflas (< %10) | Ort. işlem / yol | Yetersiz sermaye / yol |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 0DTE | birincil (1:5 / güvenli 1:2) | 20 gün | 132 $ | 86 $ | 279 $ | %95,8 | %0,0 | 7,3 | 12,1 |
| 0DTE | birincil | 60 gün | 80 $ | 47 $ | 162 $ | %99,3 | %0,0 | 13,5 | 49,3 |
| 0DTE | yedek 1:4 | 60 gün | 79 $ | 47 $ | 146 $ | %99,7 | %0,0 | 13,1 | 49,9 |
| 0DTE | kesirli (bilgi) | 60 gün | 28 $ | 24 $ | 30 $ | %99,9 | %98,5 | 21,1 | 0 |
| 1–3 DTE | birincil | 20 gün | 204 $ | 157 $ | 296 $ | %95,4 | %0,0 | 5,3 | 13,2 |
| 1–3 DTE | birincil | 60 gün | 147 $ | 113 $ | 213 $ | %99,5 | %0,0 | 10,7 | 46,1 |
| 1–3 DTE | kesirli (bilgi) | 60 gün | 30 $ | 27 $ | 95 $ | %99,9 | %52,5 | 35,7 | 0 |

**Hedef başına (60 gün, işlem yapamaz = bitişte %50 kademeyle medyan dolumda 1 kontrat alınamıyor):**

| Grup | Hedef | Medyan | %5 | %95 | P(< 300 $) | İflas (< %10) | İşlem yapamaz |
|---|---|---:|---:|---:|---:|---:|---:|
| 0DTE | 1:5 (güvenli 1:2) | 80 $ | 47 $ | 162 $ | %99,3 | %0 | %92,4 |
| 0DTE | 1:4 (güvenli 1:2) | 79 $ | 47 $ | 146 $ | %99,7 | %0 | %94,9 |
| 0DTE | 1:2 sabit | 77 $ | 47 $ | 118 $ | %100 | %0 | %99,0 |
| 0DTE | 1:1,5 sabit | 75 $ | 46 $ | 110 $ | %100 | %0 | %99,7 |
| 1–3 DTE | 1:5 (güvenli 1:2) | 147 $ | 113 $ | 213 $ | %99,5 | %0 | %99,5 |
| 1–3 DTE | 1:4 (güvenli 1:2) | 147 $ | 113 $ | 213 $ | %99,5 | %0 | %99,5 |
| 1–3 DTE | 1:2 sabit | 146 $ | 113 $ | 199 $ | %99,9 | %0 | %99,9 |
| 1–3 DTE | 1:1,5 sabit | 144 $ | 113 $ | 189 $ | %100 | %0 | %100 |

"İşlem yapamaz" sütunu ve 1:2 / 1:1,5 sabit varyantları Başkan (Grok) eki; 20 gün değerleri `asama-6-tablolar.md`'de.

- "birincil" = AGRESIF 1:5, güvenli modlarda 1:2. "yedek 1:4" = AGRESIF 1:4. "DURDU kapalı" varyantı birincil ile birebir aynı çıktı: DURDU hiçbir koşuda işlemi engellemedi. Kesirli varyant Kaan kuralı değil, karşılaştırma.
- 1–3 DTE'de yedek 1:4 ile 1:5 sonuçları birebir aynı: hiçbir OOS işlemi 4R'ye ulaşmadı (hit4 = 0), dolayısıyla hedef seviyesi bu veride fark yaratmadı.
- Tam varyant ve ufuk tabloları: `docs/reports/asama-6-tablolar.md`.

## Gece taşıma kapısı (1–3 DTE, bilgi amaçlı)

| Ticker | OOS işlem günü | Kapıdan geçen | Bilanço durumu |
|---|---:|---:|---|
| QQQ | 28 | 0 | ETF (bilanço yok) |
| GLD | 38 | 0 | ETF |
| SLV | 36 | 2 | ETF |
| NVDA | 22 | 0 | bilinmiyor → taşıma yok |

Kapı, takvim tablosunun kapsamı nedeniyle düşük sayıyor: CPI/NFP tablosu 2026-11'den başlıyor, bu yüzden 2025-11…2026-10 günleri "takvim kapsamıyor" sayılıyor (güvenli taraf: taşıma yok). Sayı yalnız "gece taşınsaydı kaç gün uygun olurdu" sorusunun alt sınırı olarak okunmalı.

## Sınırlar ve açık noktalar

1. **Örneklem küçük.** 0DTE'de 175, 1–3 DTE'de 143 OOS sinyal; bunların yalnız 25 ve 23'ü, $300 ile tam kontrat kuralıyla alınabildi. Setup × ticker hücrelerinde n en fazla 27.
2. **Monte Carlo iflas tanımı yanıltıcı olabilir.** Spec tanımı (sermaye < başlangıcın %10'u) kullanıldı. Sermaye $80'e düşüp 1 kontratı alamadığında hesap yalnız durur; bu tanımda iflas sayılmaz. Bu yüzden "%0 iflas" iyi bir haber değildir: birincil varyantta medyan sermaye başlangıcın altında ve yol başına 46–49 sinyal "yetersiz sermaye" nedeniyle atlanıyor.
3. **Gece taşıma modellenmedi.** 1–3 DTE işlemler gün içinde kapanmış sayıldı (15:45 kuralına eşdeğer). Gap riski ve taşıma kazancı bu koşuda yok.
4. **S4, S5, S6 test edilmedi** (duvar, haber, IV rank verisi bu sarmalayıcıda yok).
5. **NVDA bilanço tarihleri eksik.** Finnhub `calendar/earnings` uç noktası bu anahtar/planla yalnız gelecek tarihi (2026-11-17) döndürdü; geçmiş tarihler alınamadı. `backtest/aux/earnings-NVDA.json` `complete: false` olarak kaydedildi; kapı NVDA'yı "bilinmiyor" sayıyor. Geçmiş tarihleri eksiksiz almak için Finnhub planı veya başka bir kaynak gerekir.
6. **Modelleme:** fiyatlar EOD IV ile modellendi; gerçek gün içi kot yok (`bt:record` kaydı 2026-11-12'de başladı, TASKS #3). Kâğıt sonuçları gerçek kotlarla karşılaştırılmadı.
7. **Yardımcı veri:** ^VIX günlük (1 dk yok). Setup'lar VIX kullanmıyor; yalnız yardımcı kapsam olarak yükleniyor.

8. **Para yönetimi modelinde eksikler (Başkan doğrulaması):** kademe 50/40/30 (güne taşınır), 1:5 brüt hedef, %67 prim stopu, $1,50/kontrat/yön, 4 kazanç → 1:2 modu, 2 kayıp → güvenli, güvenli modda 2 kayıp → DURDU replay'de doğru çalışıyor (sentetik dizilerle sınandı). Modellenmeyenler: 1:4'ün "1:5 yoksa yedek sinyal" seçimi (yalnız ayrı varyant), güvenli modda 1:1,5 (yalnız 1:2), risk tetikleri T1–T7 ve iz süren stop, skor kapısı ve manuel onay gecikmesi. Prim stopu 0,67 ile uygulandığı için 150 girişte stop 49,5 $, 1:5 hedefi 652,5 $ (Kaan örneği 50 / 650; fark ihmal edilebilir).

## Bu koşuda bulunan ve düzeltilen hatalar

- **Zincir önbelleği karışması (1–3 DTE):** `backtest/sources.mts` (modeled ve recorded) ve `backtest/bt.mts` (`snapFor`) önbellek anahtarında son kullanım tarihi (E) yoktu; aynı ticker+gün için 0DTE zinciri 1–3 DTE koşusuna sızıyordu. Anahtara E eklendi. Düzeltmeden önceki 1–3 DTE OOS sayıları (137) yanlıştı; düzeltilmiş değer 143. 0DTE sonuçları etkilenmemişti (0DTE önce hesaplandı).
- **Yol simülasyonunda performans:** `closePosition` her işlemde 500 elemanlık işlem dizisini kopyalıyordu; yol MC'si için `runTrades` yalnız son işlemi tutuyor (sonuç değişmez; aynı duman koşusu 495 sn'den 49 sn'ye indi).
- **Bilanço kapısı:** NVDA için hep `bilinmiyor` dönüyordu; artık `complete: true` olmadan tarih sorgulanmıyor.

## Yeniden üretim

```bash
unset MARKETDATA_TOKEN
BT_OFFLINE=1 BT_START=2025-11-14 BT_END=2026-11-11 BT_FEE=1.5 node backtest/firsat.mts --out /workspace/backtest/reports/asama-6 --n 60 --folds 5 --paths 10000
```

Ham çıktı (`report.json`, `runs.json`, `tables.md`) `/workspace/backtest/reports/asama-6/` altında; veri klasörü git'te değil.
