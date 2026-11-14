/* Haber kaynakları, birleştirme ve çeviri (saf kısım). Ağ çağrıları test edilmez. */
import { googleQueries, mergeNews, titleKey, feedsFor } from '../src/lib/news/feeds.ts';
import { parseYahooRss } from '../src/lib/news/yahoo.ts';
import { parseGtx } from '../src/lib/news/translate.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info ? ' ' + info : '')); };

const GOOGLE_XML = `<rss><channel><item><title>Micron shares rise on AI demand - Reuters</title><link>https://news.google.com/x1</link><pubDate>Fri, 13 Nov 2026 14:00:00 GMT</pubDate><source url="https://reuters.com">Reuters</source></item></channel></rss>`;
const YAHOO_XML = `<rss><channel><item><title>Micron shares rise on AI demand</title><link>https://finance.yahoo.com/y1</link><pubDate>Fri, 13 Nov 2026 14:05:00 GMT</pubDate></item></channel></rss>`;

const g = parseYahooRss(GOOGLE_XML, ['MU', 'AMD'], 0);
ok('Google RSS: <source> kaynak adını verir', g.length === 1 && g[0].source === 'Reuters', JSON.stringify(g[0]?.source));
ok('Google RSS: MU etiketlenir', g[0]?.tickers.includes('MU') === true);

const merged = mergeNews([g, parseYahooRss(YAHOO_XML, ['MU'], 0)]);
ok('birleştirme: aynı başlık iki kaynakta → tek haber', merged.length === 1, String(merged.length));
ok('başlık anahtarı: noktalama ve büyük/küçük harf yok sayılır', titleKey('Micron, shares RISE!') === titleKey('micron shares rise'));

const qs = googleQueries(['MU', 'AMD', 'NVDA', 'SMH', 'QQQ']);
ok('Google sorguları: 4\'erli gruplar', qs.length === 2 && qs[0] === 'MU OR AMD OR NVDA OR SMH stock' && qs[1] === 'QQQ stock', JSON.stringify(qs));
ok('kaynak listesi: Yahoo + Google grupları + CNBC', feedsFor(['MU', 'AMD']).length === 3 && feedsFor(['MU']).some(f => f.id === 'cnbc'));

const gtx = [[['Mikron hisseleri yapay zeka talebiyle yükseldi', 'Micron shares rise on AI demand', null, null, 1]], null, 'en'];
const p = parseGtx(gtx);
ok('gtx: çeviri metni çıkarılır', p?.text === 'Mikron hisseleri yapay zeka talebiyle yükseldi' && p?.lang === 'en', JSON.stringify(p));
ok('gtx: bozuk yanıt → null', parseGtx({ foo: 1 }) === null);

console.log(fail ? `\n${fail} HABER TESTİ BAŞARISIZ` : '\nHaber testleri geçti');
process.exit(fail ? 1 : 0);
