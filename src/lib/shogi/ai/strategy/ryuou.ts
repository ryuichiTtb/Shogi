// Issue #193 / PR1a: 龍王 Strategy (超上級・targetReadingPly=6)。
// PR1a では LegacyStrategyAdapter のシン・アダプタ。PR1d でキャラ別ヒューリスティクス充填予定。

import { LegacyStrategyAdapter } from "./legacy-adapter";
import type { SearchStrategyOptions } from "./types";

export class RyuouStrategy extends LegacyStrategyAdapter {
  constructor(opts: SearchStrategyOptions = {}) {
    super("ryuou", "expert", 6, opts);
  }
}
