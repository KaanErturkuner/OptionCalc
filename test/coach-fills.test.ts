// Koç dolum eşleştirme (saf): FIFO, kısmi çıkış, farklı sözleşmeler, sırasız yükleme, eşleşmeyen satış, açık pozisyon. Ağ YOK.
import { pairFills, contractKey, vwapOf, cmpFills } from '../src/lib/coach/fills.ts';
import type { Fill } from '../src/lib/coach/types.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };

let nextId = 1;
const F = (o: Partial<Fill> & { t: string; side: 'buy' | 'sell'; px: number; q: number }): Fill =>
  ({ id: nextId++, tk: 'QQQ', exp: '2026-11-13', k: 600, cp: 'C', conf: 'yuksek', ...o });
const DAY = '2026-11-13';
const at = (hm: string) => `${DAY}T${hm}`;

// 1) Basit: alış → satış = tek işlem
{
  const p = pairFills([F({ t: at('18:00'), side: 'buy', px: 1, q: 2 }), F({ t: at('18:40'), side: 'sell', px: 4.4, q: 2, conf: 'orta' })]);
  ok('basit: tek işlem, açık yok, yetim yok', p.trades.length === 1 && p.open.length === 0 && p.orphans.length === 0);
  const t = p.trades[0];
  ok('basit: giriş/çıkış/adet doğru, çıkış ort. 4,40', t.entryPx === 1 && t.exitPx === 4.4 && t.qty === 2 && t.entryT === at('18:00') && t.exitT === at('18:40'));
  ok('basit: güven en düşük alan (orta)', t.conf === 'orta' && t.trade.confidence === 'orta');
  ok('basit: koçluk girdisi CALL, kapalı', t.trade.side === 'CALL' && t.trade.status === 'kapali' && t.trade.strike === 600 && t.trade.exitPrice === 4.4);
}

// 2) FIFO: iki alış, bir satış → en eski alış eşleşir
{
  const p = pairFills([
    F({ t: at('18:00'), side: 'buy', px: 1, q: 1 }),
    F({ t: at('18:10'), side: 'buy', px: 2, q: 1 }),
    F({ t: at('18:20'), side: 'sell', px: 3, q: 1 }),
  ]);
  ok('FIFO: en eski parti (18:00, 1,00) işlem olur', p.trades.length === 1 && p.trades[0].entryT === at('18:00') && p.trades[0].entryPx === 1);
  ok('FIFO: kalan parti (18:10, 2,00) açık pozisyon', p.open.length === 1 && p.open[0].entryT === at('18:10') && p.open[0].qty === 1 && p.open[0].closedQty === 0);
}

// 3) Kısmi çıkış: 4 alış, 1 + 3 satış → tek işlem (4 adet), çıkış ağırlıklı ortalama 2,75
{
  const p = pairFills([
    F({ t: at('17:00'), side: 'buy', px: 1, q: 4 }),
    F({ t: at('17:10'), side: 'sell', px: 2, q: 1 }),
    F({ t: at('17:20'), side: 'sell', px: 3, q: 3 }),
  ]);
  const t = p.trades[0];
  ok('kısmi: tek işlem, adet 4, bacak 2', p.trades.length === 1 && t.qty === 4 && t.legs.length === 2 && p.open.length === 0);
  ok('kısmi: çıkış ağırlıklı ortalama 2,75', Math.abs(t.exitPx - 2.75) < 1e-9, String(t.exitPx));
  ok('kısmi: çıkış zamanı son satış (17:20)', t.exitT === at('17:20'));
}

// 4) Kısmi açık: 4 alış, 1 satış → işlem yok, açık 3 (kapanan 1 @2,00)
{
  const p = pairFills([F({ t: at('17:00'), side: 'buy', px: 1, q: 4 }), F({ t: at('17:10'), side: 'sell', px: 2, q: 1 })]);
  const o = p.open[0];
  ok('kısmi açık: işlem yok; açık 3, kapanan 1 @2,00', p.trades.length === 0 && p.open.length === 1 && o.qty === 3 && o.closedQty === 1 && o.closedPx === 2, JSON.stringify(o));
}

// 5) Farklı sözleşmeler ayrı eşleşir (aynı dayanak): 600C alış ile 605C satış eşleşmez
{
  const p = pairFills([F({ t: at('18:00'), side: 'buy', px: 1, q: 1, k: 600 }), F({ t: at('18:30'), side: 'sell', px: 2, q: 1, k: 605 })]);
  ok('sözleşme: farklı strike eşleşmez → 605C satış yetim, 600C açık', p.trades.length === 0 && p.orphans.length === 1 && p.orphans[0].k === 605 && p.open.length === 1 && p.open[0].k === 600);
  const q = pairFills([F({ t: at('18:00'), side: 'buy', px: 1, q: 1, cp: 'C' }), F({ t: at('18:30'), side: 'sell', px: 2, q: 1, cp: 'P' })]);
  ok('sözleşme: C/P farklı → eşleşmez', q.trades.length === 0 && q.orphans.length === 1);
  const r = pairFills([F({ t: at('18:00'), side: 'buy', px: 1, q: 1, exp: '2026-11-13' }), F({ t: at('18:30'), side: 'sell', px: 2, q: 1, exp: '2026-11-16' })]);
  ok('sözleşme: farklı vade eşleşmez', r.trades.length === 0 && r.orphans.length === 1);
  ok('sözleşme anahtarı tk|exp|k|cp', contractKey({ tk: 'QQQ', exp: DAY, k: 600, cp: 'C' }) === 'QQQ|2026-11-13|600|C');
}

// 6) Sırasız yükleme: sonuç girdi sırasına bağlı değil (aynı dolumlar, farklı sıra)
{
  const fills = [
    F({ t: at('18:00'), side: 'buy', px: 1, q: 1 }),
    F({ t: at('18:10'), side: 'buy', px: 2, q: 1 }),
    F({ t: at('18:20'), side: 'sell', px: 3, q: 1 }),
    F({ t: at('18:25'), side: 'sell', px: 3.5, q: 1 }),
    F({ t: at('17:50'), side: 'buy', px: 0.5, q: 2 }),
  ];
  const a = pairFills(fills);
  const b = pairFills([...fills].reverse());
  const c = pairFills([fills[2], fills[4], fills[0], fills[3], fills[1]]);
  ok('sırasız: ters ve karışık sırada aynı işlem/açık/yetim', JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) === JSON.stringify(c));
  // 17:50 alış 2 adet (en eski) iki satışla kapanır (çıkış ort. (3 + 3,5)/2 = 3,25); 18:00 ve 18:10 alışları açık kalır
  ok('sırasız: en eski 2 adetlik parti iki satışla kapanır (ort. 3,25), iki açık parti kalır', a.trades.length === 1 && a.trades[0].qty === 2 && a.trades[0].exitPx === 3.25 && a.open.length === 2 && a.orphans.length === 0, JSON.stringify(a.trades.map(t => [t.qty, t.exitPx])));
}

// 7) Aynı dakikada alış ve satış: alış önce (uzun pozisyon varsayımı)
{
  const p = pairFills([F({ t: at('18:00'), side: 'sell', px: 2, q: 1, id: 900 }), F({ t: at('18:00'), side: 'buy', px: 1, q: 1, id: 901 })]);
  ok('aynı dakika: alış önce → işlem (1,00 → 2,00)', p.trades.length === 1 && p.trades[0].entryPx === 1 && p.orphans.length === 0);
}

// 8) Eşleşmeyen satış: açılış yok → yetim; açık partinin üstündeki fazla satış da yetim
{
  const a = pairFills([F({ t: at('18:00'), side: 'sell', px: 2, q: 2 })]);
  ok('yetim: açılış yok → satış yetim, açık pozisyon yok', a.orphans.length === 1 && a.orphans[0].q === 2 && a.trades.length === 0 && a.open.length === 0);
  const b = pairFills([F({ t: at('18:00'), side: 'buy', px: 1, q: 1 }), F({ t: at('18:30'), side: 'sell', px: 2, q: 3 })]);
  ok('yetim: fazla satış (3 − 1 = 2) yetim olarak kalır; işlem 1 adet', b.trades.length === 1 && b.trades[0].qty === 1 && b.orphans.length === 1 && b.orphans[0].q === 2, JSON.stringify(b.orphans));
}

// 9) Kararlı kimlik: aynı dolumlar → aynı sig; yeni dolum eklenince eski işlemin sig'i değişir (yeniden koçluk)
{
  const base = [F({ id: 1, t: at('18:00'), side: 'buy', px: 1, q: 2 }), F({ id: 2, t: at('18:40'), side: 'sell', px: 4, q: 2 })];
  const s1 = pairFills(base).trades[0].sig, s2 = pairFills([...base]).trades[0].sig;
  ok('kimlik: aynı dolumlar → aynı sig', s1 === s2);
  const kisimli = pairFills([...base.slice(0, 1), F({ id: 3, t: at('18:20'), side: 'sell', px: 3, q: 1 }), F({ id: 4, t: at('18:40'), side: 'sell', px: 4, q: 1 })]).trades[0];
  ok('kimlik: iki bacaklı çıkışta sig bacak kimliklerini içerir', kisimli.sig.includes('3x1') && kisimli.sig.includes('4x1'));
}

// 10) Ağırlıklı ortalama ve sıralama yardımcıları
ok('vwap: (1×2 + 3×2) / 4 = 2', vwapOf([{ q: 1, px: 2 }, { q: 3, px: 2 }]) === 2 && vwapOf([]) === 0);
ok('vwap: 2 ve 3 (1:3) → 2,75', vwapOf([{ q: 1, px: 2 }, { q: 3, px: 3 }]) === 2.75);
ok('sıra: zaman önce, sonra alış önce', cmpFills(F({ t: at('18:00'), side: 'sell', px: 1, q: 1 }), F({ t: at('18:00'), side: 'buy', px: 1, q: 1 })) > 0);

console.log(fail ? `\n${fail} BAŞARISIZ` : '\nTüm dolum eşleştirme testleri geçti');
process.exit(fail ? 1 : 0);
