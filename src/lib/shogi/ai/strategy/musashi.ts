// Issue #193 / PR1a: 武蔵 Strategy (中級・targetReadingPly=3)。
// PR1a では LegacyStrategyAdapter のシン・アダプタ。PR1d でキャラ別ヒューリスティクス充填予定。

import { LegacyStrategyAdapter } from "./legacy-adapter";
import type { SearchStrategyOptions } from "./types";

export class MusashiStrategy extends LegacyStrategyAdapter {
  constructor(opts: SearchStrategyOptions = {}) {
    super("musashi", "intermediate", 3, opts);
  }
}
