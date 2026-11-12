import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { around, mid, type Chain, type OptQuote } from '@/lib/market';
import { num } from '@/lib/format';
import { tap } from './controls';
import { C } from './theme';

/** Kompakt zincir seçici: spot çevresi strike'lar; dokununca strike + mid prim + IV */
function ChainPicker({ chain, type, strike, spot, onPick }: {
  chain: Chain; type: 'call' | 'put'; strike: number; spot: number; onPick: (o: OptQuote) => void;
}) {
  const list = type === 'call' ? chain.calls : chain.puts;
  const rows = around(list, strike, 6);
  if (!rows.length) return <Text style={{ color: C.muted, marginTop: 8 }}>Bu vade için kontrat yok.</Text>;
  const atm = rows.reduce((a, b) => Math.abs(b.strike - spot) < Math.abs(a.strike - spot) ? b : a);
  return (
    <View style={{ marginTop: 10, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: C.border }}>
      <View style={[st.row, { backgroundColor: C.input }]}>
        <Text style={[st.h, { flex: 1.1 }]}>Strike</Text>
        <Text style={[st.h, { flex: 1.6 }]}>Bid / Ask</Text>
        <Text style={[st.h, { flex: 1 }]}>Mid</Text>
        <Text style={[st.h, { flex: 0.9 }]}>IV</Text>
        <Text style={[st.h, { flex: 1.3 }]}>Hcm / OI</Text>
      </View>
      {rows.map(o => {
        const sel = Math.abs(o.strike - strike) < 1e-9, itm = type === 'call' ? o.strike < spot : o.strike > spot;
        const m = mid(o);
        return (
          <Pressable key={o.strike} onPress={() => { tap(); onPick(o); }}
            style={({ pressed }) => [st.row, { backgroundColor: sel ? C.accent : itm ? 'rgba(96,165,250,.07)' : 'transparent' }, pressed && { opacity: .6 }]}>
            <Text style={[st.c, { flex: 1.1, fontWeight: '800' }]}>{num(o.strike, o.strike % 1 ? 1 : 0)}{o === atm ? ' •' : ''}</Text>
            <Text style={[st.c, { flex: 1.6, color: sel ? '#fff' : C.muted }]}>{o.bid > 0 || o.ask > 0 ? `${num(o.bid, 2)} / ${num(o.ask, 2)}` : '—'}</Text>
            <Text style={[st.c, { flex: 1 }]}>{m > 0 ? num(m, 2) : '—'}</Text>
            <Text style={[st.c, { flex: 0.9, color: sel ? '#fff' : C.blue }]}>{o.iv ? num(o.iv * 100, 0) : '—'}</Text>
            <Text style={[st.c, { flex: 1.3, color: sel ? '#fff' : C.muted, fontSize: 12 }]}>{compactInt(o.volume)} / {compactInt(o.oi)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
const compactInt = (x: number) => x >= 10000 ? num(x / 1000, 0) + 'B' : x >= 1000 ? num(x / 1000, 1) + 'B' : num(x, 0);
const st = {
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, minHeight: 44, paddingHorizontal: 8, borderTopWidth: 0.5, borderTopColor: C.border },
  h: { color: C.muted, fontSize: 11.5, fontWeight: '700' as const },
  c: { color: C.text, fontSize: 13.5, fontVariant: ['tabular-nums' as const] },
};
export default memo(ChainPicker);
