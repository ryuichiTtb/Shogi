// Issue #193 / PR1a: さくら Strategy (初級・targetReadingPly=1)。
// PR1a では LegacyStrategyAdapter のシン・アダプタ。PR1d でキャラ別ヒューリスティクス充填予定。

import { LegacyStrategyAdapter } from "./legacy-adapter";
import type { SearchStrategyOptions } from "./types";

export class SakuraStrategy extends LegacyStrategyAdapter {
  constructor(opts: SearchStrategyOptions = {}) {
    super("sakura", "beginner", 1, opts);
  }
}
