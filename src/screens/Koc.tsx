/* Menü › Koç: Midas ekran görüntüleri (en çok 40, sıralı yükleme) → sunucu (Haiku) → dolumlar, eşleşmiş işlemler + koçluk,
 * açık pozisyonlar, eşleşmeyen satışlar, günün karnesi. Eğitim amaçlıdır; yatırım tavsiyesi DEĞİLDİR.
 * Görsel seçici kurulu değilse (expo-image-picker) yükleme devre dışı kalır, açıklama gösterilir. */
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, Card, tap } from '@/ui/controls';
import { C } from '@/ui/theme';
import { loadState } from '@/lib/state';
import { flowKeyOf } from '@/lib/flow/client';
import { fetchCoachDay, makeKarne, processCoach, uploadScreenshot, type CoachDayView, type UploadResult } from '@/lib/coach/client';
import { runUploadQueue, type QueueItem, type QueueProgress } from '@/lib/coach/queue';
import { describeUploadError, majorityDay, type UploadFailure } from '@/lib/coach/uploadError';
import { addDaysStr, etDate } from '@/lib/usmarket';
import { pickScreenshots, MAX_PICK, PICKER_MISSING } from '@/ui/coachPicker';
import CoachReport from '@/ui/CoachReport';

const REFRESH_MS = 60000;
const PROCESS_LOOPS = 12;   // bekleyen koçluk için en çok istek turu (her tur en çok 5 işlem)
const dayLabel = (d: string) => d.split('-').reverse().join('.');
const px = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(2).replace('.', ','));
const hm = (t: string) => t.slice(11, 16);
const cpLabel = (cp: 'C' | 'P') => (cp === 'C' ? 'C' : 'P');
const kb = (b64: string) => Math.round((b64.length * 3) / 4 / 1024);
/** Yükleme kartındaki her görüntü satırı (ayrı durum; GET hatalarından bağımsız) */
interface UploadRow { label: string; state: 'bekliyor' | 'gonderiliyor' | 'yeniden' | 'ok' | 'hata'; text: string }

export default function Koc({ active, onBack }: { active: boolean; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  const [day, setDay] = useState(() => etDate(Date.now()));
  const [view, setView] = useState<CoachDayView | null>(null);
  const [err, setErr] = useState<string | null>(null);          // yükleme / koçluk / karne hataları
  const [loadErr, setLoadErr] = useState<string | null>(null);  // GET /coach hatası (yükleme hatasından ayrı)
  const [notice, setNotice] = useState<string | null>(null);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [busy, setBusy] = useState<'load' | 'upload' | 'karne' | null>(null);
  const [noKey, setNoKey] = useState(false);
  const [pickerOk, setPickerOk] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);

  const load = useCallback(async (d: string) => {
    setBusy('load');
    try {
      const st = await loadState();
      const key = flowKeyOf(st?.flowKey);
      setNoKey(!key);
      if (!key) { setView(null); setLoadErr(null); return; }
      setView(await fetchCoachDay(key, d));
      setLoadErr(null);
    } catch (e) {
      setLoadErr((e as Error).message || 'Veri alınamadı');
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const first = setTimeout(() => void load(day), 0);
    const id = setInterval(() => void load(day), REFRESH_MS);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [active, day, load]);

  const upload = async () => {
    tap();
    let key = '';
    try {
      key = flowKeyOf((await loadState())?.flowKey);
    } catch (e) {
      setErr((e as Error).message); return;
    }
    if (!key) { setErr('Akış anahtarı girilmedi (Hesapla › Ayarlar). Anahtar olmadan yükleme yapılmaz.'); return; }
    setBusy('upload'); setErr(null); setNotice(null); setRows([]); setProgress('hazırlanıyor');
    const p = await pickScreenshots((d, n) => setProgress(`hazırlanıyor ${d}/${n}`));
    if (!p.ok) {
      setBusy(null); setProgress(null);
      if (p.kind === 'cancel') return;
      if (p.kind === 'missing') setPickerOk(false);
      setErr(p.reason);
      return;
    }
    const uploadDay = day;
    const n = p.images.length;
    const items: QueueItem[] = p.images.map(img => ({ base64: img.base64, mime: img.mime, label: img.label }));
    setRows(p.images.map(img => ({ label: img.label, state: 'bekliyor', text: `${kb(img.base64)} KB${img.source === 'picker' ? ' · yedek kodlama' : ''}` })));
    const setRow = (i: number, patch: Partial<UploadRow>) => setRows(prev => prev.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    setProgress(`0/${n}`);
    const sent: UploadResult[] = [];
    const res = await runUploadQueue(items, {
      send: async item => {
        const i = items.indexOf(item);
        setRow(i, { state: 'gonderiliyor', text: `gönderiliyor (${kb(item.base64)} KB)` });
        try {
          const r = await uploadScreenshot(key, { base64: item.base64, mime: item.mime, day: uploadDay });
          sent.push(r);
          const extra = [r.duplicate ? 'daha önce yüklü (atlandı)' : null, r.coached ? `${r.coached} işlem koçlandı` : null, ...r.warnings].filter(Boolean);
          setRow(i, { state: 'ok', text: `${r.added} yeni dolum${extra.length ? ` · ${extra.join(' · ')}` : ''}` });
          return { added: r.added, inTok: r.usage.inTok, outTok: r.usage.outTok, warnings: r.warnings };
        } catch (e) {
          setRow(i, { state: 'hata', text: describeUploadError(e as UploadFailure) });
          throw e;
        }
      },
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      onProgress: (q: QueueProgress) => {
        setProgress(progressText(q));
        if (q.phase === 'retry') setRow(q.index, { state: 'yeniden', text: `yeniden deneniyor (${Math.ceil((q.waitMs ?? 0) / 1000)} sn)` });
      },
    });
    // Yüklenen dolumların tarihine geç (yoksa seçili gün)
    const targetDay = majorityDay(sent.flatMap(r => r.fills.map(f => f.t.slice(0, 10)))) ?? uploadDay;
    // Bekleyen koçluklar (yükleme başına en çok birkaç; kalanı istemci döngüsü)
    let coachedExtra = 0; let pendingLeft = sent.length ? sent[sent.length - 1].pending : 0;
    const coachErrors: string[] = [];
    for (let k = 0; k < PROCESS_LOOPS && pendingLeft > 0; k++) {
      setProgress(`koçluk ${pendingLeft} kaldı`);
      try {
        const r = await processCoach(key, targetDay);
        coachedExtra += r.processed; pendingLeft = r.pending; coachErrors.push(...r.errors);
        if (r.processed === 0 || r.errors.length) break;
      } catch (e) {
        coachErrors.push((e as Error).message); break;
      }
    }
    const coached = sent.reduce((a, r) => a + r.coached, 0) + coachedExtra;
    const added = sent.reduce((a, r) => a + r.added, 0);
    const dup = sent.filter(r => r.duplicate).length;
    const tok = sent.reduce((a, r) => ({ i: a.i + r.usage.inTok, o: a.o + r.usage.outTok }), { i: 0, o: 0 });
    const parts = [
      `${res.done}/${n} görüntü işlendi · ${added} yeni dolum${dup ? ` · ${dup} önceden yüklü (atlandı)` : ''} · ${coached} işlem koçlandı${pendingLeft ? ` · ${pendingLeft} koçluk bekliyor` : ''}.`,
      `Token: girdi ${tok.i} / çıktı ${tok.o}.`,
    ];
    if (targetDay !== uploadDay) parts.push(`Gün ${dayLabel(targetDay)} olarak açıldı (dolumların tarihi).`);
    if (res.stopped) parts.push(`Durduruldu: ${res.stopped}.`);
    if (res.skipped) parts.push(`Gönderilmeyen: ${res.skipped} görüntü.`);
    if (p.skipped.length) parts.push(`Seçimde atlanan: ${p.skipped.join(' · ')}`);
    const warn = [...new Set([...res.warnings, ...sent.flatMap(r => r.warnings)])];
    if (warn.length) parts.push(`Uyarı: ${warn.join(' · ')}`);
    setNotice(parts.join(' '));
    const errs = [...(res.failed.length ? [`${res.failed.length} görüntü yüklenemedi (ayrıntı Yükleme kartında)`] : []), ...coachErrors];
    setErr(errs.length ? errs.join(' · ') : null);
    setProgress(null);
    setBusy(null);
    if (targetDay !== day) setDay(targetDay);
    await load(targetDay);
  };

  const karne = async () => {
    tap();
    setBusy('karne'); setErr(null);
    try {
      const st = await loadState();
      await makeKarne(flowKeyOf(st?.flowKey), day);
      await load(day);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const header = (
    <View style={{ gap: 8 }}>
      {onBack ? <Btn label="‹ Menü" onPress={() => { tap(); onBack(); }} style={{ alignSelf: 'flex-start', minHeight: 36 }} /> : null}
      <Text style={{ color: C.text, fontSize: 24, fontWeight: '800' }}>Koç</Text>
      <Text style={{ color: C.muted, fontSize: 12 }}>Eğitim amaçlı geri bildirim. Yatırım tavsiyesi değildir.</Text>
    </View>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: 12, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40, gap: 12 }}
      refreshControl={<RefreshControl refreshing={busy === 'load'} onRefresh={() => load(day)} tintColor={C.muted} />}>
      {header}

      <Card title="Gün">
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Btn label="‹ Önceki" onPress={() => { tap(); setDay(addDaysStr(day, -1)); }} />
          <Text style={{ color: C.text, fontWeight: '700' }}>{dayLabel(day)}</Text>
          <Btn label="Sonraki ›" onPress={() => { tap(); setDay(addDaysStr(day, 1) > etDate(Date.now()) ? day : addDaysStr(day, 1)); }} />
          <Btn label="Bugün" onPress={() => { tap(); setDay(etDate(Date.now())); }} />
        </View>
      </Card>

      <Card title="Ekran görüntüleri">
        <Text style={{ color: C.muted, fontSize: 13, marginBottom: 8 }}>
          Her işlem için alış (Açılış) ve satış (Kapanış) ekranını seç; en çok {MAX_PICK} görüntü. Sırayla yüklenir (n/N), geçici hatalarda yeniden denenir.
          Aynı görüntü tekrar yüklenirse yeniden işlenmez. Alış ve satış farklı zamanlarda yüklenebilir: eşleşince işlem koçlanır.
        </Text>
        {pickerOk ? null : <Text style={{ color: C.neg, fontSize: 12, marginBottom: 6 }}>{PICKER_MISSING}</Text>}
        <Btn label={busy === 'upload' ? `Yükleniyor… ${progress ?? ''}` : 'Görüntü seç ve yükle'} onPress={() => { void upload(); }} style={{ alignSelf: 'flex-start' }} />
      </Card>

      {noKey ? <Card title="Anahtar"><Text style={{ color: C.muted }}>Akış anahtarı girilmedi (Hesapla › Ayarlar). Koç aynı anahtarla çalışır.</Text></Card> : null}
      {rows.length ? (
        <Card title="Yükleme (görüntü başına)">
          <View style={{ gap: 4 }}>
            {rows.map(r => (
              <Text key={r.label} style={{ color: r.state === 'hata' ? C.neg : C.text, fontSize: 12 }}>
                {r.label}: {r.text}
              </Text>
            ))}
          </View>
        </Card>
      ) : null}
      {err ? <Card title="Hata"><Text style={{ color: C.neg }}>{err}</Text></Card> : null}
      {notice ? <Card><Text style={{ color: C.muted, fontSize: 13 }}>{notice}</Text></Card> : null}
      {loadErr ? <Card title="Veri alınamadı"><Text style={{ color: C.neg }}>{loadErr}</Text></Card> : null}
      {busy === 'load' && !view ? <Text style={{ color: C.muted }}>Yükleniyor…</Text> : null}

      {view && view.trades.length === 0 && view.open.length === 0 && view.orphans.length === 0 ? (
        <Card><Text style={{ color: C.muted }}>Bu gün için eşleşmiş işlem yok. Alış ve satış ekranlarını yükle.</Text></Card>
      ) : null}

      {view?.trades.map((t, i) => t.report && t.status === 'hazir' ? (
        <CoachReport key={t.sig} r={t.report} index={i + 1} ts={t.ts} />
      ) : (
        <Card key={t.sig} title={`${i + 1}. ${t.tk} ${t.k}${cpLabel(t.cp)} · ${t.qty} adet`}>
          <Text style={{ color: C.muted, fontSize: 13 }}>
            Giriş {hm(t.entryT)} · {px(t.entryPx)} → çıkış {hm(t.exitT)} · {px(t.exitPx)} ({t.legs} bacak). Koçluk bekliyor (birkaç dakika içinde ya da «Bekleyenleri işle» ile).
          </Text>
        </Card>
      ))}

      {view && view.open.length ? (
        <Card title="Açık pozisyonlar">
          <View style={{ gap: 6 }}>
            {view.open.map((o, i) => (
              <Text key={`${o.tk}${o.exp}${o.k}${o.cp}${i}`} style={{ color: C.text, fontSize: 13 }}>
                {o.tk} {o.k}{cpLabel(o.cp)} · {o.exp.slice(5).replace('-', '.')} · kalan {o.qty} adet · giriş {px(o.entryPx)} ({hm(o.entryT)})
                {o.closedQty ? ` · ${o.closedQty} adet ${px(o.closedPx)} fiyatından kapandı` : ''}
              </Text>
            ))}
          </View>
        </Card>
      ) : null}

      {view && view.orphans.length ? (
        <Card title="Açılışı bulunmayan satışlar">
          <Text style={{ color: C.muted, fontSize: 12, marginBottom: 6 }}>Bu satışların alış ekranı yüklenmedi; alışı yükleyince işlem oluşur.</Text>
          <View style={{ gap: 6 }}>
            {view.orphans.map(o => (
              <Text key={o.id} style={{ color: C.text, fontSize: 13 }}>{hm(o.t)} · {o.tk} {o.k}{cpLabel(o.cp)} · {o.q} adet · satış {px(o.px)}</Text>
            ))}
          </View>
        </Card>
      ) : null}

      {view && view.fills.length ? (
        <Card title={`Okunan dolumlar (${view.fills.length})`}>
          <View style={{ gap: 4 }}>
            {view.fills.map(f => (
              <Text key={f.id} style={{ color: C.muted, fontSize: 12 }}>
                {hm(f.t)} · {f.side === 'buy' ? 'alış' : 'satış'} · {f.tk} {f.k}{cpLabel(f.cp)} {f.exp.slice(5).replace('-', '.')} · {f.q} adet · {px(f.px)} · güven {f.conf}
              </Text>
            ))}
          </View>
        </Card>
      ) : null}

      {view ? (
        <Card title="Günün karnesi">
          {view.karne ? (
            <View style={{ gap: 6 }}>
              <Text style={{ color: C.text, fontSize: 13 }}>{view.karne.body.ozet}</Text>
              {view.karne.body.guclu.length ? <Text style={{ color: C.text, fontSize: 13 }}>Güçlü yanlar: {view.karne.body.guclu.join(' · ')}</Text> : null}
              {view.karne.body.tekrarlayanHata.length ? <Text style={{ color: C.text, fontSize: 13 }}>Tekrarlayan hatalar: {view.karne.body.tekrarlayanHata.join(' · ')}</Text> : null}
              <Text style={{ color: C.text, fontWeight: '700', fontSize: 13 }}>Yarın tek odak: {view.karne.body.yarinOdak}</Text>
            </View>
          ) : <Text style={{ color: C.muted, fontSize: 13 }}>Karne henüz yok. Kapanıştan 20 dk sonra otomatik üretilir; istersen şimdi üret.</Text>}
          <Btn label={busy === 'karne' ? 'Üretiliyor…' : view.karne ? 'Karneyi yenile' : 'Karne üret'} onPress={() => { void karne(); }}
            style={{ alignSelf: 'flex-start', marginTop: 8 }} />
        </Card>
      ) : null}

      {view ? <Text style={{ color: C.muted, fontSize: 11 }}>Bu gün: {view.usage.calls} çağrı · girdi {view.usage.inTok} / çıktı {view.usage.outTok} token · bekleyen koçluk {view.pending}</Text> : null}
    </ScrollView>
  );
}

function progressText(q: QueueProgress): string {
  const at = `${q.index + 1}/${q.n}`;
  if (q.phase === 'retry') return `${at} yeniden deneniyor (${Math.ceil((q.waitMs ?? 0) / 1000)} sn)`;
  if (q.phase === 'fail') return `${at} hata`;
  return at;
}
