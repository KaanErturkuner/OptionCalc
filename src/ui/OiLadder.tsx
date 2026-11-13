/* Radar hisse detayı: dikey merdiven (ladder). Strike'lar yukarıdan aşağıya (en yüksek üstte), ortada strike etiketi;
 * call çubukları sağa (yeşil), put çubukları sola (kırmızı), en büyük çubuğa göre ölçek.
 * Yatay işaret çizgileri: spot, call/put duvarı, gamma flip, max pain (kesirli satır = strike'lar arası enterpolasyon).
 * Dikey kaydırılabilir; açılışta ve OI/Hacim geçişinde spot satırına kayar. react-native-svg; yeni bağımlılık yok.
 * Veri ve geometri: src/lib/radar/detail.ts */
import { useEffect, useMemo, useRef, type ElementRef } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';
import { compact } from '@/lib/format';
import { C } from './theme';
import {
  LADDER, ladderHeight, ladderOrder, markerFracs, metricMax, nearestIndex, rowY, scrollTargetY,
  type Markers, type Metric, type StrikeRow,
} from '@/lib/radar/detail';

const VIEW_H = 420, LBL_W = 56, GAP = 3, EDGE = 6;
const fmtK = (k: number) => (k % 1 ? k.toFixed(1) : k.toFixed(0)).replace('.', ',');

/** İşaret çizgisi görünümü (renkler legend ile aynı) */
const LINE: Record<keyof Markers, { color: string; dash: boolean; width: number }> = {
  spot: { color: C.text, dash: false, width: 1.5 },
  callWall: { color: C.pos, dash: true, width: 1.2 },
  putWall: { color: C.neg, dash: true, width: 1.2 },
  flip: { color: C.warn, dash: true, width: 1.2 },
  maxPain: { color: C.blue, dash: true, width: 1.2 },
};

export default function OiLadder({ rows, metric, marks, width, spot }: { rows: StrikeRow[]; metric: Metric; marks: Markers; width: number; spot: number | null }) {
  const scroll = useRef<ElementRef<typeof ScrollView>>(null);
  const desc = useMemo(() => ladderOrder(rows), [rows]);
  const fr = useMemo(() => markerFracs(marks, desc), [marks, desc]);

  // Açılışta ve OI ⇄ Hacim geçişinde spot satırına kaydır (çizim bittikten sonra)
  useEffect(() => {
    if (spot == null || !desc.length) return;
    const y = scrollTargetY(desc, spot, VIEW_H);
    const t = setTimeout(() => scroll.current?.scrollTo({ y, animated: false }), 0);
    return () => clearTimeout(t);
  }, [desc, spot, metric]);

  if (!desc.length) return <View style={{ height: VIEW_H, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.muted }}>Bu aralıkta strike yok.</Text></View>;

  const W = Math.max(width, 240), H = ladderHeight(desc.length), cx = W / 2;
  const vmax = metricMax(desc, metric) || 1;
  const barMax = W / 2 - LBL_W / 2 - GAP - EDGE;
  const bh = LADDER.rowH * 0.72, labelEdgeL = cx - LBL_W / 2, labelEdgeR = cx + LBL_W / 2;
  const near = nearestIndex(desc, spot ?? NaN);

  return (
    <ScrollView ref={scroll} style={{ height: VIEW_H }} nestedScrollEnabled showsVerticalScrollIndicator>
      <Svg width={W} height={H}>
        {/* Başlık: put solda, call sağda, ortada strike */}
        <SvgText x={EDGE} y={LADDER.top - 8} fontSize={10} fill={C.neg}>◀ Put</SvgText>
        <SvgText x={cx} y={LADDER.top - 8} fontSize={10} fill={C.muted} textAnchor="middle">Strike</SvgText>
        <SvgText x={W - EDGE} y={LADDER.top - 8} fontSize={10} fill={C.pos} textAnchor="end">Call ▶</SvgText>

        {desc.map((r, i) => {
          const y = LADDER.top + i * LADDER.rowH + (LADDER.rowH - bh) / 2;
          const cv = metric === 'oi' ? r.callOi : r.callVol, pv = metric === 'oi' ? r.putOi : r.putVol;
          const cw = (cv / vmax) * barMax, pw = (pv / vmax) * barMax;
          return (
            <G key={r.k}>
              {cw > 0 ? <Rect x={labelEdgeR + GAP} y={y} width={cw} height={bh} fill={C.pos} fillOpacity={0.85} /> : null}
              {pw > 0 ? <Rect x={labelEdgeL - GAP - pw} y={y} width={pw} height={bh} fill={C.neg} fillOpacity={0.85} /> : null}
            </G>
          );
        })}

        {/* İşaret çizgileri: strike etiketi sütunu boş kalsın diye iki parçaya bölünür */}
        {fr.map(({ key, f }) => {
          if (f == null) return null;
          const y = rowY(f), st = LINE[key];
          const dash = st.dash ? '4 3' : undefined;
          return (
            <G key={key}>
              <Line x1={EDGE} x2={labelEdgeL - 2} y1={y} y2={y} stroke={st.color} strokeWidth={st.width} strokeDasharray={dash} />
              <Line x1={labelEdgeR + 2} x2={W - EDGE} y1={y} y2={y} stroke={st.color} strokeWidth={st.width} strokeDasharray={dash} />
            </G>
          );
        })}

        {desc.map((r, i) => (
          <SvgText key={'t' + r.k} x={cx} y={rowY(i) + 4} fontSize={11} fill={i === near ? C.text : C.muted}
            fontWeight={i === near ? '700' : '400'} textAnchor="middle">{fmtK(r.k)}</SvgText>
        ))}
        <SvgText x={W - EDGE} y={H - 2} fontSize={10} fill={C.muted} textAnchor="end">ölçek {compact(vmax)}</SvgText>
      </Svg>
    </ScrollView>
  );
}
