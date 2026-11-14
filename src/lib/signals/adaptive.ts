/*
 * Uyarlanabilir çıkış (SINYAL-FIRSAT §7.3; Kaan onayı: "düşünsün eğer dönüyorsa piyasa geçsin, yok devam edeceğine dair gösterge olursa devam").
 * Açık pozisyon, girişten beri en iyi (lehte) uç noktadan ADAPT.COUNTER_PCT % ters harekete geçince değerlendirilir:
 * dönüş kanıtı (aleyhte) ile devam kanıtı (lehte) ağırlıklı puanlanır.
 *   dönüş > devam → ÇIK (riskwatch kapatır) · devam > dönüş → TUT (çıkış yok) · eşit → DİKKAT (izle, çıkış yok).
 * Karşı hareket eşiğine ulaşılmadıysa YOK (karar verilmez). Saf: girdi 1 dk barlar + onaylı rejim; ağ ve durum yok.
 * Sert %67 prim stopu bu modülden ÖNCE değerlendirilir (riskwatch.evaluatePosition sırası).
 */
import { type TapeBar, type RegimeKind, MIN_MS, resample5, vwapSeries } from '../market/regime.ts';

/** Eşikler ve ağırlıklar (adlandırılmış sabitler). Değiştirirken: test/adaptive.test.ts ve CHANGELOG güncellenir. */
export const ADAPT = {
  COUNTER_PCT: 0.3,        // karşı hareket (%): girişten beri lehte uç noktadan ters yönde
  VOL_MULT: 2,             // hacimli mum: son 1 dk hacmi / önceki VOL_AVG_N dk ortalaması
  VOL_AVG_N: 20,
  BODY_MIN: 0.6,           // mum gövdesi / aralık alt sınırı
  MOM_N: 15,               // momentum penceresi (dk, ROC)
  W_VWAP: 2,               // VWAP: pozisyonun ters tarafında = dönüş; doğru tarafında = devam
  W_CANDLE: 2,             // hacimli ters mum (dönüş)
  W_CANDLE_CONT: 1,        // hacimli trend yönü mumu (devam)
  W_STRUCT: 2,             // 5 dk yapı: son dip/tepe kırıldı (dönüş) · HH+HL / LH+LL korunuyor (devam)
  W_REGIME: 2,             // onaylı rejim aleyhte (dönüş)
  W_REGIME_CONT: 1,        // onaylı rejim lehte (devam)
  W_MOM: 1,                // momentum ters (dönüş) / yönde (devam)
} as const;

export type AdaptVerdict = 'CIK' | 'TUT' | 'DIKKAT' | 'YOK';

export interface AdaptiveInput {
  dirSign: 1 | -1;          // +1 call, −1 put
  entryT: number;           // ms: pozisyonun açılışı (önceki gün açıldıysa seans başı kullanılır)
  nowMs: number;
  bars: TapeBar[];          // seans 1 dk barları (tamamlanmamış son bar yok sayılır)
  regime: RegimeKind | null; // ONAYLI rejim (histerezis sonrası)
}

export interface AdaptiveDecision {
  verdict: AdaptVerdict;
  counterPct: number;       // karşı hareket (%) — YOK ise de dolu
  rev: number;              // dönüş puanı (aleyhte)
  cont: number;             // devam puanı (lehte)
  revSig: string[];         // dönüş kanıtları (karar nedenleri)
  contSig: string[];        // devam kanıtları
  regimeAgainst: boolean;   // onaylı rejim pozisyonun ters yönünde (overnight ve kart için)
  reason: string;           // tek satır Türkçe gerekçe
}

interface Ev { w: number; text: string }
const r2 = (x: number) => Math.round(x * 100) / 100;
const pct = (x: number) => `%${x.toFixed(2).replace('.', ',')}`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function adaptiveDecision(i: AdaptiveInput): AdaptiveDecision {
  const s = i.dirSign;
  const sess = i.bars.filter(b => b.t + MIN_MS <= i.nowMs);
  const none = (verdict: AdaptVerdict, counterPct = 0, regimeAgainst = false): AdaptiveDecision =>
    ({ verdict, counterPct: r2(counterPct), rev: 0, cont: 0, revSig: [], contSig: [], regimeAgainst, reason: '' });
  const after = sess.filter(b => b.t + MIN_MS > i.entryT);     // girişi içeren barla başlar
  if (after.length === 0 || sess.length < 6) return none('YOK');
  const last = sess[sess.length - 1];
  const fav = s > 0 ? Math.max(...after.map(b => b.h)) : Math.min(...after.map(b => b.l));
  const counterPct = fav > 0 ? s * (fav - last.c) / fav * 100 : 0;
  const rs = i.regime === 'donus_up' || i.regime === 'trend_up' ? 1 : i.regime === 'donus_down' || i.regime === 'trend_down' ? -1 : 0;
  const regimeAgainst = rs === -s;
  if (!(counterPct >= ADAPT.COUNTER_PCT)) return none('YOK', counterPct, regimeAgainst);

  const rev: Ev[] = [], cont: Ev[] = [];
  const add = (list: Ev[], w: number, text: string) => list.push({ w, text });

  // 1) VWAP: son fiyat pozisyonun ters tarafında (kayıp) → dönüş; doğru tarafında → devam
  const vws = vwapSeries(sess);
  const vNow = vws.length ? vws[vws.length - 1] : null;
  if (vNow != null) {
    const side = s * (last.c - vNow);
    if (side < 0) add(rev, ADAPT.W_VWAP, 'VWAP kaybı');
    else if (side > 0) add(cont, ADAPT.W_VWAP, 'VWAP doğru tarafta');
  }

  // 2) Son 1 dk mumu: hacimli ters mum → dönüş; hacimli trend yönü mumu → devam
  const prior = sess.slice(Math.max(0, sess.length - 1 - ADAPT.VOL_AVG_N), sess.length - 1);
  const avgV = mean(prior.map(b => b.v));
  const volRatio = avgV > 0 ? last.v / avgV : 0;
  const range = last.h - last.l;
  const body = range > 0 ? Math.abs(last.c - last.o) / range : 0;
  if (range > 0 && body >= ADAPT.BODY_MIN && volRatio >= ADAPT.VOL_MULT) {
    const against = s > 0 ? last.c < last.o : last.c > last.o;
    if (against) add(rev, ADAPT.W_CANDLE, 'hacimli ters mum');
    else add(cont, ADAPT.W_CANDLE_CONT, 'hacimli trend mumu');
  }

  // 3) 5 dk yapı (tamamlanmış mumlar; girişten sonra): pivotlar, kırılım, HH/HL veya LH/LL
  const fv = resample5(sess).filter(f => f.t + 5 * MIN_MS <= i.nowMs && f.t + 5 * MIN_MS > i.entryT);
  const pivots = (hi: boolean) => {
    const out: number[] = [];
    for (let k = 1; k < fv.length - 1; k++) {
      const a = fv[k], p = fv[k - 1], n = fv[k + 1];
      if (hi ? a.h > p.h && a.h > n.h : a.l < p.l && a.l < n.l) out.push(k);
    }
    return out;
  };
  const hs = pivots(true), ls = pivots(false);
  const H = (k: number) => fv[hs[hs.length - 1 - k]];
  const L = (k: number) => fv[ls[ls.length - 1 - k]];
  if (s > 0) {
    if (ls.length >= 1 && last.c < L(0).l) add(rev, ADAPT.W_STRUCT, '5 dk dip kırıldı');
    if (hs.length >= 2 && ls.length >= 2 && H(0).h > H(1).h && L(0).l > L(1).l) add(cont, ADAPT.W_STRUCT, 'HH/HL korunuyor');
  } else {
    if (hs.length >= 1 && last.c > H(0).h) add(rev, ADAPT.W_STRUCT, '5 dk tepe kırıldı');
    if (hs.length >= 2 && ls.length >= 2 && H(0).h < H(1).h && L(0).l < L(1).l) add(cont, ADAPT.W_STRUCT, 'LH/LL korunuyor');
  }

  // 4) Onaylı rejim: pozisyona ters → dönüş; yönde → devam (konsolidasyon/karışık/erken: nötr)
  if (rs === -s) add(rev, ADAPT.W_REGIME, 'onaylı rejim aleyhte');
  else if (rs === s) add(cont, ADAPT.W_REGIME_CONT, 'onaylı rejim lehte');

  // 5) Momentum (ROC, MOM_N dk): ters → dönüş; yönde → devam
  if (sess.length > ADAPT.MOM_N) {
    const m = s * (last.c - sess[sess.length - 1 - ADAPT.MOM_N].c);
    if (m < 0) add(rev, ADAPT.W_MOM, 'momentum ters');
    else if (m > 0) add(cont, ADAPT.W_MOM, 'momentum yönde');
  }

  const R = rev.reduce((a, e) => a + e.w, 0), C = cont.reduce((a, e) => a + e.w, 0);
  const verdict: AdaptVerdict = R > C ? 'CIK' : C > R ? 'TUT' : 'DIKKAT';
  const rt = rev.map(e => e.text), ct = cont.map(e => e.text);
  const reason = verdict === 'CIK' ? `ÇIK: ${rt.join(' + ')}; devam kanıtı ${ct.length ? ct.join(' + ') : 'zayıf'}`
    : verdict === 'TUT' ? `TUT: ${ct.join(' + ')}; ters kanıt ${rt.length ? rt.join(' + ') : 'zayıf'}`
    : `DİKKAT: karşı hareket ${pct(counterPct)}; ters ${R} / devam ${C} puan (${rt.join(' + ') || 'ters kanıt yok'} ↔ ${ct.join(' + ') || 'devam kanıtı yok'})`;
  return { verdict, counterPct: r2(counterPct), rev: R, cont: C, revSig: rt, contSig: ct, regimeAgainst, reason };
}
