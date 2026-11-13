/*
 * Sunucu yapılandırması: ortam değişkenleri (varsayılanlı) + sırlar (systemd LoadCredential dosyaları).
 * Sırlar asla argüman/ortam olarak basılmaz ve loglanmaz. Yalnız `hasMdToken` / `hasAppKey` durumu dışarı verilir.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_THRESHOLDS, DEFAULT_TICKERS, type FlowThresholds } from '../../src/lib/flow/model.ts';
import { DEFAULT_MODEL as DEFAULT_COACH_MODEL } from '../../src/lib/coach/anthropic.ts';

export interface Config {
  host: string; port: number; dbPath: string;
  tickers: string[]; intervalMin: number; confirmsPerPoll: number; pollEnabled: boolean;
  thresholds: FlowThresholds; cooldownMin: number;
  pushMinPremium: number; pushMaxPerDay: number;
  flowDailyCap: number; proxyDailyCap: number; creditReserve: number;
  rateLimitPerMin: number; cacheSec: number;
  mdToken: string; appKey: string; expoAccessToken: string;
  finnhubKey: string; reportsEnabled: boolean;
  anthropicKey: string; coachModel: string; coachFallbackModel: string; coachAuto: boolean; coachDailyCap: number; coachMinGapSec: number;
}

type Env = Record<string, string | undefined>;
const num = (v: string | undefined, d: number) => { const n = v == null || v === '' ? NaN : Number(v); return Number.isFinite(n) ? n : d; };
const list = (v: string | undefined, d: string[]) => (v ? v.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean) : d);

/**
 * Sırrı oku: yalnız DOSYADAN (systemd CREDENTIALS_DIRECTORY veya açık yol). Ortam değişkeni KASITLI olarak desteklenmez:
 * dev kutularındaki ortam tokenı ikinci bir IP'den MarketData çağrısına yol açar (tek IP kuralı).
 */
function secret(env: Env, name: string, file: string | undefined): string {
  const dir = env.CREDENTIALS_DIRECTORY;
  const path = file ?? (dir ? join(dir, name) : undefined);
  if (!path) return '';
  try { return readFileSync(path, 'utf8').trim(); } catch { return ''; }
}

export function loadConfig(env: Env = process.env): Config {
  const th = { ...DEFAULT_THRESHOLDS };
  th.minPremium = num(env.FLOW_MIN_PREMIUM, th.minPremium);
  th.minVolume = num(env.FLOW_MIN_VOLUME, th.minVolume);
  th.minVolOi = num(env.FLOW_MIN_VOL_OI, th.minVolOi);
  th.minMid = num(env.FLOW_MIN_MID, th.minMid);
  th.maxSpreadPct = num(env.FLOW_MAX_SPREAD_PCT, th.maxSpreadPct);
  return {
    host: env.FLOW_HOST || '127.0.0.1',
    port: num(env.FLOW_PORT, 8787),
    dbPath: env.FLOW_DB || '/var/lib/optioncalc-flow/flow.db',
    tickers: list(env.FLOW_TICKERS, DEFAULT_TICKERS),
    intervalMin: Math.max(1, Math.round(num(env.FLOW_INTERVAL_MIN, 2))),
    confirmsPerPoll: Math.max(0, Math.round(num(env.FLOW_CONFIRM_PER_POLL, 6))),
    pollEnabled: (env.FLOW_POLL ?? 'on') !== 'off',
    thresholds: th,
    cooldownMin: num(env.FLOW_COOLDOWN_MIN, 15),
    pushMinPremium: num(env.FLOW_PUSH_MIN_PREMIUM, 100000),
    pushMaxPerDay: num(env.FLOW_PUSH_MAX_PER_DAY, 30),
    flowDailyCap: num(env.FLOW_DAILY_CAP, 10000),       // akış tarayıcısının günlük kredi tavanı
    proxyDailyCap: num(env.PROXY_DAILY_CAP, 40000),     // uygulama proxy'si + akış toplamı üst sınırı
    creditReserve: num(env.FLOW_CREDIT_RESERVE, 5000),  // MarketData'nın kalan kredisi bu eşiğin altına inerse durur
    rateLimitPerMin: num(env.FLOW_RATE_PER_MIN, 120),
    cacheSec: num(env.FLOW_CACHE_SEC, 20),
    mdToken: secret(env, 'md_token', env.FLOW_MD_TOKEN_FILE),
    appKey: secret(env, 'app_key', env.FLOW_APP_KEY_FILE),
    expoAccessToken: secret(env, 'expo_access_token', env.FLOW_EXPO_TOKEN_FILE),
    finnhubKey: secret(env, 'finnhub_key', env.FLOW_FINNHUB_FILE),
    reportsEnabled: (env.REPORTS ?? 'on') !== 'off',
    anthropicKey: secret(env, 'anthropic_key', env.FLOW_ANTHROPIC_FILE),
    coachModel: (env.COACH_MODEL || DEFAULT_COACH_MODEL).trim(),
    // Yedek model YALNIZ açıkça tanımlanırsa devreye girer (birincil 404/model reddi); her kullanımda loglanır ve kayda yazılır.
    coachFallbackModel: (env.COACH_FALLBACK_MODEL || '').trim(),
    coachAuto: (env.COACH_KARNE_AUTO ?? 'on') !== 'off',
    coachDailyCap: num(env.COACH_DAILY_CAP, 20),
    coachMinGapSec: num(env.COACH_MIN_GAP_SEC, 10),
  };
}

/** Dışa verilebilir, sırsız özet (health / dry-run) */
export function publicConfig(c: Config) {
  return {
    tickers: c.tickers, intervalMin: c.intervalMin, confirmsPerPoll: c.confirmsPerPoll, pollEnabled: c.pollEnabled,
    thresholds: c.thresholds, cooldownMin: c.cooldownMin, pushMinPremium: c.pushMinPremium, pushMaxPerDay: c.pushMaxPerDay,
    flowDailyCap: c.flowDailyCap, proxyDailyCap: c.proxyDailyCap, creditReserve: c.creditReserve,
    hasMdToken: c.mdToken.length > 0, hasAppKey: c.appKey.length > 0, hasExpoAccessToken: c.expoAccessToken.length > 0,
    reportsEnabled: c.reportsEnabled, hasFinnhubKey: c.finnhubKey.length > 0,
    hasAnthropicKey: c.anthropicKey.length > 0, coachModel: c.coachModel, coachFallbackModel: c.coachFallbackModel || null,
    coachAuto: c.coachAuto, coachDailyCap: c.coachDailyCap,
  };
}
