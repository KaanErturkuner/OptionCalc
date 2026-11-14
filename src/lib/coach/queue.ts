/*
 * Koç yükleme kuyruğu (saf; ağ ve zamanlayıcı enjekte edilir). Sıralı gönderim, ilerleme "n/N",
 * 429 (gap) ve geçici hatalarda üstel geri çekilme, 429 (daily) / 401'de dur, tek görüntü hatasında devam.
 */
export interface QueueItem { base64: string; mime: 'image/jpeg' | 'image/png'; label: string }

/** Ağ katmanının hata biçimi: HTTP hatasında status; ağ/zaman aşımında status yok. */
export interface SendError { status?: number; kind?: 'gap' | 'daily'; retryAfterSec?: number; message: string }

export interface SendOk { added: number; inTok: number; outTok: number; warnings: string[] }

export interface QueueProgress { index: number; n: number; phase: 'send' | 'retry' | 'done' | 'fail' | 'stop'; attempt: number; waitMs?: number; message?: string }

export interface QueueDeps {
  send: (item: QueueItem) => Promise<SendOk>;
  sleep: (ms: number) => Promise<void>;
  onProgress?: (p: QueueProgress) => void;
  maxAttempts?: number;     // görüntü başına (varsayılan 4)
  baseDelayMs?: number;     // üstel geri çekilme tabanı (varsayılan 3000)
  maxDelayMs?: number;      // tavan (varsayılan 60000)
}

export interface QueueResult {
  n: number; done: number; added: number; inTok: number; outTok: number; warnings: string[];
  failed: { index: number; label: string; message: string }[];
  skipped: number;           // durdurma nedeniyle gönderilmeyen görüntü sayısı
  stopped: string | null;    // durdurma nedeni (günlük sınır, anahtar)
}

export async function runUploadQueue(items: QueueItem[], deps: QueueDeps): Promise<QueueResult> {
  const max = deps.maxAttempts ?? 4, base = deps.baseDelayMs ?? 3000, cap = deps.maxDelayMs ?? 60000;
  const n = items.length;
  const res: QueueResult = { n, done: 0, added: 0, inTok: 0, outTok: 0, warnings: [], failed: [], skipped: 0, stopped: null };
  const emit = (p: QueueProgress) => deps.onProgress?.(p);
  for (let i = 0; i < n; i++) {
    const item = items[i];
    let attempt = 0;
    for (;;) {
      attempt++;
      emit({ index: i, n, phase: 'send', attempt });
      try {
        const r = await deps.send(item);
        res.done++; res.added += r.added; res.inTok += r.inTok; res.outTok += r.outTok;
        for (const w of r.warnings) if (!res.warnings.includes(w)) res.warnings.push(w);
        emit({ index: i, n, phase: 'done', attempt });
        break;
      } catch (e) {
        const err = e as SendError;
        if (err.status === 429 && err.kind === 'daily') { res.stopped = 'Günlük yükleme sınırı doldu'; return stop(res, i, n, emit); }
        if (err.status === 401) { res.stopped = 'Akış anahtarı yanlış (Hesapla › Ayarlar)'; return stop(res, i, n, emit); }
        const retriable = err.status === undefined || err.status === 429 || err.status >= 500;
        if (!retriable || attempt >= max) {
          res.failed.push({ index: i, label: item.label, message: err.message });
          emit({ index: i, n, phase: 'fail', attempt, message: err.message });
          break;
        }
        const backoff = Math.min(cap, base * 2 ** (attempt - 1));
        const waitMs = err.status === 429 && err.retryAfterSec ? Math.min(cap, Math.max(backoff, err.retryAfterSec * 1000)) : backoff;
        emit({ index: i, n, phase: 'retry', attempt, waitMs, message: err.message });
        await deps.sleep(waitMs);
      }
    }
  }
  return res;
}

function stop(res: QueueResult, i: number, n: number, emit: (p: QueueProgress) => void): QueueResult {
  // gönderilmemiş: n − başarılı − kalıcı hata (durdurulan görüntü dâhil)
  res.skipped = n - res.done - res.failed.length;
  emit({ index: i, n, phase: 'stop', attempt: 0, message: res.stopped ?? undefined });
  return res;
}
