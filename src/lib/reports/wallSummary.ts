/* Duvar bölümü daraltılmış başlık özeti: "QQQ: CW 710 · PW 650" (her ticker için; CW call duvarı, PW put duvarı).
 * Saf fonksiyon; UI (Raporlar › Duvarlar ve birikim başlığı) kullanır. Ağ YOK. */
import { levelText } from './sections.ts';
import type { WallRow } from './types.ts';

/** Ticker başına "TICK: CW x · PW y"; değer yoksa "—"; duvar listesi boşsa null (çağıran "veri alınamadı" yazar). */
export function wallSummaryLine(walls: WallRow[]): string | null {
  if (!walls.length) return null;
  return walls.map(w => `${w.ticker}: CW ${levelText(w.callWall) ?? '—'} · PW ${levelText(w.putWall) ?? '—'}`).join('  |  ');
}
