// Koç yükleme kuyruğu (saf): sıralı gönderim, ilerleme, 429 geri çekilme, günlük sınır, anahtar, tek hata devam. Ağ ve saat YOK.
import { runUploadQueue, type QueueItem, type QueueProgress, type SendError } from '../src/lib/coach/queue.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };
const items = (n: number): QueueItem[] => Array.from({ length: n }, (_, i) => ({ base64: 'x', mime: 'image/png', label: `${i + 1}. görüntü` }));
const okRes = { added: 1, inTok: 10, outTok: 5, warnings: [] as string[] };
const err = (status: number | undefined, extra: Partial<SendError> = {}): SendError => ({ status, message: `HTTP ${status ?? 'ağ'}`, ...extra });

async function run(n: number, script: ((i: number, attempt: number) => Promise<typeof okRes> | never)[], opts: { maxAttempts?: number } = {}) {
  const calls: number[] = [];      // gönderilen görüntü indeksleri (deneme dâhil)
  const sleeps: number[] = [];
  const progress: QueueProgress[] = [];
  const attempts = new Map<string, number>();   // görüntü başına deneme sayısı (etiketle)
  const res = await runUploadQueue(items(n), {
    send: async item => {
      const i = Number(item.label.split('.')[0]) - 1;
      const a = (attempts.get(item.label) ?? 0) + 1;
      attempts.set(item.label, a);
      calls.push(i);
      return script[Math.min(script.length - 1, 0)](i, a);
    },
    sleep: async ms => { sleeps.push(ms); },
    onProgress: p => progress.push(p),
    baseDelayMs: 1000, maxDelayMs: 60000, ...opts,
  });
  return { res, calls, sleeps, progress };
}

(async () => {
  // 1) Hepsi başarılı: sıralı, ilerleme n/N ile tamamlanır
  {
    const { res, calls, progress } = await run(3, [async () => okRes]);
    ok('kuyruk: 3/3 başarılı, toplam eklenen 3, token toplamı', res.done === 3 && res.added === 3 && res.inTok === 30 && res.outTok === 15 && res.failed.length === 0 && res.stopped === null);
    ok('kuyruk: sıralı gönderim (her görüntü bir kez)', calls.length === 3);
    ok('kuyruk: her görüntü için send+done ilerlemesi', progress.filter(p => p.phase === 'done').length === 3 && progress.every(p => p.n === 3));
  }
  // 2) 429 (gap): retryAfter kadar bekle, yeniden dene, sonra başarılı
  {
    const { res, sleeps } = await run(1, [async (_i, a) => { if (a === 1) throw err(429, { kind: 'gap', retryAfterSec: 2 }); return okRes; }]);
    ok('kuyruk: 429 gap → bekle (≥ 2 sn) → yeniden dene → başarı', res.done === 1 && res.failed.length === 0 && sleeps.length === 1 && sleeps[0] >= 2000, JSON.stringify(sleeps));
  }
  // 3) Geçici hata (ağ / 5xx): üstel geri çekilme (1 sn, 2 sn), sonra başarılı
  {
    const { res, sleeps } = await run(1, [async (_i, a) => { if (a <= 2) throw err(a === 1 ? undefined : 503); return okRes; }]);
    ok('kuyruk: geçici hata → 1 sn, 2 sn üstel geri çekilme', res.done === 1 && sleeps.join(',') === '1000,2000', sleeps.join(','));
  }
  // 4) Tek görüntü kalıcı hata (422): devam eder, diğerleri işlenir
  {
    const { res, calls } = await run(3, [async (i) => { if (i === 1) throw err(422, { message: 'Görüntüde işlem satırı okunamadı' }); return okRes; }]);
    ok('kuyruk: tek 422 → yalnız o görüntü başarısız, kalan devam', res.done === 2 && res.failed.length === 1 && res.failed[0].index === 1 && res.failed[0].label === '2. görüntü' && calls.length === 3 && res.stopped === null);
  }
  // 5) Günlük sınır (429 daily): dur, kalanlar atlanır
  {
    const { res, calls } = await run(5, [async (i) => { if (i === 2) throw err(429, { kind: 'daily', message: 'günlük' }); return okRes; }]);
    ok('kuyruk: günlük sınır → dur, 2 atlandı (3,4,5 gönderilmedi)', res.stopped === 'Günlük yükleme sınırı doldu' && res.done === 2 && res.skipped === 3 && calls.length === 3, JSON.stringify(res));
  }
  // 6) Anahtar yanlış (401): dur
  {
    const { res } = await run(4, [async (i) => { if (i === 0) throw err(401, { message: 'anahtar' }); return okRes; }]);
    ok('kuyruk: 401 → dur, hepsi atlanır', res.stopped !== null && res.done === 0 && res.skipped === 4 && res.failed.length === 0);
  }
  // 7) Sürekli gap: maksimum deneme sonunda kalıcı hata, devam
  {
    const { res, sleeps } = await run(2, [async (i, a) => { if (i === 0) throw err(429, { kind: 'gap', retryAfterSec: 1 }); return okRes; }], { maxAttempts: 3 });
    ok('kuyruk: 3 denemeden sonra kalıcı hata, ikinci görüntü yine gönderilir', res.failed.length === 1 && res.done === 1 && sleeps.length === 2, JSON.stringify({ f: res.failed.length, d: res.done, s: sleeps }));
  }
  // 8) Uyarılar birleşir (tekrarsız)
  {
    const { res } = await run(2, [async () => ({ ...okRes, warnings: ['Koçluk yanıtı doğrulanamadı'] })]);
    ok('kuyruk: aynı uyarı bir kez listelenir', res.warnings.length === 1);
  }
  // 9) Boş liste
  {
    const r = await runUploadQueue([], { send: async () => okRes, sleep: async () => {} });
    ok('kuyruk: boş liste → 0/0', r.n === 0 && r.done === 0 && r.skipped === 0);
  }
  console.log(fail ? `\n${fail} BAŞARISIZ` : '\nTüm yükleme kuyruğu testleri geçti');
  process.exit(fail ? 1 : 0);
})();
