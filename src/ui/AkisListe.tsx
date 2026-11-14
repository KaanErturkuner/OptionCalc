/* Akış olay listesi (gün gruplu). Rozetler ve yeniden kurulmuş olay uyarısı önceki sürümle aynıdır. */
import { Text, View } from 'react-native';
import { Card } from '@/ui/controls';
import { C } from '@/ui/theme';
import { contractLabel, fmtIstTime, fmtUsdShort, type FlowEvent } from '@/lib/flow/model';
import { RECONSTRUCTED_LABEL } from '@/lib/flow/reconstruct';
import type { FlowDayGroup } from '@/lib/flow/days';
import { fmt } from '@/lib/format';
import { closeMs } from '@/lib/usmarket';

export function AkisListe({ groups }: { groups: FlowDayGroup<FlowEvent>[] }) {
  return (
    <View style={{ gap: 10 }}>
      {groups.map(g => (
        <View key={g.day} style={{ gap: 10 }}>
          <Text accessibilityRole="header" style={{ color: C.muted, fontSize: 13, fontWeight: '800', marginTop: 6, marginLeft: 4 }}>
            {g.label} · {g.items.length} olay
          </Text>
          {g.items.some(e => e.reconstructed) ? (
            <Text style={{ color: C.warn, fontSize: 11, lineHeight: 16, marginLeft: 4, marginBottom: 2 }}>
              Bu gün canlı taranmadı. Olaylar kapanış zincirindeki gün içi toplam hacimden {RECONSTRUCTED_LABEL.toLowerCase()} (2 dk tarama değil). Saat kapanıştır (16:00 ET); gün içi an uydurulmadı.
            </Text>
          ) : null}
          {g.items.map(e => (
            <Card key={e.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: C.text, fontSize: 15, fontWeight: '800' }}>{contractLabel(e)}</Text>
                <Text style={{ color: e.side === 'call' ? C.pos : C.neg, fontSize: 12, fontWeight: '800' }}>{e.side === 'call' ? 'CALL' : 'PUT'}</Text>
              </View>
              <Text style={{ color: C.text, fontSize: 13, marginTop: 4 }}>
                Hacim Δ {fmt(e.dv, 0)} · prim ~{fmtUsdShort(e.prem)} · orta {fmt(e.mid, 2)}
              </Text>
              <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                OI {fmt(e.oi, 0)} · Hacim/OI {fmt(e.volOi, 2)} · {eventTimeLabel(e)}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                {e.reconstructed
                  ? <Badge text={RECONSTRUCTED_LABEL} color={C.warn} />
                  : <Badge text={e.confirmed ? 'Teyitli (canlı)' : 'Teyitsiz'} color={e.confirmed ? C.pos : C.muted} />}
                {e.wide ? <Badge text="Geniş spread" color={C.warn} /> : null}
                {e.pushed ? <Badge text="Bildirim gönderildi" color={C.blue} /> : null}
              </View>
            </Card>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Yeniden kurulmuş ve zamanı kapanışsa "kapanış"; çubuktan gelen gerçek an varsa İstanbul saati. */
function eventTimeLabel(e: FlowEvent): string {
  if (e.reconstructed && Math.abs(e.ts - closeMs(e.day)) < 60000) return 'kapanış (16:00 ET)';
  return `${fmtIstTime(e.ts)} İST`;
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <Text style={{ color, fontSize: 11, fontWeight: '700', borderWidth: 1, borderColor: color, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>{text}</Text>
  );
}
