@AGENTS.md

# CLAUDE.md

This repo is shared between **Claude** and **Grok** (both work for Kaan). The full guide is `AGENTS.md` (imported above) — if your
environment doesn't expand `@AGENTS.md`, open it directly. Essentials:

- **What:** Expo SDK 58 TypeScript iPhone app "Opsiyon" (tabs Hesapla / 0DTE / Menü: Geçmiş, Takip Listesi) + `backtest/` (Node 24 `.mts`) strategy research.
- **Check before every commit:** `npm run check` (= `npm test`, `npm run typecheck`, `npm run lint`, `npm run bt:selftest`).
- **Tasks:** `docs/TASKS.md` — claim one (Owner: Claude, Status: doing), finish it, mark done, add a `docs/CHANGELOG.md` entry.
- **Commits:** `[claude] <area>: <what>`. Never commit tokens, `.env*`, data under `/workspace/backtest/`, `node_modules`, `dist*`.
- **Secrets:** `EXPO_TOKEN`, `MARKETDATA_TOKEN` only via env. MarketData one-device rule: don't call the API while the phone uses it; never run two API scripts at once.
- **Publishing:** only when Kaan asks — `npx eas-cli@latest update --branch production --message "..." --non-interactive`.
- **Para kuralı:** prim stopu −%40 (2026-11-14, eskiden %67); tek kaynak `src/lib/paper/rules.ts`. ÇIK yalnız uyarı.
- **Status:** waiting on MarketData OPRA approval; plan in `docs/PLAN.md`. Current in-app engine has no proven edge — signals are paper-only.
- **Language:** UI text Turkish; talk to Kaan in Turkish.

> **Türkçe özet:** Bu repo Claude ve Grok arasında ortak. Ayrıntılı kurallar `AGENTS.md`'de. Commit öncesi `npm run check`; görevler
> `docs/TASKS.md`; bitince CHANGELOG'a not; token'lar asla repoya girmez; Expo'ya yayın yalnızca Kaan isteyince.

## Expo'ya yayınlama (OTA)
Expo Go + OTA yalnız (native/TestFlight yok). Ön koşullar (EXPO_TOKEN, git'e girmeyen .env içinde EXPO_PUBLIC_FLOW_API_KEY), adımlar, doğrulama, geri alma ve koordinasyon: `HANDOFF_CLAUDE.md` §15. Sırları asla commit etme/yazdırma; `src/lib/flow/client.ts` içindeki ENV_FLOW_KEY yedeğini silme.
