/* Saat gösterimi: tüm kullanıcıya görünen saatler İstanbul (UTC+3). ABD saatleri (ET) ABD DST'sine göre İstanbul'a çevrilir. */
import { istHM, etToIst } from '../src/lib/usmarket.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info ? ' ' + info : '')); };

// Kış (EST, UTC−5): 13 Kas 2026 → 15:45 ET = 20:45 UTC = 23:45 İstanbul
ok('kış: 15:45 ET → 23:45 TR', etToIst(15, 45, Date.parse('2026-11-13T18:00:00Z')) === '23:45', etToIst(15, 45, Date.parse('2026-11-13T18:00:00Z')));
ok('kış: 09:30 ET açılış → 17:30 TR', etToIst(9, 30, Date.parse('2026-11-13T18:00:00Z')) === '17:30');
// Yaz (EDT, UTC−4): 1 Tem 2026 → 15:45 ET = 19:45 UTC = 22:45 İstanbul
ok('yaz: 15:45 ET → 22:45 TR', etToIst(15, 45, Date.parse('2026-07-01T18:00:00Z')) === '22:45');
ok('yaz: 09:30 ET açılış → 16:30 TR', etToIst(9, 30, Date.parse('2026-07-01T18:00:00Z')) === '16:30');
ok('istHM: sabit UTC+3', istHM(Date.parse('2026-11-13T00:00:00Z')) === '03:00');
ok('istHM: gece yarısı sarması', istHM(Date.parse('2026-11-13T22:30:00Z')) === '01:30');

console.log(fail ? `\n${fail} TEST BAŞARISIZ` : '\nSaat dilimi testleri geçti');
process.exit(fail ? 1 : 0);
