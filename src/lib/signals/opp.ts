/* Fırsat kartı (Aşama 5 çekirdeği): skor girdisi, güven skoru, RR (1:N), mod uygunluğu, kâğıt boyut önizlemesi, Başkan metni.
 * Saf. Veri çekmez; çağıran tarama turu girdiyi hazırlar. SINYAL-FIRSAT §5, §6.3, §7.1, §8.2. */
import type { Dir, SetupId } from './types.ts';
import type { StrikePick } from './strikes.ts';
import { scoreSignal, type ScoreInput, type Component, type Label } from './confidence.ts';
import { effectiveStopPrem, modeTargetR } from './riskwatch.ts';
import { eligibility, signalModeFor, MODE_RULES, type SignalMode } from '../paper/account.ts';
import { sizePosition } from '../paper/sizing.ts';
import type { Kademe, PaperMode } from '../paper/types.ts';
import { isQ, Q_PAPER_ELIGIBLE, Q_NOT_ELIGIBLE } from './qull/policy.ts';

/** Normal dağılım fonksiyonu (Abramowitz–Stegun 7.1.26, |hata| < 1,5e-7). */
export function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/**
 * Dayanağın hedefe dokunma olasılığı (yaklaşım): 2 × (1 − Φ(gereken hareket / kalan EM)).
 * Olasılık motoru (prob/implied) bu turda bağlı değil; EM tabanlı kaba bir yaklaşımdır ve raporda öyle yazılır.
 */
export function pTouchApprox(need: number, emRemain: number): number {
  if (!(emRemain > 0) || !Number.isFinite(need)) return 0;
  return Math.min(1, Math.max(0, 2 * (1 - normCdf(Math.abs(need) / emRemain))));
}

/** Hesap moduna göre en düşük RR (skor kapısında veto için). DURDU'da hiçbir şey uygun değil. */
export function minRrFor(accMode: PaperMode): number {
  if (accMode === 'DURDU') return Infinity;
  if (accMode === 'AGRESIF') return MODE_RULES.AGRESIF_3.minRR;
  return MODE_RULES.GUVENLI_ZARAR.minRR;
}

/** Türkçe sayı: 1,25 */
export const trNum = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d).replace('.', ',') : '—');

export interface OppInput {
  ticker: string; setup: SetupId; dir: Dir; pick: StrikePick; spot: number;
  und: { entry: number; stop: number; target: number }; reasons: string[];
  em: number; emRemain: number; expiry: string; dte: number; etMin: number; leftMin: number; marketOpen: boolean;
  now: number; delayedMin: number; barAgeSec: number; chainAgeSec: number;
  regime: { vwapAll: boolean; orAll: boolean; opposite: boolean };        // A1 (opposite: ters rejim vetosu)
  sector: { present: boolean; vwapOk: boolean };                          // A2 (göreli güç bu turda yok)
  frames: number; volRatio: number;                                       // A3, B
  radar: { same: number; oppMax: number };                                // C (şiddet 0–1 toplamı)
  maxSpreadPct: number; spreadPct: number; liquid: boolean;               // E
  newsAgainst?: boolean; macroNear?: boolean; earningsInDte?: boolean; s5?: boolean; // G
  account: { mode: PaperMode; capital: number; kademe: Kademe; commission: number; fractional: boolean };
  ttlMin: number;                                                          // onay süresi (dk), metinde
  quote: { bid: number; ask: number; iv: number | null };                 // seçilen kontrat (zincirden)
  qual?: { score: number; note: string } | null;                          // Q-kalite (yalnız Q setupları; bilgi amaçlı)
}

/** Kart: tarama turunun ürettiği aday. Onay durumu store'da tutulur. */
export interface Opp {
  key: string; ticker: string; setup: SetupId; dir: Dir; type: 'call' | 'put';
  expiry: string; dte: number; strike: number; delta: number;
  bid: number; ask: number; fill: number; stopPrem: number; primTarget: number; rr: number;
  und: { entry: number; stop: number; target: number }; spot0: number;
  createdAt: number; score: number; label: Label; components: Component[]; vetoes: string[];
  pTouch: number; mode: SignalMode | null; eligible: boolean; reason: string;
  sizing: { contracts: number; cost: number; budget: number; openComm: number } | null;
  overnightOk: boolean; reasons: string[];
  text: { title: string; body: string };
  delayedMin: number; barAgeSec: number; chainAgeSec: number;
  regimeVwap: boolean; regimeOr: boolean;
  qual: { score: number; note: string } | null;   // Q-kalite satırı (kartta gösterilir)
}

const SETUP_AD: Record<SetupId, string> = {
  S1: 'uyumlu açılış aralığı kırılımı', S2: 'sıkışma sonrası kırılım', S3: 'trend içi VWAP geri alma',
  S4: 'gamma/OI duvarı kırılımı', S5: 'haber sonrası devam', S6: 'ucuz IV + hareket öncesi',
  Q1: 'ORH kırılımı (Qullamaggie uyarlaması)', Q1S: 'ORL kırılımı, zayıf isim (Qullamaggie uyarlaması)',
  Q2: 'Episodic Pivot (Qullamaggie uyarlaması)', Q3: 'parabolik short, deneysel (Qullamaggie uyarlaması)',
};

/** Aday kartı: skor, RR, mod uygunluğu, boyut önizlemesi, metin. */
export function buildOpp(i: OppInput): Opp {
  const q = i.pick.rr;
  const type = i.dir === 'bull' ? 'call' : 'put';
  const fill = q.entry;                                      // ask + kayma (optionRR)
  const stopPrem = effectiveStopPrem(fill, q.primStop);
  // Kaan tanımı (D12): hedef = giriş + N × risk, risk = giriş − stop (150, 50 → risk 100; 1:5 → 650). N: sinyal modunun hedef çarpanı.
  const riskPrem = fill - stopPrem;
  const modeN = signalModeFor(i.account.mode, q.rr);
  const N = modeN ? modeTargetR(modeN, q.rr) : MODE_RULES.AGRESIF.minRR;
  const primTarget = fill + N * riskPrem;
  const needMove = Math.abs(i.und.target - i.spot);
  const pTouch = pTouchApprox(needMove, i.emRemain);
  const minRr = minRrFor(i.account.mode);
  const budget = i.account.capital * i.account.kademe;
  const askCost = fill * 100;                                // kontrat maliyeti (kayma dâhil) + açılış komisyonu
  const input: ScoreInput = {
    dir: i.dir,
    regime: { opposite: i.regime.opposite, vwapAll: i.regime.vwapAll, orAll: i.regime.orAll },
    sector: { present: i.sector.present, vwapOk: i.sector.vwapOk, rsOk: false },
    frames: { aligned: i.frames },
    volRatio: i.volRatio,
    radar: { same: i.radar.same, oppMax: i.radar.oppMax },
    rr: { needMove, remainingEm: i.emRemain, pTouch, rr: q.rr, minRr: Number.isFinite(minRr) ? minRr : 99 },
    liq: { spreadPct: i.spreadPct, liquid: i.liquid, maxSpreadPct: i.maxSpreadPct },
    time: { etMin: i.etMin, dte: i.dte },
    risk: { newsAgainst: !!i.newsAgainst, macroNear: !!i.macroNear, earningsInDte: !!i.earningsInDte, s5: !!i.s5 },
    hist: { n: 0, wins: 0, pBe: q.rr > 0 ? 1 / (1 + q.rr) : 1 },   // geçmiş birikmediği için nötr (n < 30)
    data: { delayedMin: i.delayedMin, barAgeSec: i.barAgeSec, chainAgeSec: i.chainAgeSec },
    marketOpen: i.marketOpen,
    budget: { askCost: askCost + i.account.commission, available: budget },
  };
  // (Kontrat ask'ı sermayeyi aşarsa "sermaye yetersiz" vetosu; adet önizlemesi aşağıda.)
  const conf = scoreSignal(input);
  const sz = sizePosition(i.account.capital, i.account.kademe, fill, { commission: i.account.commission, fractional: i.account.fractional });
  const sizing = sz.contracts > 0 ? { contracts: sz.contracts, cost: sz.cost, budget: sz.budget, openComm: sz.openComm } : null;

  // Uygunluk: veto yok, mod var, skor ≥ mod asgarisi, adet ≥ 1 (§7.7). Q setupları kâğıda uygun değil (Q_PAPER_ELIGIBLE, Kaan onayı yok).
  let reason = '';
  const mode = modeN;
  const el = eligibility(i.account.mode, q.rr, conf.score);
  const qGate = isQ(i.setup) && !Q_PAPER_ELIGIBLE.has(i.setup);
  if (qGate) reason = Q_NOT_ELIGIBLE;
  else if (conf.vetoes.length) reason = `veto: ${conf.vetoes[0]}`;
  else if (!el.ok) reason = el.reason;
  else if (!sizing) reason = 'sermaye bu kontrat için yetmiyor';
  const eligible = !qGate && !conf.vetoes.length && el.ok && !!sizing;

  const overnightOk = i.dte >= 1;
  const kPct = Math.round(i.account.kademe * 100);
  const body = [
    `Başkan, ${i.reasons[0] ?? SETUP_AD[i.setup]}.`,
    `Güven ${conf.score}/100 (${conf.label}, doğrulanmamış 0/30).`,
    ...(i.qual ? [`Q-kalite ${i.qual.score}/100.`] : []),
    `RR 1:${trNum(q.rr, 1)}.`,
    `Giriş ${trNum(fill)} $, stop ${trNum(stopPrem)} $, hedef ${trNum(primTarget)} $ (1:${trNum(N, 0)}).`,
    sizing ? `Kâğıt: %${kPct} kademe, ${sizing.contracts} kontrat, ${trNum(sizing.cost, 0)} $ + komisyon.` : 'Kâğıt: sermaye yetmiyor.',
    eligible ? `${i.ttlMin} dk içinde Onayla.` : `Bekliyorum: ${reason}.`,
  ].join(' ');

  return {
    key: `${i.ticker}|${i.setup}|${type}|${i.pick.strike}|${i.expiry}`,
    ticker: i.ticker, setup: i.setup, dir: i.dir, type, expiry: i.expiry, dte: i.dte, strike: i.pick.strike, delta: i.pick.delta,
    bid: i.quote.bid, ask: i.quote.ask, fill, stopPrem, primTarget, rr: q.rr,
    und: i.und, spot0: i.spot, createdAt: i.now, score: conf.score, label: conf.label, components: conf.components, vetoes: conf.vetoes,
    pTouch, mode, eligible, reason, sizing, overnightOk, reasons: i.reasons,
    text: { title: `${i.ticker} ${type === 'call' ? 'Call' : 'Put'} ${i.pick.strike} · ${i.setup}`, body },
    delayedMin: i.delayedMin, barAgeSec: i.barAgeSec, chainAgeSec: i.chainAgeSec,
    regimeVwap: i.regime.vwapAll, regimeOr: i.regime.orAll,
    qual: i.qual ?? null,
  };
}
