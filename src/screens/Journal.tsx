import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Share, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as J from '@/lib/journal';
import type { Trade } from '@/lib/journal';
import { closeMs, defaultExpiry, etDate, etOffset } from '@/lib/usmarket';
import { etHM, localHM } from '@/lib/alerts';
import { checkAlerts, fetchLive, syncBackgroundTask } from '@/ui/monitor';
import { cancelIds, ensurePermission, scheduleExit } from '@/ui/notify';
import { journal, useJournal } from '@/ui/journalStore';
import { Btn, Card, DateField, NumField, Seg, Stat, TextField, s, tap } from '@/ui/controls';
import { C, plColor } from '@/ui/theme';

const usd = (x: number) => (x < 0 ? '−$' : '$') + Math.abs(x).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const p2 = (x: number) => String(x).padStart(2, '0');
const etStamp = (ms: number) => { const d = new Date(ms + etOffset(ms) * 3600000); return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} ET`; };
const ST: Record<string, [string, string]> = { open: ['açık', C.muted], target: ['HEDEF ✓', C.pos], stop: ['STOP ✕', C.neg], expired: ['süre doldu', C.warn] };

export default function Journal({ active }: { active: boolean }) {
  const insets = useSafeAreaInsets();
  const { trades, signals } = useJournal();
  const [live, setLive] = useState<Record<string, number>>({});
  const [exitPx, setExitPx] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [form, setForm] = useState(false);
  const [f, setF] = useState(() => ({ ticker: '', type: 'call' as Trade['type'], strike: null as number | null, expiry: defaultExpiry(Date.now()), qty: 1 as number | null, entry: null as number | null,
    target: null as number | null, stop: null as number | null }));
  const [view, setView] = useState<'open' | 'closed' | 'signals'>('open');

  const openT = trades.filter(J.isOpen), closedT = trades.filter(t => !J.isOpen(t));
  const st = J.stats(trades), per = J.byTicker(trades), ss = J.signalStats(signals);
  const openPL = openT.reduce((a, t) => a + (live[t.id] != null ? J.pnl(t, live[t.id]) : 0), 0);

  const refreshLive = useCallback(async () => {
    const ts = journal.get().trades.filter(J.isOpen); if (!ts.length) return;
    setBusy(true); setNowMs(Date.now());
    try {
      const lv = await fetchLive(ts), out: Record<string, number> = {};
      for (const [id, x] of Object.entries(lv)) if (x.opt != null) out[id] = x.opt;
      setLive(p => ({ ...p, ...out }));
      await checkAlerts(lv);
    } finally { setBusy(false); }
  }, []);
  useEffect(() => { if (!active) return; const t = setTimeout(refreshLive, 0); return () => clearTimeout(t); }, [active, refreshLive]);

  const save = async () => {
    const tk = f.ticker.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(tk) || !(f.entry! > 0) || !(f.qty! > 0) || (f.type !== 'stock' && !(f.strike! > 0))) {
      Alert.alert('Eksik bilgi', 'Sembol, giriş fiyatı, adet' + (f.type !== 'stock' ? ' ve strike' : '') + ' gerekli.'); return;
    }
    if ((f.target != null && !(f.target > f.entry!)) || (f.stop != null && !(f.stop < f.entry!))) {
      Alert.alert('Hedef / stop', 'Kâr al girişten yüksek, stop girişten düşük olmalı.'); return;
    }
    const opt = f.type !== 'stock';
    // Opsiyonda çıkış hatırlatması: vade günü 15:30 ET
    const exitAt = opt ? closeMs(f.expiry) - 30 * 60000 : undefined;
    const t: Trade = { id: J.newId(), ticker: tk, type: f.type, strike: opt ? f.strike! : undefined, expiry: opt ? f.expiry : undefined,
      qty: f.qty!, entry: f.entry!, entryTime: Date.now(), target: f.target ?? undefined, stop: f.stop ?? undefined, exitAt, watch: true };
    journal.addTrade(t);
    setForm(false); setF(p => ({ ...p, strike: null, entry: null, target: null, stop: null }));
    if (exitAt && exitAt > Date.now() && await ensurePermission(true)) { const ids = await scheduleExit(t); if (ids.length) journal.updateTrade(t.id, { notifIds: ids }); }
    syncBackgroundTask().catch(() => {});
  };
  const close = (t: Trade) => {
    const px = exitPx[t.id] ?? live[t.id];
    if (!(px! >= 0)) { Alert.alert('Çıkış fiyatı', 'Kapatmak için çıkış fiyatını gir.'); return; }
    journal.updateTrade(t.id, { exit: px!, exitTime: Date.now(), notifIds: [] });
    cancelIds(t.notifIds); syncBackgroundTask().catch(() => {});
  };
  const del = (t: Trade) => Alert.alert('Silinsin mi?', J.label(t), [{ text: 'Vazgeç' }, { text: 'Sil', style: 'destructive', onPress: () => { cancelIds(t.notifIds); journal.removeTrade(t.id); syncBackgroundTask().catch(() => {}); } }]);
  const toggleWatch = async (t: Trade, on: boolean) => {
    if (on) {
      if (!(await ensurePermission(true))) return;
      const ids = t.exitAt && t.exitAt > Date.now() ? await scheduleExit(t) : [];
      journal.updateTrade(t.id, { watch: true, notifIds: ids });
    } else { cancelIds(t.notifIds); journal.updateTrade(t.id, { watch: false, notifIds: [] }); }
    syncBackgroundTask().catch(() => {});
  };
  const exportCsv = async () => {
    const csv = J.toCSV(trades, signals);
    try { await Share.share({ message: csv, title: `islem-gunlugu-${etDate(Date.now())}.csv` }); } catch { /* iptal */ }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 14, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={refreshLive} tintColor={C.blue} />} keyboardShouldPersistTaps="handled">
      <View style={[s.row, { justifyContent: 'space-between', marginBottom: 10 }]}>
        <Text style={{ color: C.text, fontSize: 26, fontWeight: '800' }}>Geçmiş</Text>
        <View style={s.row}>
          <Btn label="CSV" onPress={exportCsv} />
          <Btn label={form ? 'Kapat' : '＋ İşlem'} kind="primary" onPress={() => setForm(x => !x)} />
        </View>
      </View>

      {form ? (
        <Card title="Manuel işlem">
          <Seg value={f.type} onChange={v => setF(p => ({ ...p, type: v }))} options={[['call', 'Call'], ['put', 'Put'], ['stock', 'Hisse']]} />
          <View style={[s.row, { marginTop: 10 }]}>
            <TextField label="Sembol" value={f.ticker} onChange={v => setF(p => ({ ...p, ticker: v }))} placeholder="SPY" />
            {f.type !== 'stock' ? <NumField label="Strike" value={f.strike} onValue={v => setF(p => ({ ...p, strike: v }))} allowEmpty /> : null}
          </View>
          <View style={[s.row, { marginTop: 10 }]}>
            {f.type !== 'stock' ? <DateField label="Vade" value={f.expiry} onValue={v => setF(p => ({ ...p, expiry: v }))} /> : null}
            <NumField label={f.type === 'stock' ? 'Adet (hisse)' : 'Adet (kontrat)'} value={f.qty} onValue={v => setF(p => ({ ...p, qty: v }))} digits={0} allowEmpty />
          </View>
          <View style={[s.row, { marginTop: 10 }]}>
            <NumField label="Giriş fiyatı ($)" value={f.entry} onValue={v => setF(p => ({ ...p, entry: v }))} allowEmpty big />
          </View>
          <View style={[s.row, { marginTop: 10 }]}>
            <NumField label="Kâr al $ (isteğe bağlı)" value={f.target} onValue={v => setF(p => ({ ...p, target: v }))} allowEmpty digits={2} />
            <NumField label="Stop $ (isteğe bağlı)" value={f.stop} onValue={v => setF(p => ({ ...p, stop: v }))} allowEmpty digits={2} />
          </View>
          <Text style={s.hint}>Giriş zamanı: kaydettiğin an (ET). Opsiyon P/L = (fiyat − giriş) × adet × 100. Kâr al/stop girersen fiyat yaklaşınca/ulaşınca bildirim gelir; opsiyonda vade günü 15:30 ET’de çıkış hatırlatması.</Text>
          <Btn label="Kaydet" kind="primary" onPress={save} style={{ marginTop: 10, minHeight: 50 }} />
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Stat k="Toplam gerçekleşen" v={usd(st.total)} color={plColor(st.total)} sub={`${st.n} kapalı işlem`} />
        <Stat k="Kazanma oranı" v={st.winRate == null ? '—' : `%${Math.round(st.winRate * 100)}`} sub={`${st.wins} K / ${st.losses} Z`} />
        <Stat k="Açık P/L (canlı)" v={usd(openPL)} color={plColor(openPL)} sub={`${openT.length} açık pozisyon`} />
        <Stat k="Sinyal isabeti" v={ss.hitRate == null ? '—' : `%${Math.round(ss.hitRate * 100)}`} sub={`${ss.target} hedef · ${ss.stop} stop · ${ss.expired} süre`} />
      </View>

      <Seg value={view} onChange={setView} options={[['open', `Açık (${openT.length})`], ['closed', `Kapalı (${closedT.length})`], ['signals', `Sinyaller (${signals.length})`]]} />
      <View style={{ height: 10 }} />

      {view === 'open' ? (openT.length ? openT.map(t => {
        const px = live[t.id], pl = px != null ? J.pnl(t, px) : null;
        return (
          <View key={t.id} style={st2.card}>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <Text style={st2.title}>{J.label(t)}</Text>
              <Pressable onPress={() => { tap(); del(t); }} hitSlop={8}><Text style={{ color: C.muted, fontSize: 18 }}>✕</Text></Pressable>
            </View>
            <Text style={st2.sub}>{t.qty} × giriş ${t.entry.toFixed(2)} · {etStamp(t.entryTime)}{t.fromSignal ? ' · sinyal' : ''}{t.target ? ` · hedef $${t.target.toFixed(2)}` : ''}{t.stop ? ` / stop $${t.stop.toFixed(2)}` : ''}</Text>
            {t.exitAt ? <Text style={[st2.sub, { color: t.exitAt < nowMs ? C.warn : C.muted }]}>⏰ Çıkış {etHM(t.exitAt)} (telefon {localHM(t.exitAt)}){t.exitAt < nowMs ? ' — süre geçti' : ''}{t.alerts?.length ? ` · gönderilen: ${t.alerts.map(a => ({ nearTarget: 'hedefe yakın', target: 'hedef', nearStop: 'stopa yakın', stop: 'stop' })[a]).join(', ')}` : ''}</Text> : null}
            <View style={[s.row, { justifyContent: 'space-between', marginTop: 4 }]}>
              <Text style={{ color: C.muted, fontSize: 13 }}>🔔 Hedef/stop/çıkış bildirimi</Text>
              <Switch value={t.watch !== false} onValueChange={v => toggleWatch(t, v)} />
            </View>
            <View style={[s.row, { marginTop: 6 }]}>
              <Text style={{ color: C.muted, fontSize: 14 }}>Şimdi {px != null ? `$${px.toFixed(2)}` : '—'}</Text>
              <Text style={{ color: pl == null ? C.muted : plColor(pl), fontSize: 18, fontWeight: '800', marginLeft: 'auto' }}>{pl == null ? '' : usd(pl)}</Text>
            </View>
            <View style={[s.row, { marginTop: 8 }]}>
              <NumField value={exitPx[t.id] ?? px ?? null} onValue={v => setExitPx(p => ({ ...p, [t.id]: v }))} placeholder="Çıkış $" allowEmpty digits={2} />
              <Btn label="Kapat" kind="primary" onPress={() => close(t)} style={{ minWidth: 90, minHeight: 46 }} />
            </View>
          </View>
        );
      }) : <Text style={[s.hint, { textAlign: 'center' }]}>Açık pozisyon yok. 0DTE sinyal kartından “Günlüğe ekle” ya da “＋ İşlem”.</Text>) : null}

      {view === 'closed' ? (
        <>
          {per.length ? (
            <Card title="Sembol bazında">
              {per.map(x => (
                <View key={x.ticker} style={[s.row, { justifyContent: 'space-between', minHeight: 34 }]}>
                  <Text style={{ color: C.text, fontWeight: '700', fontSize: 15, width: 70 }}>{x.ticker}</Text>
                  <Text style={{ color: C.muted, fontSize: 13 }}>{x.s.n} işlem · %{Math.round((x.s.winRate ?? 0) * 100)}</Text>
                  <Text style={{ color: plColor(x.s.total), fontWeight: '800', fontSize: 15, minWidth: 90, textAlign: 'right' }}>{usd(x.s.total)}</Text>
                </View>
              ))}
            </Card>
          ) : null}
          {closedT.length ? closedT.map(t => {
            const pl = J.realized(t);
            return (
              <Pressable key={t.id} onLongPress={() => del(t)} style={st2.card}>
                <View style={[s.row, { justifyContent: 'space-between' }]}>
                  <Text style={st2.title}>{J.label(t)}</Text>
                  <Text style={{ color: plColor(pl), fontWeight: '800', fontSize: 17 }}>{usd(pl)}</Text>
                </View>
                <Text style={st2.sub}>{t.qty} × ${t.entry.toFixed(2)} → ${t.exit!.toFixed(2)} · {etStamp(t.exitTime!)}</Text>
              </Pressable>
            );
          }) : <Text style={[s.hint, { textAlign: 'center' }]}>Henüz kapalı işlem yok.</Text>}
        </>
      ) : null}

      {view === 'signals' ? (
        <>
          <Text style={s.hint}>Her sinyal otomatik kaydedilir; 0DTE ekranı yenilendikçe 1 dk barlarla dayanak hedef mi stop mu önce geldi kontrol edilir (aynı barda ikisi → stop).</Text>
          {signals.map(x => (
            <View key={x.id} style={st2.card}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={[st2.title, { color: x.dir === 'call' ? C.pos : C.neg }]}>{x.ticker} {x.dte === 0 ? '0DTE' : x.dte + 'DTE'} {x.strike}{x.dir === 'call' ? 'C' : 'P'}</Text>
                <Text style={{ color: ST[x.status][1], fontWeight: '800' }}>{ST[x.status][0]}</Text>
              </View>
              <Text style={st2.sub}>{etStamp(x.time)} · giriş ≤ ${x.entry.toFixed(2)} · hedef ${x.target.toFixed(2)} · stop ${x.stop.toFixed(2)} · puan {x.score.toFixed(1)}</Text>
            </View>
          ))}
          {signals.length ? <Btn label="Sinyal geçmişini temizle" kind="danger" onPress={() => Alert.alert('Temizlensin mi?', '', [{ text: 'Vazgeç' }, { text: 'Temizle', style: 'destructive', onPress: () => journal.clearSignals() }])} /> : null}
        </>
      ) : null}
    </ScrollView>
  );
}
const st2 = {
  card: { backgroundColor: C.card, borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 0.5, borderColor: C.border },
  title: { color: C.text, fontSize: 16, fontWeight: '800' as const, flexShrink: 1 },
  sub: { color: C.muted, fontSize: 12.5, marginTop: 4 },
};
