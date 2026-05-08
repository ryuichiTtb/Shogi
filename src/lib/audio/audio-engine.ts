// Issue #189: SFX を Web Audio API 直接実装に置換するためのエンジン。
//
// 旧実装 (Howler) の課題:
// - Howler の autoUnlock タイミングが不透明で、モバイル Safari の初回 SFX が
//   無音/遅延する症状が残っていた (Issue #79 の保留課題)
// - useSound 経路と playSfxOnce 経路の 2 系統に Howl キャッシュが分裂し、
//   mute 状態を setSfxOnceMuted で二重同期する必要があり保守性が低かった
//
// 本エンジンの設計:
// - module-level の AudioContext シングルトンを lazy 生成
// - playSfxBuffer / playSfxBufferOnce 内部で `void unlockAudio()` を呼ぶ
//   ことで、SFX 呼出自体が user gesture 同期で AudioContext を resume する
// - SFX は AudioBuffer に decode 済みの状態でキャッシュ → 再生レイテンシは数 ms
// - AudioBufferSourceNode は使い捨て (毎回新規) なので連打が完璧に並行再生
// - playSfxBufferOnce は同 path の最後の source を `stop()` してから新規 start
// - マスタ GainNode で mute 統合 (setSfxMuted)
// - statechange interrupted (iOS 通話着信等) → 即 resume + 失敗時 user gesture 待ち

const SFX_VOLUME = 0.7;

interface AudioCtxConstructor {
  new (): AudioContext;
}

// AudioContext.state の標準型は "suspended" | "running" | "closed" のみだが、
// iOS Safari は "interrupted" 状態 (通話着信等) を返す。文字列比較に揃える。
function isRunning(state: AudioContext["state"]): boolean {
  return (state as string) === "running";
}

function needsResume(state: AudioContext["state"]): boolean {
  const s = state as string;
  return s === "suspended" || s === "interrupted";
}

// =====================
// AudioContext シングルトン
// =====================

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let stateChangeAttached = false;

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioCtx) return audioCtx;
  // Webkit prefix (古い Safari 対応)
  const Ctor: AudioCtxConstructor | undefined =
    (window as unknown as { AudioContext?: AudioCtxConstructor }).AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioCtxConstructor })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
  } catch {
    audioCtx = null;
    return null;
  }
  masterGain = audioCtx.createGain();
  masterGain.gain.value = isMuted ? 0 : 1;
  masterGain.connect(audioCtx.destination);
  attachStateChangeHandler();
  return audioCtx;
}

export function getAudioCtx(): AudioContext | null {
  return ensureCtx();
}

// =====================
// unlock (resume) 制御
// =====================
//
// AudioContext.resume() は user gesture イベントハンドラ内で呼ぶ必要がある。
// playSfxBuffer / playSfxBufferOnce の内部から呼ぶことで、SFX 発火そのものが
// user gesture 経路に乗っている状態 (= ボタン onClick 等から呼ばれる) を活かす。
// gesture 外から呼ばれて resume が完了しなかった場合に備えて user gesture 待ち
// フォールバックも持つ。

let unlockRetryAttached = false;

function attachUnlockRetry(): void {
  if (unlockRetryAttached) return;
  if (typeof window === "undefined") return;
  unlockRetryAttached = true;
  const onGesture = (): void => {
    if (!audioCtx) {
      detachUnlockRetry();
      return;
    }
    if (needsResume(audioCtx.state)) {
      audioCtx.resume().catch(() => {
        // まだ block されている → listener 保持
      });
      return;
    }
    detachUnlockRetry();
  };
  window.addEventListener("click", onGesture);
  window.addEventListener("touchstart", onGesture);
  window.addEventListener("keydown", onGesture);
  unlockRetryHandler = onGesture;
}

let unlockRetryHandler: ((e?: Event) => void) | null = null;

function detachUnlockRetry(): void {
  if (!unlockRetryAttached) return;
  unlockRetryAttached = false;
  if (typeof window !== "undefined" && unlockRetryHandler) {
    window.removeEventListener("click", unlockRetryHandler);
    window.removeEventListener("touchstart", unlockRetryHandler);
    window.removeEventListener("keydown", unlockRetryHandler);
  }
  unlockRetryHandler = null;
}

function attachStateChangeHandler(): void {
  if (stateChangeAttached || !audioCtx) return;
  stateChangeAttached = true;
  audioCtx.addEventListener("statechange", () => {
    if (!audioCtx) return;
    // iOS の interrupted (通話着信等) や suspended に落ちた場合は resume を試行。
    // 即時失敗しても次の user gesture 待ちフォールバックに乗せる。
    if (needsResume(audioCtx.state)) {
      audioCtx
        .resume()
        .then(() => {
          if (audioCtx && isRunning(audioCtx.state)) {
            detachUnlockRetry();
          } else {
            attachUnlockRetry();
          }
        })
        .catch(() => {
          attachUnlockRetry();
        });
    }
  });
}

/**
 * AudioContext を unlock する。AudioContext 未生成なら生成も行う。
 * await して unlock 完了を保証したい場合に呼び出す (例: 対局開始ボタン)。
 * playSfxBuffer / playSfxBufferOnce 内部からは fire-and-forget で呼ばれる。
 */
export async function unlockAudio(): Promise<void> {
  const ctx = ensureCtx();
  if (!ctx) return;
  if (isRunning(ctx.state)) return;
  try {
    await ctx.resume();
    if (isRunning(ctx.state)) {
      detachUnlockRetry();
    } else {
      attachUnlockRetry();
    }
  } catch {
    // user gesture 外で呼ばれた等。次のジェスチャを待つ。
    attachUnlockRetry();
  }
}

// =====================
// AudioBuffer キャッシュ
// =====================

const bufferCache = new Map<string, AudioBuffer>();
const bufferLoadingCache = new Map<string, Promise<AudioBuffer | null>>();

/**
 * SFX を fetch + decode して AudioBuffer に変換し、キャッシュする。
 * - 空文字 path は no-op (manifest の game_over / game_start のような
 *   未割当キー対策)
 * - 同一 path の並行ロードは Promise を共有して二重 fetch しない
 * - decode 失敗時は当該 key のみ skip (例外を伝播しない)
 */
export async function loadSfxBuffer(path: string): Promise<AudioBuffer | null> {
  if (!path) return null;
  if (typeof window === "undefined") return null;
  const cached = bufferCache.get(path);
  if (cached) return cached;
  const loading = bufferLoadingCache.get(path);
  if (loading) return loading;
  const ctx = ensureCtx();
  if (!ctx) return null;
  const promise = (async (): Promise<AudioBuffer | null> => {
    try {
      const res = await fetch(path);
      if (!res.ok) return null;
      const arr = await res.arrayBuffer();
      // Safari 互換のために callback 形式 fallback も用意 (decodeAudioData の
      // Promise 形式は iOS 14+ で対応済みのため通常は await で動作する)
      const buf = await decodeAudio(ctx, arr);
      if (!buf) return null;
      bufferCache.set(path, buf);
      return buf;
    } catch {
      return null;
    } finally {
      bufferLoadingCache.delete(path);
    }
  })();
  bufferLoadingCache.set(path, promise);
  return promise;
}

function decodeAudio(
  ctx: AudioContext,
  arr: ArrayBuffer,
): Promise<AudioBuffer | null> {
  return new Promise((resolve) => {
    let settled = false;
    const onSuccess = (b: AudioBuffer): void => {
      if (settled) return;
      settled = true;
      resolve(b);
    };
    const onError = (): void => {
      if (settled) return;
      settled = true;
      resolve(null);
    };
    try {
      const maybe = ctx.decodeAudioData(arr, onSuccess, onError);
      if (maybe && typeof maybe.then === "function") {
        maybe.then(onSuccess).catch(onError);
      }
    } catch {
      onError();
    }
  });
}

// =====================
// 再生
// =====================

// 直前の SFX source (key 別)。playSfxBufferOnce で連打時の重なり防止用。
const lastOnceSource = new Map<string, AudioBufferSourceNode>();

interface PlayOptions {
  volume?: number;
}

/**
 * SFX を再生する (連打 OK)。fire-and-forget で source は GC 任せ。
 * AudioBuffer が未ロードならロードしてから再生する。
 */
export function playSfxBuffer(path: string, options?: PlayOptions): void {
  if (!path) return;
  // user gesture 同期で AudioContext を unlock (suspended のときのみ resume)
  void unlockAudio();
  const ctx = ensureCtx();
  if (!ctx || !masterGain) return;

  const cached = bufferCache.get(path);
  if (cached) {
    startSource(ctx, cached, options, null);
    return;
  }
  // 未ロードならロード → 再生
  void loadSfxBuffer(path).then((buf) => {
    if (!buf || !audioCtx || !masterGain) return;
    startSource(audioCtx, buf, options, null);
  });
}

/**
 * SFX を「重ねず」再生する。直前の同 path source を stop してから新規 start。
 * 連打時の重なりを防ぐ用途 (画面遷移ボタン等で旧 playSfxOnce 互換)。
 */
export function playSfxBufferOnce(path: string, options?: PlayOptions): void {
  if (!path) return;
  void unlockAudio();
  const ctx = ensureCtx();
  if (!ctx || !masterGain) return;

  // 直前の同 path source を停止 (重なり防止)
  const prev = lastOnceSource.get(path);
  if (prev) {
    try {
      prev.stop();
    } catch {
      // 既に停止済み
    }
    lastOnceSource.delete(path);
  }

  const cached = bufferCache.get(path);
  if (cached) {
    startSource(ctx, cached, options, path);
    return;
  }
  void loadSfxBuffer(path).then((buf) => {
    if (!buf || !audioCtx || !masterGain) return;
    startSource(audioCtx, buf, options, path);
  });
}

function startSource(
  ctx: AudioContext,
  buffer: AudioBuffer,
  options: PlayOptions | undefined,
  onceKey: string | null,
): void {
  if (!masterGain) return;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = options?.volume ?? SFX_VOLUME;
  source.connect(gain);
  gain.connect(masterGain);
  try {
    source.start();
  } catch {
    return;
  }
  if (onceKey) {
    lastOnceSource.set(onceKey, source);
    source.addEventListener("ended", () => {
      if (lastOnceSource.get(onceKey) === source) {
        lastOnceSource.delete(onceKey);
      }
    });
  }
}

// =====================
// mute 制御
// =====================

let isMuted = false;

/**
 * SFX 全体の mute 状態を切替える。マスタ GainNode を 0/1 に設定する。
 */
export function setSfxMuted(muted: boolean): void {
  isMuted = muted;
  if (masterGain) {
    masterGain.gain.value = muted ? 0 : 1;
  }
}

export function isSfxMuted(): boolean {
  return isMuted;
}

// =====================
// test-only: 内部 state リセット
// =====================
//
// 本番コードからは使用しないこと。

export const __forTest = {
  reset: (): void => {
    if (audioCtx) {
      try {
        void audioCtx.close();
      } catch {
        // ignore
      }
    }
    audioCtx = null;
    masterGain = null;
    stateChangeAttached = false;
    bufferCache.clear();
    bufferLoadingCache.clear();
    lastOnceSource.clear();
    isMuted = false;
    detachUnlockRetry();
  },
  getCtx: (): AudioContext | null => audioCtx,
  getBufferCache: (): Map<string, AudioBuffer> => bufferCache,
  getMasterGain: (): GainNode | null => masterGain,
  getLastOnceSource: (): Map<string, AudioBufferSourceNode> => lastOnceSource,
};
