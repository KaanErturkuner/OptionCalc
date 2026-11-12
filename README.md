# Opsiyon Hesaplayıcı (Expo / React Native)

iPhone 17 için optimize edilmiş, koyu temalı, Türkçe opsiyon fiyat / Greek / kâr-zarar senaryo hesaplayıcısı.
Black-Scholes-Merton motoru web sürümünden (`bs.js`, `strategy.js`) TypeScript'e taşındı: `src/lib/`.

## Komutlar
```bash
npm install
npm test               # matematik testleri (Node 24 type-stripping ile, test/run.ts)
npm run typecheck      # tsc --noEmit
npx expo start         # Expo Go ile QR okut
npx expo export --platform ios|web
```

## EAS
- Proje ID: `7a3bdc56-2e9a-496b-8d53-e2c8d271df8b` (app.json → expo.extra.eas.projectId), updates URL ayarlı.
- `eas login` (veya `EXPO_TOKEN`) sonrası:
  - `eas init --id 7a3bdc56-2e9a-496b-8d53-e2c8d271df8b` (owner'ı bağlar)
  - `eas update --branch production --message "v1"` → Expo Go'da açılır
  - `eas build -p ios --profile production` + `eas submit -p ios` → TestFlight (Apple Developer hesabı gerekir)
