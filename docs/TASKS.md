# Görev panosu (Grok ⇄ Claude)

Kurallar: `AGENTS.md` §9. Bir görevi alırken `Sahip` = Grok/Claude, `Durum` = doing; bitince done + `CHANGELOG.md` notu.
`Kaan` = kullanıcı kararı/eylemi gerekir. `API` = MarketData onayı gerekir (onaydan önce yapılamaz). Öncelik: P1 > P2 > P3.

## Açık
| # | Görev | Sahip | Durum | Öncelik | Not |
|---|---|---|---|---|---|
| 1 | Onay günü doğrulama: `npm run bt:probe` (seans açıkken), sonucu CHANGELOG'a | Grok | todo | P1 · API | PLAN Adım 1; telefonda MarketData kapalı olmalı |
| 2 | 12–24 ay geçmiş indirme (`bt:fetch`, önce `BT_DRYRUN=1`) + `bt:prep` + `validate.mts` | Grok | todo | P1 · API | ~7k (12 ay) / ~14k (24 ay) kredi, gece çalıştır |
| 3 | Her seans gün içi kayıt (`bt:record`), haftalık `validate-intraday.mts` | Grok | todo | P1 · API | box'ta nohup; tek cihaz kuralı |
| 4 | Gerçek veriyle tüm stratejileri karşılaştır (`bt:compare --folds 5 --n 60`), sonucu Kaan'a özetle | Grok | todo | P1 · API | PLAN Adım 4–6 |
| 5 | Bağımsız göz: backtest motoru ileriye-bakış / hayatta kalma yanlılığı denetimi (`backtest/engine.mts`, `sources.mts`, `bt.mts`, stratejiler) | Claude | todo | P1 | Bulguları CHANGELOG'a; düzeltme küçükse doğrudan |
| 6 | Uygulama: Ayarlar'a "MarketData zincir modu: canlı / cached (≈1 kredi/istek)" seçeneği; `scan.ts` → `loadChain(..., { mdMode })` | Claude | todo | P2 | `ProvOpts.mdMode` hazır; probe sonrası varsayılan seçilecek |
| 7 | Uygulama: 0DTE kredi tahmini metnini güncelle (mumlar artık Yahoo'dan, MarketData'da yalnızca kot+vade+zincir; cached modda ≈3/sembol) | Claude | todo | P2 | `Odte.tsx` `creditsPerRefresh` |
| 8 | Sinyal ve günlük kaydına `strategyId` alanı; Geçmiş'te strateji bazlı kâğıt işlem özeti (n, kazanma, beklenti, PF) | Claude | todo | P2 | PLAN Adım 7 için gerekli; mevcut kayıtlarla geriye uyumlu |
| 9 | 0DTE ekranında strateji seçimi ("Deneysel"): `src/lib/odte/strategies` modüllerini çalıştırabilme (varsayılan: mevcut motor) | Claude | todo | P3 | ADAY strateji çıkınca P1 olur |
| 10 | Yeni strateji fikirleri (modül + birim test): VWAP bantları (σ) dönüşü, gap fill, ilk saat aralık genişlemesi, Kaan'ın kendi giriş kuralları | herkes | todo | P3 | `backtest/README.md` "Yeni strateji" |
| 11 | `compare.mts` için worker-thread paralelliği (24 ay × 19 sembol yavaşlarsa) | herkes | todo | P3 | `optimize.mts` işçi havuzu örnek |
| 12 | Sunucu tarafı tarayıcı iskeleti (`server/`): tek MarketData tüketicisi + Telegram/ntfy bildirimi | Claude | todo | P3 | PLAN Adım 9; önce Kaan bildirim kanalını seçsin |
| 13 | Özel GitHub deposu açıp `origin` ekle, iki ajana erişim ver | Kaan | todo | P1 | AGENTS.md §10 — ajanlar oluşturmaz |
| 14 | Karar: Apple Developer hesabı (99 $/yıl) → dev build + Expo push? Yoksa Telegram/ntfy | Kaan | todo | P3 | PLAN Adım 9 |

## Bitti
| # | Görev | Sahip | Tarih |
|---|---|---|---|
| D1 | Takılabilir strateji arayüzü + 5 aday strateji + zaman filtresi sarmalayıcı | Grok | 2026-11-12 |
| D2 | Genel backtest motoru, fiyat kaynakları (modeled/recorded/hybrid), walk-forward, metrikler (bootstrap GA), JSON+MD rapor | Grok | 2026-11-12 |
| D3 | MarketData istemcisi: bütçe koruması, kuru çalıştırma, canlı istekler için önbelleksiz mod; `record.mts`, `probe.mts`, `validate-intraday.mts` | Grok | 2026-11-12 |
| D4 | Uygulama: 1 dk barlar önce Yahoo (MarketData candles gerçek zamanlı değil), `ProvOpts.mdMode` | Grok | 2026-11-12 |
| D5 | `docs/PLAN.md`, `AGENTS.md`, `CLAUDE.md`, bu pano, `CHANGELOG.md` | Grok | 2026-11-12 |
| 19 | Radar (Aşama A–E): olasılık motoru, 11 dedektör, haber katmanı, uyarı motoru, Radar sekmesi, isabet takibi. Aşama F (sunucu) Kaan onayı bekliyor | Claude | 2026-11-13 |
