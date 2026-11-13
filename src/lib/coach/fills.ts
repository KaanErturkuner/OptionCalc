/*
 * Dolum eşleştirme (saf). Her sözleşme (tk+vade+strike+C/P) için dolumlar zaman sırasıyla (FIFO) işlenir:
 *  - Alış (buy) yeni bir "parti" (lot) açar (uzun pozisyon; Kaan yalnız uzun opsiyon işler).
 *  - Satış (sell) en eski partilerden düşer (FIFO). Parti tamamen kapanınca bir İŞLEM oluşur
 *    (kademeli / kısmi çıkışlar tek işlemde, çıkış fiyatı ağırlıklı ortalama).
 *  - Parti kısmen kapandıysa açık pozisyonun parçasıdır (işlem değildir; koçluk yok).
 *  - Açık parti yokken gelen satış ya da açık partinin üstündeki fazla satış "eşleşmeyen kapanış" olur
 *    (açılışı ekran görüntülerinde yok); açılış bilinmeden işlem uydurulmaz.
 * Sonuç dolum kimliklerinden (id) türetilir; sıralama içerik + zamandır: giriş sırası (yükleme sırası) sonucu değiştirmez.
 */
import { istToMs } from './time.ts';
import type { Conf, ExtractedTrade, Fill } from './types.ts';

export interface Leg { fillId: number; t: string; q: number; px: number; conf: Conf }

export interface PairedTrade {
  sig: string;                       // kararlı kimlik (dolum kimlikleri); koçluk raporu anahtarı
  contract: string;                  // tk|exp|k|cp
  tk: string; exp: string; k: number; cp: 'C' | 'P';
  qty: number;
  entryFillId: number; entryT: string; entryPx: number;
  exitT: string; exitPx: number;     // exitPx: çıkış dolumlarının ağırlıklı ortalaması
  legs: Leg[];
  conf: Conf;
  trade: ExtractedTrade;             // koçluk girdisi (uzun varsayımıyla; kısa işlemlerde kullanılmaz)
}

export interface OpenPosition {
  contract: string; tk: string; exp: string; k: number; cp: 'C' | 'P';
  qty: number;                       // kalan (açık) adet
  entryFillId: number; entryT: string; entryPx: number;
  closedQty: number; closedPx: number | null;
  legs: Leg[];                       // kısmi kapanışlar
}

export interface Pairing { trades: PairedTrade[]; open: OpenPosition[]; orphans: Fill[] }

const RANK: Record<Conf, number> = { dusuk: 0, orta: 1, yuksek: 2 };
const minConf = (cs: Conf[]): Conf => cs.reduce((a, b) => (RANK[b] < RANK[a] ? b : a));
const round4 = (x: number) => Math.round(x * 10000) / 10000;

export function contractKey(f: Pick<Fill, 'tk' | 'exp' | 'k' | 'cp'>): string { return `${f.tk}|${f.exp}|${f.k}|${f.cp}`; }

/** Ağırlıklı ortalama fiyat (adet ağırlıklı); boş → 0 */
export function vwapOf(legs: { q: number; px: number }[]): number {
  const q = legs.reduce((a, l) => a + l.q, 0);
  return q > 0 ? round4(legs.reduce((a, l) => a + l.q * l.px, 0) / q) : 0;
}

/** Zaman sırası: zaman, alış önce, fiyat, adet, kimlik (deterministik) */
export function cmpFills(a: Fill, b: Fill): number {
  return (istToMs(a.t) ?? 0) - (istToMs(b.t) ?? 0)
    || (a.side === b.side ? 0 : a.side === 'buy' ? -1 : 1)
    || a.px - b.px || a.q - b.q || a.id - b.id;
}

interface Lot { fill: Fill; rem: number; legs: Leg[] }

export function pairFills(all: Fill[]): Pairing {
  const groups = new Map<string, Fill[]>();
  for (const f of all) {
    const key = contractKey(f);
    const g = groups.get(key);
    if (g) g.push(f); else groups.set(key, [f]);
  }
  const trades: PairedTrade[] = [], open: OpenPosition[] = [], orphans: Fill[] = [];
  for (const [key, list] of groups) {
    list.sort(cmpFills);
    let lots: Lot[] = [];
    const done: Lot[] = [];
    for (const f of list) {
      if (f.side === 'buy') { lots.push({ fill: f, rem: f.q, legs: [] }); continue; }
      let need = f.q;
      while (need > 0 && lots.length) {
        const L = lots[0];
        const take = Math.min(L.rem, need);
        L.rem -= take; need -= take;
        L.legs.push({ fillId: f.id, t: f.t, q: take, px: f.px, conf: f.conf });
        if (L.rem === 0) { lots.shift(); done.push(L); }
      }
      if (need > 0) orphans.push({ ...f, q: need });
    }
    for (const L of done) trades.push(toTrade(key, L));
    for (const L of lots) open.push(toOpen(key, L));
  }
  trades.sort((a, b) => cmpT(a.entryT, b.entryT) || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0));
  open.sort((a, b) => cmpT(a.entryT, b.entryT) || (a.contract < b.contract ? -1 : 1));
  orphans.sort(cmpFills);
  return { trades, open, orphans };
}

const cmpT = (a: string, b: string) => (istToMs(a) ?? 0) - (istToMs(b) ?? 0);

function toTrade(key: string, L: Lot): PairedTrade {
  const f = L.fill;
  const exitPx = vwapOf(L.legs);
  const exitT = L.legs[L.legs.length - 1].t;
  const conf = minConf([f.conf, ...L.legs.map(l => l.conf)]);
  const sig = `${key}#${f.id}#${L.legs.map(l => `${l.fillId}x${l.q}`).join('+')}`;
  return {
    sig, contract: key, tk: f.tk, exp: f.exp, k: f.k, cp: f.cp, qty: f.q,
    entryFillId: f.id, entryT: f.t, entryPx: f.px, exitT, exitPx, legs: L.legs, conf,
    trade: {
      ticker: f.tk, side: f.cp === 'C' ? 'CALL' : 'PUT', strike: f.k, expiry: f.exp, qty: f.q,
      entryTime: f.t, entryPrice: f.px, exitTime: exitT, exitPrice: exitPx, status: 'kapali', confidence: conf,
    },
  };
}

function toOpen(key: string, L: Lot): OpenPosition {
  const f = L.fill;
  const closedQty = L.legs.reduce((a, l) => a + l.q, 0);
  return {
    contract: key, tk: f.tk, exp: f.exp, k: f.k, cp: f.cp, qty: L.rem,
    entryFillId: f.id, entryT: f.t, entryPx: f.px,
    closedQty, closedPx: closedQty > 0 ? vwapOf(L.legs) : null, legs: L.legs,
  };
}
