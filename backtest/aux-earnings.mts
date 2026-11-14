/*
 * Geçmiş bilanço tarihlerini Finnhub'dan bir kez çekip backtest/aux (önbellek) dosyasına yazar — YALNIZ TARİHLER.
 * Anahtar: FINNHUB_API_KEY ortam değişkeni. Anahtar kodda, çıktıda ya da hata mesajında YAZDIRILMAZ.
 * MarketData'ya bağlanmaz.
 *
 *   FINNHUB_API_KEY=... node backtest/aux-earnings.mts NVDA 2025-11-01 2026-11-30
 * Çıktı: /workspace/backtest/aux/earnings-<SEMBOL>.json  { symbol, from, to, fetchedAt, dates: [YYYY-MM-DD] }
 */
import fs from 'node:fs';

const [sym = 'NVDA', from = '2025-11-01', to = '2026-11-30'] = process.argv.slice(2);
const key = process.env.FINNHUB_API_KEY;
if (!key) { console.error('FINNHUB_API_KEY ortam değişkeni tanımlı değil.'); process.exit(1); }
if (!/^[A-Z.]{1,8}$/.test(sym)) { console.error('Geçersiz sembol.'); process.exit(1); }

const url = `https://finnhub.io/api/v1/calendar/earnings?symbol=${encodeURIComponent(sym)}&from=${from}&to=${to}&token=${encodeURIComponent(key)}`;
let j: any;
try {
  const r = await fetch(url);
  if (!r.ok) { console.error(`Finnhub HTTP ${r.status} (anahtar gizli tutuldu)`); process.exit(1); }
  j = await r.json();
} catch {
  // Hata nesnesi URL (anahtar dâhil) taşıyabileceği için ayrıntı yazılmaz.
  console.error('Finnhub isteği başarısız (ağ hatası; ayrıntı gizli tutuldu)');
  process.exit(1);
}
const dates = [...new Set<string>((j?.earningsCalendar ?? []).filter((x: any) => x?.symbol === sym && typeof x?.date === 'string').map((x: any) => x.date))].sort();
// complete: geçmiş tarihlerin eksiksiz olduğu elle doğrulanmadıkça false. Gate (firsat.mts) false iken "bilinmiyor" sayar (taşıma yok).
const out = { source: 'finnhub calendar/earnings', symbol: sym, from, to, fetchedAt: new Date().toISOString(), complete: false, dates,
  note: 'Bu anahtar/planla dönen liste yalnız gelecek tarihi içerdi; geçmiş bilanço tarihleri doğrulanamadı.' };
const file = `/workspace/backtest/aux/earnings-${sym}.json`;
fs.mkdirSync('/workspace/backtest/aux', { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`${sym} ${from}→${to}: ${dates.length} bilanço tarihi → ${file}`);
console.log(dates.join(' '));
