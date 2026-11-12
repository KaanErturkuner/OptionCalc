/* Türkçe sayı biçimlendirme (1.234,56) — Intl'e bağımlı değil, iOS/Android/web'de aynı sonuç */
export function fmt(x: number, d = 2): string {
  if (!isFinite(x)) return '—';
  const neg = x < 0, s = Math.abs(x).toFixed(d);
  const [i, f] = s.split('.');
  const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const out = f ? g + ',' + f : g;
  return (neg && /[1-9]/.test(out) ? '-' : '') + out;
}
export const num = fmt;
export function usd(x: number, d = 2, sign = false): string {
  if (x === Infinity || x === -Infinity) return 'Sınırsız';
  if (!isFinite(x)) return '—';
  const s = sign && x > 0.005 ? '+' : (x < -0.005 ? '−' : '');
  return s + fmt(Math.abs(x), d) + ' $';
}
export function pct(x: number, d = 1): string {
  if (!isFinite(x)) return '—';
  return (x > 0.0005 ? '+' : x < -0.0005 ? '−' : '') + fmt(Math.abs(x * 100), d) + '%';
}
/** "1.234,5" / "1234.5" / "12,5 $" → sayı */
export function parseNum(v: string | number | null | undefined): number {
  if (v == null) return NaN;
  let s = String(v).trim().replace(/\s|\$|%/g, '');
  if (s === '') return NaN;
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(',', '.');
  return Number(s);
}
/** Düzenleme kutusu için: gruplama yok, virgül ondalık */
export function editStr(x: number | null | undefined, d = 6): string {
  if (x == null || !isFinite(x)) return '';
  return String(+x.toFixed(d)).replace('.', ',');
}
export const trDate = (s: string) => { const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; };
export const shortDate = (s: string) => { const [, m, d] = s.split('-'); return `${d}.${m}`; };
/** "13.11.2026" veya "2026-11-13" → "2026-11-13" (geçersizse null) */
export function parseTrDate(s: string): string | null {
  const t = s.trim();
  let y: number, m: number, d: number;
  let mm = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (mm) { d = +mm[1]; m = +mm[2]; y = +mm[3]; }
  else if ((mm = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
export function compact(v: number): string {
  const a = Math.abs(v);
  const s = a >= 1e6 ? fmt(a / 1e6, 1) + 'M' : a >= 1e4 ? fmt(a / 1e3, 0) + 'B' : fmt(a, 0);
  return (v < 0 ? '−' : '') + s;
}
export function niceTicks(a: number, b: number, n: number): number[] {
  const span = b - a, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
