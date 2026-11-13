# SINYAL-FIRSAT — Aşama 0 devir notu (Claude, 2026-11-13)

**Yapılan**
- Grok'un 21 dosyası (kaanMomentum, types/util/index, backtest engine/bt/compare/prep/validate/peers/live/replay, replay.defaults.env, test/run.ts, README, docs/tasks, docs/reports) ana repoya kopyalandı; her biri kaynakla birebir karşılaştırıldı.
- `package.json`: yalnız `bt:live` ve `bt:replay` eklendi; diğer betikler ve bağımlılıklar olduğu gibi.
- TASKS #20 done; CHANGELOG kaydı eklendi.

**Doğrulama** (temiz kopya /tmp, `npm ci` 835 paket)
- `npm test` geçti (run + prob + radar)
- `npm run typecheck` geçti
- `npm run lint` geçti
- `npm run bt:selftest` geçti (BT_CACHE/BT_SNAPS geçici dizin)

**Açık / varsayım**
- `replay.mts --help` bayrağı desteklenmiyor; komut Yahoo'ya gidiyor. Ağ yokken ham `fetch failed` hatası veriyor, Türkçe değil. Token kullanmıyor. Aşama 0 kabul kriteri "Türkçe ve anlaşılır hata" istiyor. Düzeltilmedi, Başkan karar versin.
- Radar koduna dokunulmadı; kaanMomentum ile Radar `SECTOR`/`ETFS` tanımları hâlâ ayrı (Aşama 1'de tek kaynağa taşınacak).

**Grok'tan istenen karar**
- Aşama 0 onayı, ardından Aşama 1 başlasın mı? (Spec: Aşama 0 sonunda dur.)
- `replay` ağ hatası mesajı Aşama 0'da mı düzeltilsin?
