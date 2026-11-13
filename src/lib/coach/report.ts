/*
 * Rapor birleştirme (saf): sayılar (kod) + model yorumu → TradeReport. Brüt/net P/L burada: komisyon $1,50 / kontrat / yön
 * (giriş + çıkış = 3,00 $ / kontrat). Emoji ve pencere/DTE burada; model bunları yazmaz.
 */
import { dteOf, inEntryWindowIst, istToMs } from './time.ts';
import type { Emoji, ExtractedTrade, ModelFeedback, RuleFact, TradeReport } from './types.ts';
import type { TradeNumbers } from './context.ts';

export const FEE_PER_CONTRACT_SIDE = 1.5;   // USD, Midas
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Brüt ve net P/L (dolar). Kapalı değilse / veri yoksa null. */
export function pnlOf(t: Pick<ExtractedTrade, 'entryPrice' | 'exitPrice' | 'qty' | 'status'>): { gross: number | null; fees: number | null; net: number | null } {
  if (t.status !== 'kapali' || t.entryPrice == null || t.exitPrice == null || t.qty == null) return { gross: null, fees: null, net: null };
  const gross = r2((t.exitPrice - t.entryPrice) * 100 * t.qty);
  const fees = r2(2 * FEE_PER_CONTRACT_SIDE * t.qty);
  return { gross, fees, net: r2(gross - fees) };
}

export const EMOJI_CIKIS: Record<ModelFeedback['cikis']['karar'], Emoji> = { dogru: '✅', erken: '⚠️', yanlis: '❌', belirsiz: '❔' };
export const EMOJI_GIRIS: Record<ModelFeedback['giris']['karar'], Emoji> = { iyi: '✅', kovalama: '⚠️', riskli: '❌', belirsiz: '❔' };
export const EMOJI_STRIKE: Record<ModelFeedback['strike']['karar'], Emoji> = { uygun: '✅', yakin: '⚠️', uzak: '⚠️', belirsiz: '❔' };

export function buildReport(a: {
  trade: ExtractedTrade; nums: TradeNumbers; rules: RuleFact[]; noData: string[]; model: string; feedback: ModelFeedback;
}): TradeReport {
  const { trade: t, nums: n, feedback: f } = a;
  const entryMs = istToMs(t.entryTime);
  const day = t.entryTime ? t.entryTime.slice(0, 10) : null;
  const pnl = pnlOf(t);
  const pencere = entryMs == null ? 'bilinmiyor' : inEntryWindowIst(entryMs) ? 'icinde' : 'disinda';
  return {
    header: {
      ticker: t.ticker, strike: t.strike, side: t.side === 'CALL' ? 'C' : 'P', expiry: t.expiry,
      dte: day ? dteOf(t.expiry, day) : null,
      entryIst: t.entryTime, entryPrice: t.entryPrice, exitIst: t.exitTime, exitPrice: t.exitPrice,
      qty: t.qty, status: t.status, grossPnl: pnl.gross, fees: pnl.fees, netPnl: pnl.net,
    },
    neOldu: {
      oncesi: f.neOldu.oncesi, sirasinda: f.neOldu.sirasinda, sonrasi: f.neOldu.sonrasi,
      sayilar: {
        sBefore15dk: n.sBefore, sEntry: n.sEntry, sExit: n.sExit,
        holdHigh: n.holdHigh, holdLow: n.holdLow, afterFavPct: n.afterFavPct, afterAgainstPct: n.afterAgainstPct,
        afterAt15Pct: n.afterAt15, afterAt30Pct: n.afterAt30, afterAt60Pct: n.afterAt60,
      },
    },
    cikis: { emoji: EMOJI_CIKIS[f.cikis.karar], karar: f.cikis.karar, neden: f.cikis.neden },
    giris: { emoji: EMOJI_GIRIS[f.giris.karar], karar: f.giris.karar, neden: f.giris.neden, vwapUzaklikPct: n.vwapDistPct, pencere },
    strike: { emoji: EMOJI_STRIKE[f.strike.karar], karar: f.strike.karar, neden: f.strike.neden, otmPct: n.otmPct, otmPerEm: n.otmPerEm },
    kacanFirsat: {
      lehePctTutarken: n.holdFavPct, lehePctSonra: n.afterFavPct,
      optTutarkenTahmini: n.optHoldFav, optSonraTahmini: n.optAfterFav, etiket: 'tahmini', yorum: f.kacanFirsatYorum,
    },
    birDahakine: [...f.birDahakine],
    karne: f.karne,
    rules: a.rules, noData: a.noData, model: a.model,
  };
}

