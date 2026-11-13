# Backtest altyapısı (0DTE / kısa vade)

Uygulama kodundan bağımsız Node betikleri (`.mts`; `tsc` ve Expo paketine dahil değil, Node 24 type-stripping ile doğrudan çalışır).
Strateji mantığı uygulamayla ortak saf TS modüllerinde: `src/lib/odte/strategies/` (+ mevcut motor `src/lib/odte/signal.ts`).
Veri ve çıktılar repoda DEĞİL: `/workspace/backtest/{cache,days,snaps,reports}` (ortamla değiştirilebilir).

## Önemli gerçek: geçmiş GÜN İÇİ opsiyon verisi yok
MarketData geçmiş opsiyon verisini yalnızca **gün sonu (EOD)** olarak veriyor (`/options/chain?date=`, `/options/quotes?from&to` → günde 1 satır,
Greek/IV yok). Hisse 1 dk mumları var. Bu yüzden iki yol birlikte kullanılır:
1. **modeled** — 12+ ay geçmiş: opsiyon fiyatı önceki gün EOD IV + EOD spread ile modellenir (Amerikan, işlem-zamanı varyans saati).
2. **recorded / hybrid** — ileriye dönük: `record.mts` seans boyunca gerçek zincir anlık görüntülerini kaydeder; backtest gerçek bid/ask'la fiyatlar
   (`hybrid`: kayıt varsa gerçek, yoksa model). `validate-intraday.mts` modelin gün içi hatasını ölçer.

## Dosyalar
| Dosya | İş |
|---|---|
| `md.mts` | MarketData istemcisi: tek keep-alive soket, sıralı + aralıklı istek, disk önbelleği, kredi defteri, **bütçe koruması**, **kuru çalıştırma (tahmin)** |
| `fetch.mts` | Toplu indirme: 1 dk mumlar + günlük EOD zincirleri (BT_START/BT_END/BT_TICKERS). Kesilirse aynı komutla devam |
| `prep.mts` | Önbellekten gün kayıtları → `days/<T>.json` (OI D−1, IV/spread D−1 EOD — ileriye bakış yok) |
| `bt.mts` | Gün yükleme, gösterge ön hesabı (5 dk), modellenmiş zincir, eski motor koşucusu (`run`) + `metrics` |
| `sources.mts` | Fiyat kaynakları: `modeled`, `recorded`, `hybrid`; maliyet (komisyon/kayma/spread çarpanı) |
| `engine.mts` | Genel motor: herhangi bir `Strategy` + `QuoteSource` → işlemler; `xmetrics` (bootstrap %95 GA, günlük Sharpe) |
| `wf.mts` | Walk-forward (genişleyen pencere) + parametre örnekleme |
| `compare.mts` | Tüm stratejileri aynı veride kıyasla → `reports/<zaman>/report.{json,md}` + `reports/latest/` |
| `criteria.mts` | Aday / canlı eşikleri (docs/PLAN.md ile aynı) |
| `record.mts` | Gerçek gün içi zincir kaydı (cached mod: istek başına 1 kredi) → `snaps/<D>/<T>.jsonl` |
| `probe.mts` | Onay sonrası ilk doğrulama: gerçek zamanlılık, gecikme, cached tazeliği, gün içi geçmiş var mı (~25 kredi) |
| `validate.mts` / `validate-intraday.mts` | Model ↔ gerçek EOD / gerçek gün içi fiyat hatası |
| `optimize.mts`, `report.mts`, `worker.mts` | v1→v2 optimizasyonu (eski akış, sonuçlar `results.json` / `report.json`) |
| `selftest.mts` | Sentetik veriyle altyapı testi (`npm run bt:selftest`, veri gerekmez) |

## Akış
```bash
export MARKETDATA_TOKEN=...                  # asla dosyaya yazma / commit etme; telefonda MarketData kapalı olsun (tek cihaz kuralı)
npm run bt:probe                             # 1) gerçek zamanlı mı, gecikme, cached tazeliği (~25 kredi; seans açıkken)
BT_DRYRUN=1 BT_START=2025-11-12 npm run bt:fetch   # 2) kredi/istek tahmini (istek atmaz)
BT_START=2025-11-12 BT_MAX_CREDITS=40000 npm run bt:fetch   # 3) indir (≈0,75 sn/istek)
BT_OFFLINE=1 BT_START=2025-11-12 npm run bt:prep           # 4) gün kayıtları
npm run bt:compare -- --folds 5 --n 60       # 5) tüm stratejiler, walk-forward → /workspace/backtest/reports/latest/report.md
npm run bt:record                            # seans boyunca gerçek gün içi kayıt (box'ta nohup ile)
npm run bt:compare -- --source hybrid        # kayıtlı günlerde gerçek bid/ask ile
```
`compare.mts` seçenekleri: `--s all|id,id` · `--t SPY,QQQ` (yoksa stratejinin evreni) · `--source modeled|recorded|hybrid` · `--folds` · `--n` (katman başına parametre seti) · `--minN` · `--quick`.
Maliyet duyarlılığı: `BT_FEE` (vars. 0,65 $/kontrat/yön), `BT_SLIP` (0,01 $), `BT_SPREAD_MULT` (1). Rapor ×0 ve ×1,5 spread'i de gösterir.

## Yeni strateji eklemek
1. `src/lib/odte/strategies/<ad>.ts`: `Strategy<P>` döndür (`defaults`, `space`, `evaluate(ctx, p)` → `{dir, undTarget, undStop, maxHoldMin?}` | null).
   Yalnızca `ctx.bars` (tamamlanmış barlar), `ctx.F` (göstergeler), `ctx.day` (önceki kapanış, açılış, em0) ve `ctx.chain()` kullan — ileriye bakış yok.
2. `strategies/index.ts` içinde `STRATEGIES`'e ekle. 3. `npm test && npm run bt:selftest`. 4. `npm run bt:compare -- --s <id>`.

## Simülasyon varsayımları
- Değerlendirme 5 dk'da bir (uygulamanın yenileme aralığı), yalnızca tamamlanmış 1 dk barlarla; hisse başına aynı anda tek pozisyon, `maxPerDay`.
- Giriş: sinyalden sonraki barın açılışında ASK + $0,01; çıkış BID − $0,01; komisyon $0,65/kontrat/yön.
- Çıkış: dayanak hedef/stop (aynı barda ikisi → stop, muhafazakâr), zaman stopu (`maxHoldMin`), gün sonu (0DTE 15:30, diğer 15:45 ET).
- Göstergeler (GEX, duvarlar, em) model zincirden; OI D−1 seansından (yayın açılıştan önce).
- Eski motor ile birebir eşlik doğrulandı: `confluence-v2` (maxPerDay 99) = `bt.run(DEFAULT_OPTS)` → 290 işlem, −%4,65.

## Yardımcı semboller ve vade varyantları (2026-11-12)
- Strateji `peers: ['QQQ','SPY','SMH']` bildirirse `compare.mts` bu sembollerin 1 dk barlarını önbellekten yükler (`peers.mts`, kredi harcamaz) ve
  `ctx.peer(sym)` ile o ana kadar tamamlanmış barları verir. Önbellekte olmayan sembol: `MARKETDATA_TOKEN=$(cat ~/.secrets/marketdata_token) node backtest/peers.mts SMH` (~9 kredi/ay; önce `BT_DRYRUN=1`).
- 1–3DTE gün dosyaları: `BT_OFFLINE=1 BT_TICKERS=MU,QQQ,INTC BT_DAYS=/workspace/backtest/days-dte13 BT_MIN_DTE=1 BT_MAX_DTE=3 node backtest/prep.mts`,
  sonra `node backtest/compare.mts --t MU,QQQ,INTC --s kaan-momentum-1to3dte --days /workspace/backtest/days-dte13 --out /workspace/backtest/reports-dte13`.
- `StratEntry.strike` (hedef strike → en yakın likit kontrat) ve `StratEntry.exitCheck(bars, i)` (özel çıkış; i. bar kapanınca, i+1 açılışında).

## Anlık tavsiye (token'sız)
`npm run bt:live -- MU,QQQ,INTC` — `record.mts` çalışırken onun son zincir görüntüsünü + Yahoo 1 dk barlarını kullanır; ikinci token süreci açmaz. Kağıt işlem içindir.

## Gün tekrarı (token'sız)
`npm run bt:replay -- MU,QQQ,INTC,AAOI,AXTI,AMD,NBIS` — bugünün Yahoo 1 dk barları + önceki günün önbellekteki EOD zinciri (+ varsa kayıtlı kotlar) ile confluence-v2 ve kaan-momentum (katı/gevşek, 0DTE/1–3DTE) dakika dakika; kapanış seviyeleri ve yarın kurulumu. `BT_OUT=dosya.md` ile kaydeder. `BT_STEP` (bt.mts) varsayılan 5 dk.
