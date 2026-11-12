import { useMemo, useState } from 'react';
import { Platform, View, Text, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G as SG, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import * as St from '@/lib/strategy';
import type { Analysis } from '@/lib/strategy';
import { G, type AppState } from '@/lib/state';
import { compact, niceTicks, num, pct, shortDate, usd } from '@/lib/format';
import { C } from './theme';

interface Props {
  state: AppState; an: Analysis; width: number; range: [number, number]; scnD: string;
  onPickTarget: (S: number) => void; onScrubbing?: (on: boolean) => void;
}
const FF = Platform.OS === 'web' ? 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' : undefined;
const H = 300, L = 50, R = 10, Tp = 14, B = 28;

export default function Chart({ state, an, width, range, scnD, onPickTarget, onScrubbing }: Props) {
  const [hx, setHx] = useState<number | null>(null);
  const W = Math.max(width, 200), pw = W - L - R, ph = H - Tp - B;
  const [lo, hi] = range;
  const g = G(state), exp = an.expiry, iv = state.scn.ivShift;
  const showS = !(scnD === exp && !iv);

  const geo = useMemo(() => {
    const N = 160, xs: number[] = [], ye: number[] = [], ys: number[] = [];
    for (let i = 0; i <= N; i++) {
      const S = lo + (hi - lo) * i / N; xs.push(S);
      ye.push(St.pnl(state.legs, g, S, exp, 0));
      ys.push(showS ? St.pnl(state.legs, g, S, scnD, iv) : 0);
    }
    let ymin = Math.min(...ye, ...(showS ? ys : []), 0), ymax = Math.max(...ye, ...(showS ? ys : []), 0);
    if (ymax - ymin < 1) { ymax += 1; ymin -= 1; }
    const pad = (ymax - ymin) * 0.1; ymin -= pad; ymax += pad;
    const X = (S: number) => L + (S - lo) / (hi - lo) * pw, Y = (v: number) => Tp + (ymax - v) / (ymax - ymin) * ph;
    const line = (arr: number[]) => xs.map((S, i) => `${i ? 'L' : 'M'}${X(S).toFixed(1)},${Y(arr[i]).toFixed(1)}`).join('');
    const area = `M${X(xs[0])},${Y(0)}` + xs.map((S, i) => `L${X(S).toFixed(1)},${Y(ye[i]).toFixed(1)}`).join('') + `L${X(xs[N])},${Y(0)}Z`;
    return { xs, ye, ys, X, Y, ymin, ymax, lineE: line(ye), lineS: showS ? line(ys) : '', area };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.legs, state.S, state.r, state.q, state.today, lo, hi, scnD, iv, pw, ph, exp, showS]);

  const { X, Y, ymin, ymax } = geo;
  const y0 = Math.min(Math.max(Y(0), Tp), Tp + ph);
  const ny = niceTicks(ymin, ymax, 6), nx = niceTicks(lo, hi, Math.max(3, Math.round(pw / 80)));
  const priceAt = (x: number) => lo + (Math.min(Math.max(x, L), L + pw) - L) / pw * (hi - lo);

  const onMove = (e: GestureResponderEvent) => setHx(e.nativeEvent.locationX);
  const vline = (S: number, color: string, label: string, dash: string, dy = 0) => {
    if (S < lo || S > hi) return null;
    const x = X(S), lx = Math.min(Math.max(x, L + 36), W - R - 36);
    return (
      <SG key={label}>
        <Line x1={x} y1={Tp} x2={x} y2={Tp + ph} stroke={color} strokeWidth={1} strokeDasharray={dash} />
        <SvgText fontFamily={FF} x={lx} y={Tp + 10 + dy} fill={color} fontSize={11} fontWeight="600" textAnchor="middle">{label}</SvgText>
      </SG>
    );
  };

  let tip: React.ReactNode = null;
  if (hx != null) {
    const S = priceAt(hx), x = X(S), pe = St.pnl(state.legs, g, S, exp, 0), ps = St.pnl(state.legs, g, S, scnD, iv);
    tip = (
      <>
        <Line x1={x} y1={Tp} x2={x} y2={Tp + ph} stroke="rgba(230,235,245,.45)" strokeWidth={1} />
        <Circle cx={x} cy={Y(pe)} r={5} fill={C.text} />
        {showS ? <Circle cx={x} cy={Y(ps)} r={5} fill={C.blue} /> : null}
      </>
    );
  }
  const hoverInfo = hx != null ? (() => {
    const S = priceAt(hx), pe = St.pnl(state.legs, g, S, exp, 0), ps = St.pnl(state.legs, g, S, scnD, iv);
    return { S, pe, ps };
  })() : null;

  return (
    <View>
      <View style={{ height: 40, justifyContent: 'center' }}>
        {hoverInfo ? (
          <Text style={{ color: C.text, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
            {num(hoverInfo.S, 2)} $ <Text style={{ color: C.muted, fontWeight: '500' }}>({pct(hoverInfo.S / state.S - 1)})</Text>
            {'  '}<Text style={{ color: hoverInfo.pe >= 0 ? C.pos : C.neg }}>Vade {usd(hoverInfo.pe, 0, true)}</Text>
            {showS ? <Text style={{ color: C.blue }}>{'  '}{shortDate(scnD)} {usd(hoverInfo.ps, 0, true)}</Text> : null}
          </Text>
        ) : (
          <Text style={{ color: C.muted, fontSize: 13 }}>Parmağını grafikte gezdir · bırakınca o fiyat hedef olur</Text>
        )}
      </View>
      <View
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={e => { onScrubbing?.(true); onMove(e); }}
        onResponderMove={onMove}
        onResponderRelease={e => {
          const S = priceAt(e.nativeEvent.locationX); setHx(null); onScrubbing?.(false);
          if (S > 0) onPickTarget(+S.toFixed(2));
        }}
        onResponderTerminate={() => { setHx(null); onScrubbing?.(false); }}
      >
        <Svg width={W} height={H} pointerEvents="none">
          <Defs>
            <ClipPath id="up"><Rect x={L} y={Tp} width={pw} height={Math.max(y0 - Tp, 0)} /></ClipPath>
            <ClipPath id="dn"><Rect x={L} y={y0} width={pw} height={Math.max(Tp + ph - y0, 0)} /></ClipPath>
          </Defs>
          {an.expectedMove > 0 ? (() => {
            const a = X(Math.max(state.S - an.expectedMove, lo)), b = X(Math.min(state.S + an.expectedMove, hi));
            return b > a ? <Rect x={a} y={Tp} width={b - a} height={ph} fill="rgba(139,151,173,.09)" /> : null;
          })() : null}
          {ny.map(v => (
            <SG key={'y' + v}>
              <Line x1={L} y1={Y(v)} x2={W - R} y2={Y(v)} stroke="#1e2840" strokeWidth={1} />
              <SvgText fontFamily={FF} x={L - 6} y={Y(v) + 4} fill={C.muted} fontSize={10.5} textAnchor="end">{compact(v)}</SvgText>
            </SG>
          ))}
          {nx.map(v => (
            <SG key={'x' + v}>
              <Line x1={X(v)} y1={Tp} x2={X(v)} y2={Tp + ph} stroke="#1e2840" strokeWidth={1} />
              <SvgText fontFamily={FF} x={X(v)} y={H - 9} fill={C.muted} fontSize={10.5} textAnchor="middle">{num(v, v < 10 ? 1 : 0)}</SvgText>
            </SG>
          ))}
          <Line x1={L} y1={Y(0)} x2={W - R} y2={Y(0)} stroke="#5b6680" strokeWidth={1} />
          <Path d={geo.area} fill="rgba(34,197,94,.24)" clipPath="url(#up)" />
          <Path d={geo.area} fill="rgba(239,68,68,.24)" clipPath="url(#dn)" />
          <Path d={geo.lineE} stroke={C.text} strokeWidth={2} fill="none" />
          {showS ? <Path d={geo.lineS} stroke={C.blue} strokeWidth={2.2} fill="none" /> : null}
          {vline(state.S, '#cbd5e1', 'Şimdi ' + num(state.S, 2), '4,4')}
          {vline(state.scn.target, C.warn, 'Hedef ' + num(state.scn.target, 2), '2,3', Math.abs(X(state.scn.target) - X(state.S)) < 80 ? 14 : 0)}
          {an.breakevens.filter(b => b >= lo && b <= hi).map(b => <Circle key={'be' + b} cx={X(b)} cy={Y(0)} r={4} fill={C.warn} />)}
          {tip}
        </Svg>
      </View>
    </View>
  );
}
