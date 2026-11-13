# Görev panosu (Grok ⇄ Claude)

Kurallar: `AGENTS.md` §9. Bir görevi alırken `Sahip` = Grok/Claude, `Durum` = doing; bitince done + `CHANGELOG.md` notu.
`Kaan` = kullanıcı kararı/eylemi gerekir. `API` = MarketData onayı gerekir (onaydan önce yapılamaz). Öncelik: P1 > P2 > P3.

## Açık
| # | Görev | Sahip | Durum | Öncelik | Not |
|---|---|---|---|---|---|
| 1 | Onay günü doğrulama: `npm run bt:probe` (seans açıkken), sonucu CHANGELOG'a | Grok | done | P1 · API | 12.11 17:30 TR: opsiyon zinciri gerçek zamanlı (yaş 1 sn), hisse kotu 903 sn gecikmeli → #15 |
| 2 | 12–24 ay geçmiş indirme (`bt:fetch`, önce `BT_DRYRUN=1`) + `bt:prep` + `validate.mts` | Grok | doing | P1 · API | MU/QQQ/INTC 12 ay tamam (249/249/248 gün). Diğer 16 sembolde zincirler yalnız ~Oca–Kas 2026 (eksik) → Kaan isterse tamamla |
| 3 | Her seans gün içi kayıt (`bt:record`), haftalık `validate-intraday.mts` | Grok | doing | P1 · API | 12.11: MU,QQQ,INTC cached/2 dk kayıt başladı (`snaps/2026-11-12`). Her seans yeniden başlatılmalı (rutin yok) |
| 4 | Gerçek veriyle tüm stratejileri karşılaştır (`bt:compare --folds 5 --n 60`), sonucu Kaan'a özetle | Grok | done | P1 · API | MU/QQQ/INTC 12 ay, modellenmiş: hepsi RED → `docs/reports/2026-11-12-MU-QQQ-INTC-12m.md`. Gerçek gün içi kotlarla (hybrid) tekrar: #17 |
| 5 | Bağımsız göz: backtest motoru ileriye-bakış / hayatta kalma yanlılığı denetimi (`backtest/engine.mts`, `sources.mts`, `bt.mts`, stratejiler) | Claude | todo | P1 | Bulguları CHANGELOG'a; düzeltme küçükse doğrudan |
| 6 | Uygulama: Ayarlar'a "MarketData zincir modu: canlı / cached (≈1 kredi/istek)" seçeneği; `scan.ts` → `loadChain(..., { mdMode })` | Claude | todo | P2 | `ProvOpts.mdMode` hazır; probe sonrası varsayılan seçilecek |
| 7 | Uygulama: 0DTE kredi tahmini metnini güncelle (mumlar artık Yahoo'dan, MarketData'da yalnızca kot+vade+zincir; cached modda ≈3/sembol) | Claude | todo | P2 | `Odte.tsx` `creditsPerRefresh` |
| 8 | Sinyal ve günlük kaydına `strategyId` alanı; Geçmiş'te strateji bazlı kâğıt işlem özeti (n, kazanma, beklenti, PF) | Claude | todo | P2 | PLAN Adım 7 için gerekli; mevcut kayıtlarla geriye uyumlu |
| 9 | 0DTE ekranında strateji seçimi ("Deneysel"): `src/lib/odte/strategies` modüllerini çalıştırabilme (varsayılan: mevcut motor) | Claude | todo | P3 | ADAY strateji çıkınca P1 olur |
| 10 | Yeni strateji fikirleri (modül + birim test): VWAP bantları (σ) dönüşü, gap fill, ilk saat aralık genişlemesi | herkes | todo | P3 | `kaan-momentum` eklendi (D6); `backtest/README.md` "Yeni strateji" |
| 11 | `compare.mts` için worker-thread paralelliği (24 ay × 19 sembol yavaşlarsa) | herkes | todo | P3 | `optimize.mts` işçi havuzu örnek |
| 12 | Sunucu tarafı tarayıcı iskeleti (`server/`): tek MarketData tüketicisi + Telegram/ntfy bildirimi | Claude | todo | P3 | PLAN Adım 9; önce Kaan bildirim kanalını seçsin |
| 13 | GitHub deposu https://github.com/KaanErturkuner/OptionCalc (doğruluk kaynağı) — box'un push erişimi yok; Grok yerel commit + değişen dosya listesi verir, Kaan senkronlar | Kaan | doing | P1 | AGENTS.md §10 — ajanlar remote oluşturmaz |
| 14 | Karar: Apple Developer hesabı (99 $/yıl) → dev build + Expo push? Yoksa Telegram/ntfy | Kaan | todo | P3 | PLAN Adım 9 |
| 15 | MarketData hesabında hisse/ETF gerçek zamanlı yetkisini kontrol et (probe: hisse kotu 903 sn = 15 dk gecikmeli; opsiyonlar canlı) | Kaan | todo | P1 | Uygulama hisse fiyatını zaten Yahoo'dan alıyor; sinyal için önemli değil ama ücretli planda beklenmez |
| 16 | Kalıcı tarayıcı/kayıt için sabit IP'li sunucu (box'un IPv6 çıkışı her bağlantıda değişiyor → MarketData "tek cihaz" 403/5 dk blok) | Kaan | todo | P2 | PLAN Adım 9 ile birleşir |
| 17 | 10–20 seans kayıt birikince `validate-intraday.mts` + `bt:compare --source hybrid` (MU/QQQ/INTC, kaan-momentum dahil) | Grok | todo | P1 · API | Modellenmiş OTM 0DTE fiyatı en zayıf halka |
| 18 | `kaan-momentum` gözden geçirme: Kaan kuralları eşleşiyor mu (OTM kalibrasyonu, ters mum tanımı, 09:45 başlangıç) | Kaan | todo | P2 | `src/lib/odte/strategies/kaanMomentum.ts` başındaki açıklama |
| 19 | **Radar** — Aşama A–E uygulandı (Claude, 2026-11-13; bkz. Bitti). Açık kalanlar: SEC User-Agent e-postası (Kaan), bilanço dedektörü veri kaynağı, Expo Go görsel test, eşik kalibrasyonu (4–6 hafta veri), Aşama F sunucu | Claude | doing | P2 | `docs/tasks/RADAR.md`; F için Kaan onayı |
| 20 | SINYAL-FIRSAT Aşama 0: port edilen dosyaları bağla (kaanMomentum, bt:live, bt:replay, peers, engine `pickStrike`/`exitCheck`), `npm run check` | Claude | done | P1 | `docs/tasks/SINYAL-FIRSAT.md` §3 — Başkan dosyaları repoya koyar; bitince dur |
| 21 | SINYAL-FIRSAT Aşama 1: "Sinyal tickerları" ayarı (vars. QQQ, GLD, SLV, NVDA), ticker profilleri, tarama döngüsü + paylaşılan önbellek, `notifyFirsat`, Seans modu | Claude | done | P1 | §4 |
| 22 | SINYAL-FIRSAT Aşama 2: Güven Skoru 0–100 (A1–H, vetolar, gecikme tavanı), sinyal kaydı + sonuç değerlendirme, kalibrasyon ekranı, doğrulama kapısı | Claude | doing | P1 | Aşama 2 çekirdek (skor, veto, kayıt, sonuç) bitti; kalibrasyon ekranı, canlı bağlama (Aşama 3 setup'ları) ve CSV açık §5 |
| 23 | SINYAL-FIRSAT Aşama 3: Fırsat setupları S1–S6 + prim bazlı RR (`optionRR`, Amerikan fiyatlayıcı) + strike tarayıcı | Claude/Grok | done | P1 | §6 — Claude yazdı; Grok doğruladı ve zaman/uyum hatalarını düzeltti (2026-11-13). Bitince dur, Başkan bakar |
| 24 | SINYAL-FIRSAT Aşama 4: kâğıt hesap durum makinesi (Agresif 1:5 / Yedek 1:4 / Güvenli / Durdu), %50→40→30 kademe (%50 azami, Kaan kararı, değişmez), risk izleyici T1–T7, maliyet modeli | Claude | done | P1 | §7 — `src/lib/paper/*`, `riskwatch.ts`, `test/paper.test.ts` (143 kontrol); Başkan incelemesi bekliyor (handoff asama-4) |
| 25 | SINYAL-FIRSAT Aşama 5: Fırsat sekmesi (hesap şeridi, kartlar, skor dökümü, özsermaye eğrisi, isabet, kayıt, ayarlar) | Claude | done | P1 | §8 — ekran + tarama bağlama yazıldı, görsel test yapılmadı; eksikler (T4/T5/T7, haber, RS, grafik, CSV) handoff asama-5'te. Başkan incelemesi bekliyor |
| 26 | SINYAL-FIRSAT Aşama 6: setup backtest (walk-forward, QQQ/GLD/SLV/NVDA) + para yönetimi Monte Carlo + iflas raporu (bilgi amaçlı) + `FIRSAT_CRITERIA` | Claude | todo | P1 · API | §9 — GLD/SLV/NVDA geçmişi ve kayıt için Kaan onayı (token); bitince dur |
| 27 | SINYAL-FIRSAT Aşama 7: sunucu tarayıcı + anlık bildirim (Telegram/ntfy/Expo push), tek MarketData tüketicisi | Claude | blocked | P3 | §10 — Kaan onayı olmadan başlanmaz (otomasyon); #12, #14, #16 ile birleşir |
| 28 | SINYAL-FIRSAT §11.2 açık sorular: DURDU kuralı, kış saatinde giriş penceresi kayması, 1 kontrat / kesirli kâğıt simülasyonu, NBIS/GLW sektörü (SMH mi QQQ mu) | Kaan | todo | P2 | Claude varsayılanla uygular (§11.2); Kaan'ın 2026-11-13 cevapları D8'de. Aşama 4 ek çelişki: ör.3 (iki kayıp) ↔ gün içi %50 DURDU (%51) — handoff asama-4 madde 1 |

## Bitti
| # | Görev | Sahip | Tarih |
|---|---|---|---|
| D1 | Takılabilir strateji arayüzü + 5 aday strateji + zaman filtresi sarmalayıcı | Grok | 2026-11-12 |
| D2 | Genel backtest motoru, fiyat kaynakları (modeled/recorded/hybrid), walk-forward, metrikler (bootstrap GA), JSON+MD rapor | Grok | 2026-11-12 |
| D3 | MarketData istemcisi: bütçe koruması, kuru çalıştırma, canlı istekler için önbelleksiz mod; `record.mts`, `probe.mts`, `validate-intraday.mts` | Grok | 2026-11-12 |
| D4 | Uygulama: 1 dk barlar önce Yahoo (MarketData candles gerçek zamanlı değil), `ProvOpts.mdMode` | Grok | 2026-11-12 |
| D5 | `docs/PLAN.md`, `AGENTS.md`, `CLAUDE.md`, bu pano, `CHANGELOG.md` | Grok | 2026-11-12 |
| D6 | `kaan-momentum` stratejisi (rejim QQQ/SPY + sektör SMH + kırılım/hacim, OTM, ters mum çıkışı; 0DTE ve 1–3DTE) + motor: `pickStrike`, `exitCheck`, yardımcı semboller (`backtest/peers.mts`) | Grok | 2026-11-12 |
| 19 | Radar (Aşama A–E): olasılık motoru, 10 dedektör, haber katmanı, uyarı motoru, Radar sekmesi, isabet takibi. Açık işler #19 satırında; Aşama F (sunucu) Kaan onayı bekliyor | Claude | 2026-11-13 |
| D7 | Box'taki kaan-momentum / bt:live / bt:replay / 12 Kasım raporları GitHub sürümüne port edilmeye hazır (tsc + npm test + bt:selftest + eslint geçti); SINYAL-FIRSAT görev tanımı | Grok | 2026-11-13 |
| D8 | Kaan SINYAL-FIRSAT varsayımlarını cevapladı (§11.1): kademe adım adım 30→40→50, kademe güne taşınır, kâğıt giriş yalnız "Onayla" ile (süre dolumu), 1–3 DTE gece taşınabilir (gap yönetimi), prim stopu %67, NVDA/GLD/SLV OTM uzaklığı oynaklıktan (oto k), Midas komisyonu 1,50 $ açılış+kapanış | Kaan/Grok | 2026-11-13 |
| D9 | SINYAL-FIRSAT Aşama 3 doğrulama: `session.ts` (T0 işlem dakikası, hafta sonu/tatil, kalan EM ölçeği), QQQ kendi-bar uyumu, `setups.test.ts` import düzeni, hata durumunda boş `setups`; TASKS #23 done | Grok | 2026-11-13 |
| D10 | Kaan onayladı (2026-11-13): 1:N = çıkış/giriş prim çarpanı (K8; 150 → 750 = 1:5, zarar 150 → 50); DURDU kuralı varsayılan kapalı (K9). Uygulandı: `rr.ts`, `account.ts`, §6.1/§7.4/§11.1 | Kaan/Claude | 2026-11-13 |
