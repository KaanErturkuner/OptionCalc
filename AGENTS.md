# AGENTS.md — Opsiyon (option-calc)

Shared guide for every coding agent on this repo (**Grok** and **Claude** both work here for the owner, Kaan). `CLAUDE.md` imports this file.
Read this, then `docs/TASKS.md`, before you change anything. User-facing text in the app is **Turkish**; code comments are mostly Turkish, English is fine.

> **Türkçe özet:** Expo SDK 58 / TypeScript iPhone uygulaması "Opsiyon": Amerikan tipi opsiyon hesaplayıcı (Hesapla), 0DTE sinyal ekranı (0DTE),
> işlem günlüğü (Geçmiş). Veri: CBOE (anahtarsız), Yahoo, Tradier, MarketData (token). `backtest/` = strateji testi altyapısı. Görevler
> `docs/TASKS.md`'de, sahip alanıyla (Grok/Claude). İş bitince: test + typecheck + lint, TASKS.md ve CHANGELOG.md güncelle, commit.
> Token'lar asla repoya girmez. Expo'ya yayın yalnızca Kaan isteyince.

## 1. Project overview
- iPhone app (Expo Go today; EAS project `7a3bdc56-2e9a-496b-8d53-e2c8d271df8b`, owner `kaanert`, runtime policy `sdkVersion`).
- Three tabs (`src/app/index.tsx` switches screens):
  - **Hesapla** (`src/screens/Calc.tsx`) — American option pricer (Leisen-Reimer + Richardson, cash dividends), Greeks, P/L chart (pinch-zoom), price × date heatmap, strategies (Long Call/Put + "Diğer").
  - **0DTE** (`src/screens/Odte.tsx`) — scans a watchlist every N minutes, runs the signal engine, local notifications, "✓ Aldım" → position.
  - **Menü** (`src/screens/Menu.tsx`, sekme eskiden Geçmiş) — kart kaydı: **Geçmiş** (`src/screens/Journal.tsx`: signals/positions, paper by default, exit-time and target/stop alerts) and **Takip Listesi** (`src/screens/Watchlist.tsx`: Hesapla'dan eklenen opsiyonların canlı K/Z'si).
- **Para kuralı (2026-11-14):** prim stopu **−%40** (eskiden %67). Sayılar `src/lib/paper/rules.ts`'te; uyarlanabilir ÇIK yalnız uyarıdır, otomatik çıkış yapmaz (çıkış: −%40 stop, hedef, 15:45 ET / gece kuralı).
- **No proven edge.** Backtests so far show negative expectancy for the in-app engine. Treat signals as paper-only until `docs/PLAN.md` criteria pass. Never present them as advice.

## 2. Architecture map
```
src/app/                 Expo Router: _layout.tsx, index.tsx (tab switcher)          — routes only
src/screens/             Calc.tsx, Odte.tsx, Journal.tsx                             — screens
src/ui/                  Chart, Heatmap, ChainPicker, controls, theme, notify (expo-notifications), monitor (positions + background task), journalStore
src/lib/bs.ts            Black-Scholes-Merton, Greeks, implied vol
src/lib/american.ts      American pricer (LR tree + Richardson), dividends, American IV/Greeks
src/lib/strategy.ts      multi-leg strategy payoff
src/lib/usmarket.ts      NYSE calendar/holidays, ET time helpers, closeMs, marketOpen
src/lib/state.ts         persisted UI state, price step, table rows
src/lib/watchlist/       takip listesi: model (kalem, OCC, vade), pl (K/Z), refresh, build (bacak→kalem), view; src/ui/watchStore.ts (depo)
src/lib/journal.ts       journal model;  src/lib/alerts.ts  target/stop/exit alert logic
src/lib/paper/rules.ts  PARA KURALLARI — TEK KAYNAK: prim stopu −%40 (giriş × 0,60), 1R = giriş × 0,40, hedef 1:5 = giriş + 5R (×3,0), 1:4 = ×2,6. Yeni kural/sayı yalnız burada; 0,33/0,67/%67 literal'i yazılmaz.
src/lib/market/          providers: cboe.ts (default, keyless), yahoo.ts, tradier.ts, marketdata.ts (token; mdMode live|cached), bars.ts (1-min bars: Yahoo first, MarketData fallback), index.ts (loadSymbol/loadChain), types.ts
src/lib/odte/analytics.ts  OI walls, max pain, GEX + gamma flip, P/C, unusual volume, expected move, VWAP, ORB, momentum
src/lib/odte/signal.ts     in-app engine: features() + decide(); DEFAULT_OPTS (v2), V1_OPTS
src/lib/odte/scan.ts       fetch + analyze one symbol
src/lib/odte/strategies/   pluggable strategies (pure TS, app-compatible): types.ts, util.ts, orbVwap, gammaRegime, oiWall, emBreach, confluence (wraps signal.ts), index.ts (registry, withTimeFilter)
backtest/                Node-only .mts scripts (not in tsc / Metro bundle) — see backtest/README.md
server/                  Akış sunucusu (droplet 162.243.88.42, Node 24, systemd, Caddy HTTPS): TEK MarketData istemcisi + izinli proxy + olağandışı akış + Expo push — server/README.md (tsc/lint dışı; npm run flow:selftest)
src/lib/flow/            akış saf mantığı: vade (expiry), tespit (detect), plan/kredi (plan), proxy izin listesi (proxy), istemci (client), tipler (model)
src/screens/Akis.tsx     Akış sekmesi (sunucudan olaylar; bilgi amaçlı)
test/run.ts              unit tests (Node type stripping; fixtures in test/fixtures)
docs/PLAN.md             post-API-approval plan (TR);  docs/TASKS.md  task board;  docs/CHANGELOG.md  handoff log
```
Data that is NOT in git: `/workspace/backtest/{cache,days,snaps,reports}` (raw API cache, day records, recorded intraday snapshots, reports). On another machine set `BT_CACHE`, `BT_SNAPS` and pass `--out`; `loadDays()` reads `/workspace/backtest/days` by default.

## 3. Run / test / typecheck / lint
```bash
npm install
npm test                 # unit tests (test/run.ts)
npm run typecheck        # tsc --noEmit
npm run lint             # expo lint
npm run bt:selftest      # backtest infra self-test on synthetic data (no API, no data needed)
npm run check            # all four — run before every commit
npx expo start           # dev server, scan QR with Expo Go
```
Backtest: `npm run bt:compare -- --quick --t SPY` (needs day records), full flow in `backtest/README.md`.

## 4. Publishing (only when Kaan asks for it)
```bash
export EXPO_TOKEN=...    # from env only
npm run check
npx eas-cli@latest update --branch production --message "<kısa Türkçe açıklama>" --non-interactive
```
Then tell Kaan to fully close and reopen Expo Go (once or twice). Native module changes need a dev build (`eas build --profile development`), not an update.

## 5. Secrets — hard rules
- **Never commit or print tokens.** `EXPO_TOKEN`, `MARKETDATA_TOKEN`, Tradier keys come from environment variables only. `.env*` files stay untracked.
- The app stores user-entered keys on-device (AsyncStorage) — never hardcode a key in source, fixtures, tests, or docs.
- **Uygulama MarketData'yı doğrudan çağırmaz** (2026-11-14'ten beri): her çağrı sunucu proxy'sinden (`server/`). Sunucu çalışırken `backtest/` scriptleri (`fetch`, `record`, `probe`, `peers`) MarketData'yı doğrudan çağırır → çalıştırma; önce sunucu durdurulmalı.
- MarketData **one-device rule**: the same token used from two devices/IPs at once locks the account for 5 minutes. Before running any `backtest/*` script that hits the API (`fetch`, `record`, `probe`), make sure the phone isn't using MarketData. Never run two API scripts at the same time.
- Respect the credit budget (Trader: 100k/day, resets 09:30 ET). Use `BT_DRYRUN=1` to estimate first; `BT_MAX_CREDITS` / `BT_RESERVE` guard every script.

## 6. Coding conventions
- TypeScript strict; relative imports with explicit `.ts` extension inside `src/lib` (so Node can run them in tests/backtests); `@/` alias is fine in UI files.
- `src/lib/**` stays pure (no React, no Node built-ins) so it runs in the app, tests and backtests. Node-only code goes in `backtest/` as `.mts`.
- Compact style matching existing files; Turkish UI strings (`tr-TR` number format via `src/lib/format.ts`). Prices in USD, times in ET internally; show Istanbul time to the user where relevant.
- No look-ahead in anything a backtest consumes: strategies see only completed bars (`ctx.bars`), D−1 open interest, prior-day IV.
- Keep app UI behavior unchanged unless the task says otherwise; add a unit test for any pure logic you add.
- Expo: use `npx expo install <pkg>`; check versioned docs for SDK 58 (see "Expo rules" below).

## 7. Engine / backtest workflow
1. Idea → new module in `src/lib/odte/strategies/<name>.ts` implementing `Strategy<P>` (`defaults`, `space`, `evaluate`). Register in `strategies/index.ts`.
2. `npm test && npm run bt:selftest`.
3. `npm run bt:compare -- --s <id>` → `/workspace/backtest/reports/latest/report.md`. Decide only on walk-forward **out-of-sample** results and `backtest/criteria.mts` labels (ADAY / ZAYIF / RED).
4. Real intraday option prices exist only from our own recordings (`bt:record`, see PLAN.md). Use `--source hybrid` once recordings exist.
5. Changing in-app defaults (`signal.ts` DEFAULT_OPTS) requires an OOS result in `docs/CHANGELOG.md`.

## 8. Current status & open tasks
- See **`docs/PLAN.md`** (what to do once MarketData/OPRA approval lands) and **`docs/TASKS.md`** (task board with owners).
- Waiting on OPRA approval → do not call the MarketData API until Kaan confirms the token works.

## 9. Handoff protocol (Grok ⇄ Claude)
1. **Pick a task** in `docs/TASKS.md`: set `Owner` to yourself and `Status` to `doing` in the same commit as your first change (or a tiny claim commit). Don't take a task another agent has `doing` unless it's been idle and Kaan agrees.
2. **Small commits**, message format: `[grok] <area>: <what>` or `[claude] <area>: <what>` — areas: `ui`, `engine`, `backtest`, `market`, `docs`, `infra`. Turkish or English, describe the why when not obvious.
3. **Before committing:** `npm run check` must pass. Never commit data (`/workspace/backtest/...`), tokens, `node_modules`, `dist*`.
4. **When done:** mark the task `done` in TASKS.md, add a dated entry to `docs/CHANGELOG.md` (who, what, files, how verified, follow-ups / open questions for the other agent).
5. **Starting a session:** `git pull` (once a remote exists), read the newest CHANGELOG entries and TASKS.md, then work.
6. Conflicts: don't rewrite or force-push shared history; resolve by merging. If you disagree with another agent's change, note it in CHANGELOG and ask Kaan.

## 10. Syncing between agents — git remote (recommended, not set up yet)
The repo currently lives only on Grok's box (`/workspace/option-calc`, no remote), so Claude can only see it via the exported zip. Recommended:
create a **private GitHub repo** (e.g. `kaanert/option-calc`), `git remote add origin … && git push -u origin main`, give both agents access
(Claude Code / Claude GitHub integration, Grok via its GitHub connector). Then both pull/push the same `main` (or short-lived branches + PRs).
Until then: Kaan moves the zip between agents and each agent records its changes in CHANGELOG.md.

---

# Expo rules (generic, keep)

This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
