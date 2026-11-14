/*
 * Raporlar ekranı gruplama (saf): gün klasörü (en yeni önce) ve kutu başlığı ("17:00 Raporu", "Gün Sonu Raporu").
 * Kutu saati slotun kendi saatidir (üretim anı değil); kutu sırası: piyasa öncesi → açılış +30 dk … → gün sonu.
 */
import { istHm, KIND_LABEL, REPORT_KINDS, slotsFor } from './schedule.ts';
import type { ReportSections } from './types.ts';

const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

export interface GroupableReport { id: number; kind: string; day: string; ts: number; title: string; body: string; example?: boolean; sections?: ReportSections | null }
export interface ReportBox extends GroupableReport { example: boolean; boxTitle: string }
export interface DayFolder { day: string; label: string; count: number; examples: number; items: ReportBox[] }

/** YYYY-MM-DD → haftanın günü (Türkçe) */
export function weekdayTr(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "2026-11-13" → "13/11/26 Cuma Raporları" */
export function dayFolderLabel(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y.slice(2)} ${weekdayTr(day)} Raporları`;
}

/** Kutu başlığı: slotun İstanbul saati ("17:00 Raporu"); gün sonu "Gün Sonu Raporu". Slot bulunamazsa ts kullanılır. */
export function reportBoxTitle(kind: string, day: string, ts?: number): string {
  if (kind === 'eod') return 'Gün Sonu Raporu';
  const at = slotsFor(day).find(s => s.kind === kind)?.atMs ?? ts;
  if (at == null) return `${KIND_LABEL[kind as keyof typeof KIND_LABEL] ?? kind} Raporu`;
  return `${istHm(at)} Raporu`;
}

const kindOrder = (kind: string) => { const i = REPORT_KINDS.indexOf(kind as (typeof REPORT_KINDS)[number]); return i < 0 ? 99 : i; };

/**
 * Raporları gün klasörlerine böl. Gün: yeni → eski. Gün içi: tür sırası; aynı türde gerçek rapor önce, örnek sonra.
 */
export function groupByDay(items: GroupableReport[]): DayFolder[] {
  const byDay = new Map<string, ReportBox[]>();
  for (const r of items) {
    const box: ReportBox = { ...r, example: !!r.example, boxTitle: reportBoxTitle(r.kind, r.day, r.ts) };
    const xs = byDay.get(r.day) ?? [];
    xs.push(box);
    byDay.set(r.day, xs);
  }
  return [...byDay.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)).map(day => {
    const xs = byDay.get(day)!.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || Number(a.example) - Number(b.example) || b.id - a.id);
    return { day, label: dayFolderLabel(day), count: xs.length, examples: xs.filter(x => x.example).length, items: xs };
  });
}
