/* Akış filtre çubuğu: hisse, taraf, gün, min prim, vade. Liste ve Dağılım aynı filtreyi paylaşır. */
import { Text, View } from 'react-native';
import { useState } from 'react';
import { Chip, Seg, TextField } from '@/ui/controls';
import { C } from '@/ui/theme';
import { MIN_PREM_OPTIONS, type DayFilter, type ExpiryFilter, type FlowFilters, type MinPrem, type SideFilter } from '@/lib/flow/filter';

const PREM_LABEL: Record<MinPrem, string> = { 0: 'Hepsi', 50_000: '50 bin $', 100_000: '100 bin $', 500_000: '500 bin $', 1_000_000: '1 M$' };

export function AkisFiltre({ filters, tickers, shown, total, onChange }: {
  filters: FlowFilters; tickers: string[]; shown: number; total: number; onChange: (p: Partial<FlowFilters>) => void;
}) {
  const [query, setQuery] = useState('');
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 12, gap: 10 }}>
      <Label t="Hisse" />
      <TextField label="Hisse ara (örn. MU)" value={query} placeholder="Sembol yaz" onChange={v => { setQuery(v); const q = v.trim().toUpperCase(); onChange({ ticker: q || null }); }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Chip label="Hepsi" active={filters.ticker == null} onPress={() => { setQuery(''); onChange({ ticker: null }); }} />
        {tickers.filter(t => !query.trim() || t.includes(query.trim().toUpperCase())).map(t => (
          <Chip key={t} label={t} active={filters.ticker === t} onPress={() => onChange({ ticker: t })} />
        ))}
      </View>

      <Label t="Taraf" />
      <Seg<SideFilter> small value={filters.side} onChange={v => onChange({ side: v })}
        options={[['all', 'Hepsi'], ['call', 'Call'], ['put', 'Put']]} />

      <Label t="Gün" />
      <Seg<DayFilter> small value={filters.day} onChange={v => onChange({ day: v })}
        options={[['bugun', 'Bugün'], ['dun', 'Dün'], ['uc', '3 gün']]} />

      <Label t="Min prim" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {MIN_PREM_OPTIONS.map(m => (
          <Chip key={m} label={PREM_LABEL[m]} active={filters.minPrem === m} onPress={() => onChange({ minPrem: m })} />
        ))}
      </View>

      <Label t="Vade" />
      <Seg<ExpiryFilter> small value={filters.expiry} onChange={v => onChange({ expiry: v })}
        options={[['all', 'Hepsi'], ['zero', '0DTE'], ['weekly', 'Haftalık'], ['monthly', 'Aylık opex (2 ay)']]} />

      <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{shown} / {total} olay</Text>
    </View>
  );
}

function Label({ t }: { t: string }) {
  return <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700' }}>{t}</Text>;
}
