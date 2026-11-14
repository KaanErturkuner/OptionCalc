/* Dağılım altında "AI yorum" (sunucu → Haiku). Otomatik çağrı YOK: yalnız butona basınca (maliyet). Yalnız ticker+gün başına son yorum. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Btn, Card, s, tap } from '@/ui/controls';
import { C } from '@/ui/theme';
import { fetchFlowYorum, requestFlowYorum, type FlowYorum } from '@/lib/flow/client';
import { fmtIst } from '@/lib/flow/model';
import { trDate } from '@/lib/format';

const errMsg = (e: unknown) => (e as Error)?.message || 'Veri alınamadı';

/** Parent `key={ticker+day}` ile yeniden bağlar: hisse ya da gün değişince önceki yorum kalmaz. */
export function AkisYorum({ flowKey, ticker, day }: { flowKey: string; ticker: string; day: string }) {
  const [yorum, setYorum] = useState<FlowYorum | null>(null);
  const [busy, setBusy] = useState<'get' | 'post' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);   // yalnız son istek sonucunu uygular

  const load = useCallback(async () => {
    const my = ++seq.current;
    setBusy('get'); setErr(null);
    try {
      const r = await fetchFlowYorum(flowKey, ticker, day);
      if (my === seq.current) setYorum(r);
    } catch (e) {
      if (my === seq.current) setErr(errMsg(e));
    } finally {
      if (my === seq.current) setBusy(null);
    }
  }, [flowKey, ticker, day]);

  // Açılışta yalnız kayıt kontrolü (GET); üretim yalnız düğmeyle (POST)
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  const generate = async () => {
    if (busy === 'post') return;
    tap();
    const my = ++seq.current;
    setBusy('post'); setErr(null);
    try {
      const r = await requestFlowYorum(flowKey, ticker, day);
      if (my === seq.current) setYorum(r);     // başarılı yanıt eskisinin yerine geçer; hata olursa eski metin kalır
    } catch (e) {
      if (my === seq.current) setErr(errMsg(e));
    } finally {
      if (my === seq.current) setBusy(null);
    }
  };

  return (
    <Card title="AI yorum (Haiku)">
      <Text style={[s.hint, { lineHeight: 17 }]}>
        Gün: {trDate(day)} · {ticker}. Sunucu bu hisse ve günün tüm akışını kullanır (tablodaki filtreler uygulanmaz). Yatırım tavsiyesi değildir.
      </Text>

      {busy === 'post' ? <Text style={{ color: C.muted, fontSize: 13, marginTop: 10 }}>AI yorum hazırlanıyor…</Text> : null}
      {busy === 'get' && !yorum ? <Text style={{ color: C.muted, fontSize: 12, marginTop: 10 }}>Kayıtlı yorum kontrol ediliyor…</Text> : null}

      {yorum ? (
        <View style={{ gap: 6, marginTop: 10 }}>
          <Text selectable style={{ color: C.text, fontSize: 13, lineHeight: 19 }}>{yorum.text}</Text>
          <Text style={{ color: C.muted, fontSize: 11 }}>
            Hazırlandı {fmtIst(yorum.createdAt)} İST{yorum.stored ? ' · bugün için saklanıyor' : ' · eski gün: saklanmaz'}
          </Text>
        </View>
      ) : null}

      {err ? <Text style={{ color: C.neg, fontSize: 13, marginTop: 10 }}>{err}</Text> : null}

      <View style={{ flexDirection: 'row', marginTop: 10 }}>
        {yorum
          ? <Btn label={busy === 'post' ? 'Hazırlanıyor…' : 'Yenile'} onPress={generate} />
          : busy !== 'post' ? <Btn kind="primary" label="AI yorum" onPress={generate} /> : null}
      </View>
    </Card>
  );
}
