export const C = {
  bg: '#0a0f1c', card: '#121a2c', card2: '#18223a', border: '#24304d', text: '#e6ebf5', muted: '#8b97ad',
  accent: '#3b82f6', accentSoft: 'rgba(59,130,246,.18)', pos: '#22c55e', neg: '#ef4444', warn: '#facc15', blue: '#60a5fa',
  input: '#0d1424',
};
export const plColor = (x: number) => x > 0.005 ? C.pos : x < -0.005 ? C.neg : C.text;
export const mono = { fontVariant: ['tabular-nums' as const] };
