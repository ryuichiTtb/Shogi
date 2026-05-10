// Issue #193 / PR1a: 玄翁老師 Strategy (上級・targetReadingPly=5)。
// PR1a では LegacyStrategyAdapter のシン・アダプタ。PR1d でキャラ別ヒューリスティクス充填予定。

import { LegacyStrategyAdapter } from "./legacy-adapter";
import type { SearchStrategyOptions } from "./types";

export class GennoStrategy extends LegacyStrategyAdapter {
  constructor(opts: SearchStrategyOptions = {}) {
    super("genno", "advanced", 5, opts);
  }
}
