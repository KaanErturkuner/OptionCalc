/* Sözlük tabanlı haber sınıflandırma: etiket + duygu işareti (LLM özetleme kapsam dışı). */
const RULES: [RegExp, string, number][] = [
  [/downgrad/i, 'downgrade', -0.6],
  [/guidance (cut|lower|lowered)|(cuts?|lowers?|slash(es)?) (its )?(guidance|outlook|forecast)|warns? (on|of)/i, 'guidance cut', -0.8],
  [/offering|share sale|dilution|at-the-market/i, 'offering', -0.6],
  [/SEC (probe|investigation|subpoena)|subpoena|investigation|probe/i, 'SEC probe', -0.7],
  [/lawsuit|sues|sued|class action/i, 'lawsuit', -0.5],
  [/misses?( estimates| expectations)?|below (estimates|expectations)/i, 'miss', -0.6],
  [/concerns?|worr(y|ies)|risks?\b/i, 'concern', -0.3],
  [/beats?|tops? (estimates|expectations)|better[- ]than/i, 'beat', 0.6],
  [/raises? (its )?(guidance|outlook|forecast)|boosts? (guidance|outlook)/i, 'raise', 0.7],
  [/upgrad/i, 'upgrade', 0.6],
  [/contract|wins? (an? )?(order|deal)|awarded/i, 'contract', 0.5],
  [/partner(ship)?|collaborat/i, 'partnership', 0.4],
  [/insider (sell|sold|selling)|sells? shares/i, 'insider sale', -0.4],
  [/insider (buy|bought)|buys? shares/i, 'insider buy', 0.4],
];
/** Etiketler ve en güçlü (|x| en büyük) duygu değeri. Eşleşme yoksa sentiment 0, tags boş. */
export function classify(text: string): { tags: string[]; sentiment: number } {
  const tags: string[] = []; let best = 0;
  for (const [re, tag, v] of RULES) if (re.test(text)) { tags.push(tag); if (Math.abs(v) > Math.abs(best)) best = v; }
  return { tags, sentiment: Math.max(-1, Math.min(1, best)) };
}
