/* Strike başına OI / hacim çubukları: call yukarı (yeşil), put aşağı (kırmızı). Dikey çizgiler: spot, call/put duvarı, gamma flip, max pain.
 * react-native-svg; yeni bağımlılık yok. Veri hazır: bkz. src/lib/radar/detail.ts */
import { Text, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { compact } from '@/lib/format';
import { C } from './theme';
import type { Markers, Metric, StrikeRow } from '@/lib/radar/detail';
import { metricMax, inRange } from '@/lib/radar/detail';

const H = 260, L = 10, R = 10, T = 14, B = 24;
const fmtK = (k: number) => (k % 1 ? k.toFixed(1) : k.toFixed(0)).replace('.', ',');

export default function OiChart({ rows, metric, marks, width }: { rows: StrikeRow[]; metric: Metric; marks: Markers; width: number }) {
  const W = Math.max(width, 200), pw = W - L - R, ph = H - T - B, y0 = T + ph / 2, half = ph / 2 - 6;
  if (!rows.length) return <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.muted }}>Bu aralıkta strike yok.</Text></View>;
  const kmin = rows[0].k, kmax = rows[rows.length - 1].k, span = kmax - kmin || 1;
  const X = (k: number) => L + ((k - kmin) / span) * pw;
  const vmax = metricMax(rows, metric) || 1;
  const bw = Math.max(2, Math.min(16, (pw / rows.length) * 0.7));
  const every = Math.max(1, Math.ceil(rows.length / 6));
  const lines: { v: number | null; color: string; dash: boolean }[] = [
    { v: marks.spot, color: C.text, dash: false },
    { v: marks.callWall, color: C.pos, dash: true },
    { v: marks.putWall, color: C.neg, dash: true },
    { v: marks.flip, color: C.warn, dash: true },
    { v: marks.maxPain, color: C.blue, dash: true },
  ];
  return (
    <Svg width={W} height={H}>
      <Line x1={L} x2={W - R} y1={y0} y2={y0} stroke={C.border} strokeWidth={1} />
      {rows.map((r, i) => {
        const cv = metric === 'oi' ? r.callOi : r.callVol;
        const h = (cv / vmax) * half;
        return <Rect key={i} x={X(r.k) - bw / 2} width={bw} y={y0 - h} height={Math.max(0, h)} fill={C.pos} fillOpacity={0.85} />;
      })}
      {rows.map((r, i) => {
        const pv = metric === 'oi' ? r.putOi : r.putVol;
        const h = (pv / vmax) * half;
        return <Rect key={'p' + i} x={X(r.k) - bw / 2} width={bw} y={y0} height={Math.max(0, h)} fill={C.neg} fillOpacity={0.85} />;
      })}
      {lines.map((ln, i) => inRange(ln.v, rows) ? (
        <Line key={i} x1={X(ln.v as number)} x2={X(ln.v as number)} y1={T} y2={H - B} stroke={ln.color}
          strokeWidth={ln.color === C.text ? 1.5 : 1.2} strokeDasharray={ln.dash ? '4 3' : undefined} />
      ) : null)}
      {rows.map((r, i) => i % every === 0 ? (
        <SvgText key={'t' + i} x={X(r.k)} y={H - 7} fontSize={10} fill={C.muted} textAnchor="middle">{fmtK(r.k)}</SvgText>
      ) : null)}
      <SvgText x={L} y={T - 3} fontSize={10} fill={C.muted}>{compact(vmax)}</SvgText>
    </Svg>
  );
}
