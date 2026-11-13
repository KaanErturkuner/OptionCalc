/* Dry-run kaynağı: önceden kaydedilmiş (sentetik) yanıtlar. Ağ YOK; MarketData'ya hiç istek atılmaz. */
import type { MdReply } from './md.ts';
import type { ChainSource } from './poller.ts';

export interface FixturePoll { at: string; chains: Record<string, any>; quotes?: Record<string, any> }
export class FixtureSource implements ChainSource {
  i = 0;
  calls = { chain: 0, quote: 0 };
  private readonly polls: FixturePoll[];
  constructor(polls: FixturePoll[]) { this.polls = polls; }
  private cur(): FixturePoll { return this.polls[Math.min(this.i, this.polls.length - 1)]; }
  private reply(json: any): MdReply {
    return { status: json?.s === 'no_data' ? 204 : 200, text: '', json: json ?? { s: 'no_data' }, consumed: 1, remaining: null };
  }
  async chain(ticker: string): Promise<MdReply> { this.calls.chain++; return this.reply(this.cur().chains[ticker] ?? null); }
  async quote(occ: string): Promise<MdReply> { this.calls.quote++; return this.reply(this.cur().quotes?.[occ] ?? null); }
}
