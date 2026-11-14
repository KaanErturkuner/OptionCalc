/* Bilanço detay grafikleri (react-native-svg; yeni bağımlılık yok). Veri: src/lib/earnings/charts.ts ve model.ts.
 * EarnChainChart: strike çubukları (call sağda yeşil, put solda kırmızı), spot çizgisi, ATM straddle beklenen hareket bandı.
 * EarnFlowChart: gün bazında call (yukarı) / put (aşağı) prim. EarnEpsChart: çeyrek başına beklenti ve gerçek EPS + sürpriz. */
import { Text, View } from 'react-native';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';
import { compact } from '@/lib/format';
import { C } from './theme';
import type { StrikeRow, Metric } from '@/lib/radar/detail';
import type { ImpliedMove, DayPrem } from '@/lib/earnings/charts';
import type { EarnHistoryRow } from '@/lib/earnings/model';
import { fmtSurprise, surpriseTone } from '@/lib/earnings/calendar';

const toneColor = (x: number | null) => (surpriseTone(x) === 'pos' ? C.pos : surpriseTone(x) === 'neg' ? C.neg : C.muted);
const fmtK = (k: number) => (k % 1 ? k.toFixed(1) : k.toFixed(0)).replace('.', ',');
const RH = 13, LBL = 46, PAD = 14;

/** Strike çubukları. rows artan sırada gelir; grafikte en yüksek strike üstte. */
export function EarnChainChart({ rows, metric, spot, move, width }: { rows: StrikeRow[]; metric: Metric; spot: number; move: ImpliedMove | null; width: number }) {
  const desc = [...rows].sort((a, b) => b.k - a.k);
  if (!desc.length) return <Text style={{ color: C.muted, fontSize: 13 }}>Bu aralıkta strike yok.</Text>;
  const W = Math.max(width, 220), H = desc.length * RH + PAD * 2, cx = W / 2;
  const barMax = W / 2 - LBL / 2 - 6;
  const vmax = Math.max(1, ...desc.map(r => (metric === 'oi' ? Math.max(r.callOi, r.putOi) : Math.max(r.callVol, r.putVol))));
  const yOf = (p: number): number => {
    if (p >= desc[0].k) return PAD;
    if (p <= desc[desc.length - 1].k) return PAD + (desc.length - 1) * RH;
    for (let i = 0; i < desc.length - 1; i++) {
      const hi = desc[i].k, lo = desc[i + 1].k;
      if (p <= hi && p >= lo) return PAD + (i + (hi - p) / (hi - lo || 1)) * RH;
    }
    return PAD;
  };
  const bh = RH * 0.7;
  const band = move ? { y1: yOf(move.hi), y2: yOf(move.lo) } : null;
  return (
    <View>
      <Svg width={W} height={H}>
        {band ? <Rect x={0} y={band.y1} width={W} height={Math.max(2, band.y2 - band.y1)} fill={C.blue} fillOpacity={0.12} /> : null}
        {desc.map((r, i) => {
          const y = PAD + i * RH + (RH - bh) / 2;
          const cv = metric === 'oi' ? r.callOi : r.callVol, pv = metric === 'oi' ? r.putOi : r.putVol;
          const cw = (cv / vmax) * barMax, pw = (pv / vmax) * barMax;
          return (
            <G key={r.k}>
              {cw > 0 ? <Rect x={cx + LBL / 2} y={y} width={cw} height={bh} fill={C.pos} fillOpacity={0.85} /> : null}
              {pw > 0 ? <Rect x={cx - LBL / 2 - pw} y={y} width={pw} height={bh} fill={C.neg} fillOpacity={0.85} /> : null}
              <SvgText x={cx} y={PAD + i * RH + RH - 3} fontSize={10} fill={Math.abs(r.k - spot) === Math.min(...desc.map(d => Math.abs(d.k - spot))) ? C.text : C.muted} textAnchor="middle">{fmtK(r.k)}</SvgText>
            </G>
          );
        })}
        <Line x1={0} x2={W} y1={yOf(spot)} y2={yOf(spot)} stroke={C.text} strokeWidth={1} strokeDasharray="3 3" />
        {band ? <SvgText x={W - 4} y={band.y1 - 3} fontSize={9} fill={C.blue} textAnchor="end">+{move ? move.pct.toFixed(1).replace('.', ',') : ''}%</SvgText> : null}
        <SvgText x={4} y={H - 3} fontSize={9} fill={C.neg}>◀ put</SvgText>
        <SvgText x={W - 4} y={H - 3} fontSize={9} fill={C.pos} textAnchor="end">call ▶ {compact(vmax)}</SvgText>
      </Svg>
    </View>
  );
}

/** Gün bazında call / put primi: üstte call (yeşil), altta put (kırmızı); ortak ölçek. */
export function EarnFlowChart({ data, width }: { data: DayPrem[]; width: number }) {
  if (!data.length) return <Text style={{ color: C.muted, fontSize: 13 }}>Son 5 günde olağandışı akış yok.</Text>;
  const H = 150, W = Math.max(width, 220), top = 14, bottom = H - 18, mid = (top + bottom) / 2;
  const vmax = Math.max(1, ...data.map(d => Math.max(d.call, d.put)));
  const slot = W / data.length, bw = Math.min(28, slot * 0.5);
  const half = (bottom - top) / 2 - 2;
  return (
    <Svg width={W} height={H}>
      <Line x1={0} x2={W} y1={mid} y2={mid} stroke={C.border} strokeWidth={1} />
      {data.map((d, i) => {
        const x = i * slot + (slot - bw) / 2;
        const ch = (d.call / vmax) * half, ph = (d.put / vmax) * half;
        return (
          <G key={d.day}>
            {ch > 0 ? <Rect x={x} y={mid - ch} width={bw} height={ch} fill={C.pos} fillOpacity={0.85} /> : null}
            {ph > 0 ? <Rect x={x} y={mid} width={bw} height={ph} fill={C.neg} fillOpacity={0.85} /> : null}
            <SvgText x={x + bw / 2} y={H - 4} fontSize={10} fill={C.muted} textAnchor="middle">{dayShort(d.day)}</SvgText>
          </G>
        );
      })}
      <SvgText x={4} y={top} fontSize={9} fill={C.pos}>call ${compact(vmax)}</SvgText>
      <SvgText x={4} y={bottom} fontSize={9} fill={C.neg}>put</SvgText>
    </Svg>
  );
}
const dayShort = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('tr-TR', { timeZone: 'UTC', day: '2-digit', month: 'short' });

/** Çeyrek başına beklenti (gri çubuk) ve gerçek EPS (mavi; beklentiyi geçtiyse yeşil, altındaysa kırmızı) + sürpriz etiketi. */
export function EarnEpsChart({ rows, width }: { rows: EarnHistoryRow[]; width: number }) {
  const data = rows.filter(r => r.epsEstimate != null || r.epsActual != null);
  if (!data.length) return <Text style={{ color: C.muted, fontSize: 13 }}>Geçmiş bilanço verisi yok.</Text>;
  const H = 170, W = Math.max(width, 220), top = 24, bottom = H - 22;
  const vals = data.flatMap(r => [r.epsEstimate ?? 0, r.epsActual ?? 0]);
  const hi = Math.max(0, ...vals), lo = Math.min(0, ...vals), span = hi - lo || 1;
  const y = (v: number) => top + ((hi - v) / span) * (bottom - top);
  const zero = y(0);
  const slot = W / data.length, bw = Math.min(12, slot * 0.32);
  return (
    <Svg width={W} height={H}>
      <Line x1={0} x2={W} y1={zero} y2={zero} stroke={C.border} strokeWidth={1} />
      {data.map((r, i) => {
        const cx = i * slot + slot / 2;
        const est = r.epsEstimate, act = r.epsActual;
        const beat = est != null && act != null ? act >= est : null;
        const bars = [
          { v: est, x: cx - bw - 1, fill: C.muted },
          { v: act, x: cx + 1, fill: beat == null ? C.blue : beat ? C.pos : C.neg },
        ];
        const label = r.quarter && r.year ? `Ç${r.quarter}'${String(r.year).slice(2)}` : r.period.slice(0, 7);
        const sur = fmtSurprise(r.surprisePct);
        return (
          <G key={r.period}>
            {bars.map((b, k) => (b.v == null ? null : (
              <Rect key={k} x={b.x} y={Math.min(y(b.v), zero)} width={bw} height={Math.max(1, Math.abs(y(b.v) - zero))} fill={b.fill} fillOpacity={k === 0 ? 0.5 : 0.9} />
            )))}
            {sur ? <SvgText x={cx} y={top - 8} fontSize={9} fill={toneColor(r.surprisePct)} textAnchor="middle">{sur}</SvgText> : null}
            <SvgText x={cx} y={H - 6} fontSize={9} fill={C.muted} textAnchor="middle">{label}</SvgText>
          </G>
        );
      })}
    </Svg>
  );
}
