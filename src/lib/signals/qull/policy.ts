/* Qullamaggie setup politikası: kimlikler, ayarlar, varsayılanlar, kâğıt uygunluk kapısı. Saf.
 * Qullamaggie uyarlaması — Kaan onayı yok. Q setupları backtest kriterini geçene kadar kâğıt işleme UYGUN DEĞİL
 * (Q_PAPER_ELIGIBLE boş). Bir Q setup'ı kriteri geçerse bile buraya Kaan onayı olmadan eklenmez. */
import type { QParams, SetupId } from '../types.ts';

export const Q_IDS = ['Q1', 'Q1S', 'Q2', 'Q3'] as const;
export type QId = typeof Q_IDS[number];
export const isQ = (id: string): id is QId => (Q_IDS as readonly string[]).includes(id);

/** Ayarlar. Q1/Q1S/Q2 açık, Q3 (deneysel parabolik short) kapalı. Çıkış uyarlamaları (LOD/HOD, 5 dk EMA10) varsayılan kapalı. */
export interface QSettings { Q1: boolean; Q1S: boolean; Q2: boolean; Q3: boolean; exitLod: boolean; exitEma: boolean }
export const DEFAULT_Q: QSettings = { Q1: true, Q1S: true, Q2: true, Q3: false, exitLod: false, exitEma: false };

export const Q_DEFAULT_PARAMS: QParams = { orMin: 5, volMult: 1.5, gapMult: 1.5 };

/** Kâğıt işleme uygun Q setupları. BOŞ: backtest kriteri henüz geçilmedi ve Kaan onayı yok. */
export const Q_PAPER_ELIGIBLE: ReadonlySet<SetupId> = new Set<SetupId>();
export const Q_NOT_ELIGIBLE = 'Q: backtest kriteri geçilmedi';
/** Her Q metninde ve ayar notunda kullanılan etiket. */
export const Q_LABEL = 'Qullamaggie uyarlaması — Kaan onayı yok';

/** Ayarlardan açık Q setupları (sıra sabit). */
export const enabledQ = (s: QSettings): SetupId[] => Q_IDS.filter(id => s[id]);

/** Ayar nesnesini eksik alanlarla birleştirir (eski kayıtlar için). */
export const mergeQ = (s: Partial<QSettings> | undefined | null): QSettings => ({ ...DEFAULT_Q, ...(s ?? {}) });
