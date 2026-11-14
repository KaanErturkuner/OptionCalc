import { FreshnessPill } from '@/ui/FreshnessPill';
import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, Card, NumField, Seg, Stat, tap } from '@/ui/controls';
import { C } from '@/ui/theme';
import SignalTickers from '@/ui/SignalTickers';
import VerdictBlock from '@/ui/VerdictCard';
import { firsat, useFirsat, type Card as OppCard } from '@/ui/firsatStore';
import { approveCard, passCard, resetAccount, updatePaperSettings, runSignalScan } from '@/ui/signalScan';
import { trNum } from '@/lib/signals/opp';
import { calibration, bucketOf, type SignalLog } from '@/lib/signals/log';
import { summarize } from '@/lib/paper/account';
import { BROKER_COMMISSION } from '@/lib/paper/costs';
import { KADEMELER } from '@/lib/paper/sizing';
import type { PaperMode } from '@/lib/paper/types';
import { TRIGGER_AD } from '@/lib/signals/riskwatch';
import { isQ, type QSettings } from '@/lib/signals/qull/policy';
import { buildBoard, type BoardEntry } from '@/lib/signals/trade';
import { TradeCardView, WaitCardView } from '@/ui/TradeCard';

/** Qullamaggie ayar satırları (Qullamaggie uyarlaması — Kaan onayı yok). */
const Q_ROWS: [keyof QSettings, string][] = [
  ['Q1', 'Q1 · ORH kırılımı (call)'], ['Q1S', 'Q1S · ORL kırılımı, zayıf isim (put)'],
  ['Q2', 'Q2 · Episodic Pivot (gap + hacim)'], ['Q3', 'Q3 · Parabolik short (deneysel, varsayılan kapalı)'],
];
const Q_EXIT_ROWS: [keyof QSettings, string][] = [
  ['exitLod', 'LOD/HOD kırılırsa çık'], ['exitEma', '5 dk EMA10 iz süren stop'],
];

const MODE_TXT: Record<PaperMode, string> = {
  AGRESIF: 'Agresif 1:5', AGRESIF_4: 'Yedek 1:4', GUVENLI_KAR: 'Güvenli (gün yeterli)', GUVENLI_ZARAR: 'Güvenli (zarar molası)', DURDU: 'Bugünlük bitti',
};
const MODE_COL: Record<PaperMode, string> = { AGRESIF: C.blue, AGRESIF_4: C.blue, GUVENLI_KAR: C.pos, GUVENLI_ZARAR: C.warn, DURDU: C.neg };
const usd = (x: number, d = 0) => `${trNum(x, d)} $`;
const signed = (x: number) => `${x >= 0 ? '+' : '−'}${trNum(Math.abs(x), 0)} $`;
const istHM = (ms: number) => new Date(ms + 3 * 3600000).toISOString().slice(11, 16);   // İstanbul (UTC+3)
/** Doğrulama sayısı: aynı ticker × setup × skor kovasında kapanmış (sonucu olan) sinyal sayısı (§5.4). */
const validationN = (log: SignalLog[], c: OppCard): number =>
  log.filter(l => l.result && l.ticker === c.ticker && l.setup === c.setup && bucketOf(l.score) === bucketOf(c.score)).length;

const STATE_TXT: Record<OppCard['state'], string> = {
  bekliyor: 'Bekliyor', onaylandi: 'Onaylandı', reddedildi: 'Geçildi', 'suresi-doldu': 'Süresi doldu', 'fiyat-kacti': 'Fiyat kaçtı',
};

function Countdown({ card, now }: { card: OppCard; now: number }) {
  const left = Math.max(0, Math.ceil((card.createdAt + card.ttlMs - now) / 1000));
  return <Text style={{ color: left > 0 ? C.warn : C.muted, fontSize: 13, fontWeight: '800' }}>{left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} kaldı` : 'süre doldu'}</Text>;
}

function OpportunityCard({ c, now, open, toggle, n, locked }: { c: OppCard; now: number; open: boolean; toggle: () => void; n: number; locked: boolean }) {
  const [busy, setBusy] = useState(false);
  const pending = c.state === 'bekliyor' && !locked;
  const scoreCol = c.score >= 80 ? C.pos : c.score >= 65 ? C.blue : c.score >= 50 ? C.warn : C.muted;
  const act = async () => {
    setBusy(true);
    try { await approveCard(c.id); } catch { /* sonuç kart durumunda görünür */ } finally { setBusy(false); }
  };
  return (
    <View style={{ borderWidth: 0.5, borderColor: pending ? C.accent : C.border, borderRadius: 12, padding: 10, gap: 6, opacity: pending ? 1 : 0.6 }}>
      <Text onPress={() => { tap(); toggle(); }} style={{ color: C.text, fontSize: 15, fontWeight: '800' }}>{c.text.title}</Text>
      {isQ(c.setup) ? <Text style={{ color: C.blue, fontSize: 11, fontWeight: '700' }}>Q · Qullamaggie uyarlaması — Kaan onayı yok</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ color: scoreCol, fontSize: 28, fontWeight: '800' }}>{c.score}</Text>
        <Text style={{ color: C.muted, fontSize: 12 }}>/100 · {c.label} · {n >= 30 ? 'n ≥ 30 (güvenilir için backtest şartı bekleniyor)' : `doğrulanmamış ${n}/30`}</Text>
      </View>
      <Text style={{ color: C.text, fontSize: 12 }}>{c.text.body}</Text>
      {c.qual ? <Text style={{ color: C.text, fontSize: 12 }}>{`Q-kalite ${c.qual.score}/100 — ${c.qual.note}`}</Text> : null}
      <Text style={{ color: C.muted, fontSize: 12 }}>
        {`${c.dte} DTE · RR 1:${trNum(c.rr, 1)} · giriş ${usd(c.fill, 2)} · stop ${usd(c.stopPrem, 2)} · hedef ${usd(c.primTarget, 2)}`}
        {c.delayedMin > 0 ? ` · ≈ gecikmeli (${c.delayedMin} dk)` : ''}
      </Text>
      <Text style={{ color: c.overnightOk ? C.blue : C.muted, fontSize: 12 }}>
        {c.overnightOk ? 'Gece taşınabilir (15:45 kararı, 1–3 DTE)' : '0DTE: 15:45 ET\'de kapanır'}
      </Text>
      {pending ? <Countdown card={c} now={now} /> : (
        <Text style={{ color: C.muted, fontSize: 12 }}>{STATE_TXT[c.state]}{c.note ? ` · ${c.note}` : ''}{c.decidedAt ? ` · ${istHM(c.decidedAt)}` : ''}</Text>
      )}
      {open ? (
        <View style={{ gap: 2, marginTop: 4 }}>
          <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700' }}>Skor dökümü</Text>
          {c.components.map(x => (
            <Text key={x.key} style={{ color: C.text, fontSize: 12 }}>{`${x.key} ${x.label} ${x.pts}/${x.max} · ${x.note}`}</Text>
          ))}
          {c.vetoes.length ? <Text style={{ color: C.neg, fontSize: 12 }}>{`Veto: ${c.vetoes.join(', ')}`}</Text> : null}
          {c.reason && !c.eligible ? <Text style={{ color: C.warn, fontSize: 12 }}>{`Bekliyorum: ${c.reason}`}</Text> : null}
          <Text style={{ color: C.muted, fontSize: 11 }}>{`Olasılık (dokunma, EM yaklaşımı): %${Math.round(c.pTouch * 100)} · kontrat ${c.bid.toFixed(2)} / ${c.ask.toFixed(2)}`}</Text>
        </View>
      ) : null}
      {c.state === 'bekliyor' && locked ? (
        <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Açık kâğıt pozisyon varken yeni giriş yok (bilgi kartı).</Text>
      ) : pending && !c.eligible ? (
        <Text style={{ color: C.warn, fontSize: 12, marginTop: 4 }}>{`Kâğıda uygun değil: ${c.reason}`}</Text>
      ) : pending ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          <View style={{ flex: 1 }}><Btn label={busy ? 'Kontrol ediliyor…' : 'Onayla'} kind="primary" onPress={() => { if (!busy) act(); }} /></View>
          <View style={{ flex: 1 }}><Btn label="Geç" onPress={() => passCard(c.id)} /></View>
        </View>
      ) : null}
    </View>
  );
}

export default function Firsat() {
  const insets = useSafeAreaInsets();
  const D = useFirsat();
  const [now, setNow] = useState(() => Date.now());
  const [openId, setOpenId] = useState<string | null>(null);
  const [capIn, setCapIn] = useState<number | null>(300);
  const [detOpen, setDetOpen] = useState(false);
  useEffect(() => { firsat.load(); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const p = D.paper;
  const modeTxt = p ? MODE_TXT[p.mode] : '—';
  const streak = p ? (p.winStreak > 0 ? `${p.winStreak} kazanç` : p.lossStreak > 0 ? `${p.lossStreak} kayıp` : 'yok') : '—';
  const stats = p ? summarize(p.trades) : null;
  const cards = [...D.cards].sort((a, b) => (a.state === 'bekliyor' ? 0 : 1) - (b.state === 'bekliyor' ? 0 : 1) || b.createdAt - a.createdAt);
  const pending = cards.filter(c => c.state === 'bekliyor');
  const past = cards.filter(c => c.state !== 'bekliyor');
  const cal = calibration(D.log);
  const pos = p?.position ?? null;
  const commOpt: [number, string][] = [[BROKER_COMMISSION.midas, 'Midas 1,50 $'], [BROKER_COMMISSION.ibkr, 'IBKR 0,65 $']];
  // Fırsat panosu: her ticker'ın Sonuç kararından en güçlü 1–3 işlem kartı; yoksa BEKLE kartı (saf türetim: lib/signals/trade.ts)
  const entries: BoardEntry[] = Object.entries(D.status).flatMap(([t, s]) => (s.verdict ? [{ ticker: t, verdict: s.verdict }] : []));
  const board = buildBoard(entries, now, p ? { capital: p.capital, kademe: p.kademe, commission: p.settings.commission } : null);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 12, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40, gap: 10 }}>
      <View>
        <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }}>Fırsat</Text>
        <View style={{ marginTop: 6 }}><FreshnessPill /></View>
      </View>

      {/* 1) Hesap özeti (tek satır) */}
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Stat k="Sermaye" v={p ? usd(p.capital, 2) : '—'} />
          <Stat k="Bugün K/Z" v={p ? signed(p.dayPnl) : '—'} color={p && p.dayPnl < 0 ? C.neg : p && p.dayPnl > 0 ? C.pos : undefined} />
          <Stat k="Mod" v={modeTxt} color={p ? MODE_COL[p.mode] : undefined} />
          <Stat k="Kademe" v={p ? `%${Math.round(p.kademe * 100)}` : '—'} sub="azami %50" />
          <Stat k="Seri" v={streak} />
        </View>
        {p && p.mode === 'DURDU' ? <Text style={{ color: C.neg, fontSize: 12, marginTop: 6 }}>Başkan, bugünlük bu kadar. Yeni işlem yok.</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <Text style={{ color: C.muted, fontSize: 11, flex: 1 }}>{D.lastScan ? `Son tarama ${istHM(D.lastScan)} (İstanbul)` : 'Henüz tarama yok'}</Text>
          <View style={{ width: 130 }}><Btn label="Şimdi tara" onPress={() => { runSignalScan().catch(() => {}); }} /></View>
        </View>
      </Card>

      {/* 2) Ana karar: işlem kartları (en güçlü 3) ya da BEKLE */}
      {board.trades.length ? board.trades.map(t => <TradeCardView key={t.key} c={t} />) : board.wait ? <WaitCardView w={board.wait} /> : null}
      <Text style={{ color: C.muted, fontSize: 11, lineHeight: 15 }}>
        Kâğıt üstü · tavsiye değildir. Prim brüt; komisyon ayrıca gösterilir.
      </Text>

      {/* 3) Açık pozisyon */}
      {pos ? (
        <Card title="Açık pozisyon" right={pos.overnight ? <Text style={{ color: C.blue, fontSize: 12 }}>gece taşınıyor</Text> : null}>
          <Text style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>{`${pos.ticker} ${pos.dir === 'call' ? 'Call' : 'Put'} ${pos.strike} · ${pos.expiry} (${pos.dte} DTE)`}</Text>
          <Text style={{ color: C.muted, fontSize: 12 }}>{`Giriş ${usd(pos.fill, 2)} · maliyet ${usd(pos.costBasis, 0)} · ${pos.contracts} kontrat · R ${usd(pos.rDollars, 0)}`}</Text>
          {D.posLive ? (
            <>
              <Text style={{ color: D.posLive.rMult >= 0 ? C.pos : C.neg, fontSize: 18, fontWeight: '800', marginTop: 4 }}>{`${trNum(D.posLive.rMult, 2)} R · bid ${usd(D.posLive.bid, 2)}`}</Text>
              <Text style={{ color: C.muted, fontSize: 12 }}>{`Stop ${usd(D.posLive.stop, 2)} · hedef ${usd(pos.targetPrem, 2)} · tetikler: ${D.posLive.triggers.length ? D.posLive.triggers.map(t => TRIGGER_AD[t as keyof typeof TRIGGER_AD] ?? t).join(', ') : 'yok'}`}</Text>
            </>
          ) : <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Canlı veri bekleniyor.</Text>}
          <Text style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>Çıkışlar otomatik: hedef, stop, iz süren stop, risk tetikleri, 15:45 kuralı.</Text>
        </Card>
      ) : null}

      {/* 4) Onay bekleyen kâğıt işlemler (Onayla / Geç) */}
      {pending.length ? (
        <Card title="Onay bekliyor">
          <View style={{ gap: 10 }}>
            {pending.slice(0, 6).map(c => (
              <OpportunityCard key={c.id} c={c} now={now} n={validationN(D.log, c)} open={openId === c.id} toggle={() => setOpenId(openId === c.id ? null : c.id)} locked={!!pos} />
            ))}
          </View>
        </Card>
      ) : null}

      {/* 5) Detaylar: varsayılan kapalı */}
      <Card>
        <Text onPress={() => { tap(); setDetOpen(o => !o); }} style={{ color: C.text, fontSize: 14, fontWeight: '800' }}>
          {detOpen ? '▾ Detayları gizle' : '▸ Detaylar (koşullar, göstergeler, özet, ayarlar)'}
        </Text>
        {detOpen ? (
          <View style={{ gap: 12, marginTop: 12 }}>
            {/* Ticker bazlı ham Sonuç kartları (kriter dökümü) */}
            {entries.length ? (
              <View style={{ gap: 10 }}>
                <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700' }}>Ticker bazlı koşullar</Text>
                {entries.map(e => <VerdictBlock key={e.ticker} ticker={e.ticker} v={e.verdict} />)}
                <Text style={{ color: C.muted, fontSize: 11 }}>
                  {`Veri: ${Object.values(D.status).map(s => s.source).filter(Boolean)[0] ?? '—'} · dayanak 1 dk barı (Yahoo) varsa ondan; yoksa kotasyon (gecikmeli olabilir).`}
                </Text>
              </View>
            ) : null}

            {Object.values(D.status).some(s => s.setups.length) ? (
              <View style={{ gap: 2 }}>
                <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700' }}>Tarama notları</Text>
                {Object.entries(D.status).flatMap(([t, s]) => s.setups.map(x => `${t}: ${x}`)).slice(0, 20).map((x, i) => (
                  <Text key={i} style={{ color: C.muted, fontSize: 11 }}>{x}</Text>
                ))}
              </View>
            ) : null}

            {past.length ? (
              <View style={{ gap: 10 }}>
                <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700' }}>Geçmiş kartlar</Text>
                {past.slice(0, 12).map(c => (
                  <OpportunityCard key={c.id} c={c} now={now} n={validationN(D.log, c)} open={openId === c.id} toggle={() => setOpenId(openId === c.id ? null : c.id)} locked={!!pos} />
                ))}
              </View>
            ) : null}

            <Text style={{ color: C.text, fontSize: 13, fontWeight: '800' }}>Özet ve kayıt</Text>
            {stats && stats.n > 0 ? (
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  <Stat k="İşlem" v={String(stats.n)} />
                  <Stat k="Kazanma" v={`%${trNum(stats.winPct, 0)}`} />
                  <Stat k="Ort. R" v={trNum(stats.avgR, 2)} />
                  <Stat k="PF" v={Number.isFinite(stats.pf) ? trNum(stats.pf, 2) : '∞'} />
                  <Stat k="Maks. düşüş" v={usd(stats.maxDrawdown, 0)} />
                  <Stat k="En uzun kayıp" v={String(stats.longestLossStreak)} />
                </View>
                <View style={{ gap: 2 }}>
                  {p!.trades.slice(-20).reverse().map(t => (
                    <Text key={t.id + t.day + t.exit} style={{ color: t.netPnl >= 0 ? C.pos : C.neg, fontSize: 12 }}>
                      {`${t.day.slice(5)} ${t.ticker} ${t.setup} · ${signed(t.netPnl)} (${trNum(t.rMultiple, 1)}R) · ${t.reason}${t.overnight ? ' · gece' : ''} · sermaye ${usd(t.capitalAfter, 0)}`}
                    </Text>
                  ))}
                </View>
              </>
            ) : <Text style={{ color: C.muted, fontSize: 13 }}>Henüz kapanmış işlem yok.</Text>}

            <Text style={{ color: C.text, fontSize: 13, fontWeight: '800' }}>İsabet (kalibrasyon)</Text>
            <Text style={{ color: C.muted, fontSize: 12 }}>Skor kovasına göre gerçekleşen sonuç (yalnız kapanmış sinyaller). Ağırlıklar otomatik değişmez.</Text>
            {cal.map(b => (
              <Text key={b.bucket} style={{ color: C.text, fontSize: 13 }}>
                {`${b.bucket}: n=${b.n}` + (b.n ? ` · kazanma %${trNum(b.winPct ?? 0, 0)} · ort. R ${trNum(b.avgR ?? 0, 2)} · PF ${b.pf == null ? '—' : trNum(b.pf, 2)}` : ' · veri yok')}
              </Text>
            ))}

            <Text style={{ color: C.text, fontSize: 13, fontWeight: '800' }}>Sinyal tickerları</Text>
            <SignalTickers />

            <Text style={{ color: C.text, fontSize: 13, fontWeight: '800' }}>Ayarlar</Text>
            {p ? (
              <View style={{ gap: 10 }}>
                <Text style={{ color: C.muted, fontSize: 12 }}>Komisyon (kontrat başına, açılış ve kapanışta)</Text>
                <Seg options={commOpt} value={p.settings.commission} onChange={v => updatePaperSettings({ commission: v })} small />
                <Text style={{ color: C.muted, fontSize: 12 }}>Onay süresi (dk) — 0DTE 3, 1–3 DTE 5 (varsayılan)</Text>
                <Seg<number | 0>
                  options={[[0, 'Varsayılan'], [1, '1'], [3, '3'], [5, '5'], [10, '10']]}
                  value={D.settings.ttlMin ?? 0}
                  onChange={v => firsat.setTtl(v === 0 ? null : v)} small />
                <Text style={{ color: C.muted, fontSize: 12 }}>Tarama aralığı (dk); açık pozisyonda her dakika</Text>
                <Seg<1 | 2 | 5> options={[[1, '1'], [2, '2'], [5, '5']]} value={D.settings.intervalMin} onChange={v => firsat.setInterval(v)} small />
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text, fontSize: 13, flex: 1 }}>{`Kesirli kontrat simülasyonu (varsayılan kapalı)`}</Text>
                  <Switch value={p.settings.fractional} onValueChange={v => updatePaperSettings({ fractional: v })} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text, fontSize: 13, flex: 1 }}>{`DURDU kuralı (varsayılan kapalı)`}</Text>
                  <Switch value={p.settings.durduEnabled} onValueChange={v => updatePaperSettings({ durduEnabled: v })} />
                </View>
                <Text style={{ color: C.muted, fontSize: 11 }}>{`Kademeler %50 / %40 / %30, azami %50 — sabittir ve ayardan değiştirilemez (${KADEMELER.map(k => Math.round(k * 100)).join(' / ')}).`}</Text>
                <NumField label="Yeni hesap sermayesi ($)" value={capIn} onValue={setCapIn} digits={2} />
                <Btn label="Hesabı sıfırla (eskisi arşivlenir)" kind="danger" onPress={() => { if (capIn && capIn > 0) resetAccount(capIn); }} />
              </View>
            ) : <Text style={{ color: C.muted, fontSize: 13 }}>Hesap yükleniyor…</Text>}
            <View style={{ gap: 8, marginTop: 6 }}>
              <Text style={{ color: C.text, fontSize: 13, fontWeight: '800' }}>Qullamaggie setupları</Text>
              {Q_ROWS.map(([k, label]) => (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text, fontSize: 13, flex: 1 }}>{label}</Text>
                  <Switch value={D.settings.q[k]} onValueChange={v => firsat.setQ({ [k]: v })} />
                </View>
              ))}
              <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700' }}>Çıkış uyarlamaları (varsayılan kapalı)</Text>
              {Q_EXIT_ROWS.map(([k, label]) => (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text, fontSize: 13, flex: 1 }}>{label}</Text>
                  <Switch value={D.settings.q[k]} onValueChange={v => firsat.setQ({ [k]: v })} />
                </View>
              ))}
              <Text style={{ color: C.warn, fontSize: 11 }}>Qullamaggie uyarlaması — Kaan onayı yok. Q setupları backtest kriterini geçene kadar yalnız sinyal listesinde; kâğıt işleme uygun değil.</Text>
              <Text style={{ color: C.muted, fontSize: 11 }}>0–3 DTE’de Qullamaggie’nin 3–5 gün sonra kısmi satış ve 10/20 günlük MA ile iz sürmesi uygulanamaz (günlük bar yok).</Text>
            </View>
          </View>
        ) : null}
      </Card>
    </ScrollView>
  );
}
