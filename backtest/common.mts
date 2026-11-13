import { isTradingDay, addDaysStr } from '../src/lib/usmarket.ts';
export const TICKERS = ['QQQ', 'MU', 'AXTI', 'AAOI', 'MRVL', 'GLW', 'NBIS', 'CRWV', 'DRAM', 'AMD', 'INTC', 'SPCX', 'NVDA', 'TSLA', 'RKLB', 'SPY', 'IWM', 'GLD', 'SLV'];
export const START = process.env.BT_START || '2025-11-14', END = process.env.BT_END || '2026-11-11';
export function tradingDays(a = START, b = END): string[] { const out: string[] = []; for (let d = a; d <= b; d = addDaysStr(d, 1)) if (isTradingDay(d)) out.push(d); return out; }
export { addDaysStr };
