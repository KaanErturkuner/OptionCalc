/* Paralel değerlendirme işçisi: günleri yükler + ön hesaplar, parametre setlerini metriklere çevirir. */
import { parentPort, workerData } from 'node:worker_threads';
import { loadDays, precompute, run, metrics, type P } from './bt.mts';
const days = loadDays(workerData.tickers); for (const d of days) precompute(d);
const cut: string = workerData.cut;
const train = days.filter(d => d.D < cut), test = days.filter(d => d.D >= cut);
parentPort!.postMessage({ ready: true });
parentPort!.on('message', (m: { id: number; p: P; set: 'train' | 'test' }) => {
  parentPort!.postMessage({ id: m.id, m: metrics(run(m.set === 'train' ? train : test, m.p)) });
});
