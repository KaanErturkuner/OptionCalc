/* Sinyal tickerları ayarı: çipler (dokun → kaldır), ekleme, varsayılana dön, ticker durumları. */
import { useState } from 'react';
import { Text } from 'react-native';
import { Btn, Card, Chip, TextField } from '@/ui/controls';
import { C } from '@/ui/theme';
import { firsat, useFirsat } from '@/ui/firsatStore';
import { normalizeTicker, DEFAULT_TICKERS, MAX_TICKERS } from '@/lib/signals/tickers';
import { runSignalScan } from '@/ui/signalScan';

const pct = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2).replace('.', ',')}%`;

export default function SignalTickers() {
  const D = useFirsat();
  const [txt, setTxt] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const list = D.settings.tickers;
  const add = () => {
    const r = normalizeTicker(txt, list);
    if (!r.ok) { setMsg(r.reason); return; }
    firsat.setTickers([...list, r.ticker]); setTxt(''); setMsg(null);
    runSignalScan().catch(() => {});
  };
  return (
    <Card title="Sinyal tickerları">
      <Text style={{ color: C.muted, fontSize: 12, marginBottom: 8 }}>Sinyaller yalnızca bu listedeki tickerlar için üretilir. En fazla {MAX_TICKERS}.</Text>
      {list.map(t => <Chip key={t} label={`${t} ✕`} active onPress={() => firsat.setTickers(list.filter(x => x !== t))} />)}
      <TextField label="Ticker ekle" value={txt} onChange={v => { setTxt(v); setMsg(null); }} placeholder="örn. AMD" />
      <Btn label="+ Ekle" onPress={add} />
      <Btn label="Varsayılana dön" onPress={() => { firsat.setTickers(DEFAULT_TICKERS); setMsg(null); runSignalScan().catch(() => {}); }} />
      {msg ? <Text style={{ color: C.warn, fontSize: 12, marginTop: 6 }}>{msg}</Text> : null}
      {list.map(t => {
        const s = D.status[t];
        if (!s) return <Text key={'s' + t} style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>{t}: henüz tarama yok</Text>;
        if (s.error) return <Text key={'s' + t} style={{ color: C.neg, fontSize: 12, marginTop: 6 }}>{t}: {s.error}</Text>;
        return (
          <Text key={'s' + t} style={{ color: C.text, fontSize: 12, marginTop: 6 }}>
            {`${t} ${s.spot.toFixed(2).replace('.', ',')} (${pct(s.changePct)}) · VWAP ${s.vwapSide} · ${s.frames} · ${s.dte} DTE · k ${s.k.toFixed(2).replace('.', ',')} (${s.kSource})`}
            {s.delayedMin > 0 ? ` · ≈ gecikmeli (${s.delayedMin} dk)` : ''}
            {s.warn ? `\n${s.warn}` : ''}
            {s.setups.map(x => `\n${x}`).join('')}
          </Text>
        );
      })}
    </Card>
  );
}
