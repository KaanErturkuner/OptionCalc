import { memo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import * as St from '@/lib/strategy';
import type { Analysis } from '@/lib/strategy';
import { G, type AppState } from '@/lib/state';
import { num, pct, shortDate, usd } from '@/lib/format';
import { C } from './theme';

const CW = 62, RH = 34, LW = 78;

function Heatmap({ state, an, range, scnD, onPick }: {
  state: AppState; an: Analysis; range: [number, number]; scnD: string; onPick: (S: number, d: string) => void;
}) {
  const g = G(state), iv = state.scn.ivShift, [lo, hi] = range, pb = St.pctBase(an);
  const total = Math.max(St.daysBetween(state.today, an.expiry), 0);
  const nCols = Math.min(total + 1, 8), dates: string[] = [];
  for (let i = 0; i < nCols; i++) dates.push(St.addDays(state.today, nCols === 1 ? 0 : Math.round(total * i / (nCols - 1))));
  if (!dates.includes(scnD)) { dates.push(scnD); dates.sort(); }
  const step0 = (hi - lo) / 16, mag = Math.pow(10, Math.floor(Math.log10(step0))), f = step0 / mag;
  const step = (f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7 ? 5 : 10) * mag;
  const prices: number[] = [];
  for (let p = Math.ceil(hi / step) * step; p >= lo - 1e-9; p -= step) prices.push(+p.toFixed(6));
  [state.S, state.scn.target].forEach(x => { if (!prices.some(p => Math.abs(p - x) < 1e-6)) prices.push(x); });
  prices.sort((a, b) => b - a);
  const cells = prices.map(S => dates.map(d => { const v = St.value(state.legs, g, S, d, iv); return { v, pl: v - an.cost }; }));
  const maxAbs = Math.max(...cells.flat().map(c => Math.abs(c.pl)), 1);
  const u = state.unit;

  return (
    <View style={{ flexDirection: 'row' }}>
      <View style={{ width: LW }}>
        <View style={{ height: RH + 6, justifyContent: 'center' }}><Text style={{ color: C.muted, fontSize: 11 }}>Hisse \ Tarih</Text></View>
        {prices.map(S => {
          const cur = Math.abs(S - state.S) < 1e-6, tgt = Math.abs(S - state.scn.target) < 1e-6;
          return (
            <View key={'p' + S} style={{ height: RH, justifyContent: 'center', borderLeftWidth: 3, paddingLeft: 5,
              borderLeftColor: cur ? C.text : tgt ? C.warn : 'transparent' }}>
              <Text style={{ color: C.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{num(S, 2)}</Text>
              <Text style={{ color: tgt ? C.warn : C.muted, fontSize: 10 }}>{pct(S / state.S - 1, 0)}{cur ? ' şimdi' : tgt ? ' hedef' : ''}</Text>
            </View>
          );
        })}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={{ flexDirection: 'row', height: RH + 6 }}>
            {dates.map(d => (
              <View key={'d' + d} style={{ width: CW, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: d === scnD ? C.warn : C.text, fontSize: 12, fontWeight: '700' }}>{shortDate(d)}</Text>
                <Text style={{ color: C.muted, fontSize: 10 }}>{St.daysBetween(state.today, d)}g</Text>
              </View>
            ))}
          </View>
          {prices.map((S, i) => (
            <View key={'r' + S} style={{ flexDirection: 'row' }}>
              {cells[i].map((c, j) => {
                const a = Math.min(Math.abs(c.pl) / maxAbs, 1) * 0.75 + 0.06;
                const bg = c.pl > 0.005 ? `rgba(34,197,94,${a})` : c.pl < -0.005 ? `rgba(239,68,68,${a})` : 'transparent';
                const t = u === 'usd' ? usd(c.pl, 0, true).replace(' $', '') : u === 'pct' ? pct(c.pl / pb.base, 0) : num(c.v, 0);
                const sel = Math.abs(S - state.scn.target) < 1e-6 && dates[j] === scnD;
                return (
                  <Pressable key={dates[j]} onPress={() => onPick(S, dates[j])}
                    style={{ width: CW, height: RH, backgroundColor: bg, alignItems: 'center', justifyContent: 'center',
                      borderWidth: sel ? 2 : 0.5, borderColor: sel ? C.warn : C.bg }}>
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>{t}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
export default memo(Heatmap);
