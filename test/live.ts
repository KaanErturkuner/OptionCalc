// Canlı veri testi (ağ gerekir): node test/live.ts [SEMBOL]
import * as MD from '../src/lib/market/index.ts';
const sym = process.argv[2] || 'AAPL';
for (const p of ['cboe', 'yahoo', 'auto'] as MD.ProviderPref[]) {
  const t = Date.now();
  try {
    const r = await MD.loadSymbol(sym, p);
    const e = r.expirations[Math.min(5, r.expirations.length - 1)], c = await MD.loadChain(r.provider, sym, e);
    const atm = MD.nearest(c.calls, r.quote.price)!;
    console.log(`OK  ${p} → ${r.provider}: ${sym} ${r.quote.price} (${r.quote.changePct.toFixed(2)}%) ${new Date(r.quote.time).toISOString()} gecikme ${r.quote.delayedMin}dk div%${r.quote.divYield?.toFixed(2)} | ${r.expirations.length} vade, ${e}: ${c.calls.length}C/${c.puts.length}P, ATM ${atm.strike}C bid ${atm.bid} ask ${atm.ask} iv ${atm.iv} oi ${atm.oi} | ${Date.now() - t}ms`);
  } catch (err: any) { console.log(`FAIL ${p}: ${err.message} (${Date.now() - t}ms)`); }
}
