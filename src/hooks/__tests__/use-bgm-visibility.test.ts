// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BGM_FILES } from "@/lib/audio/manifest";
import { __forTest, prepareBgmForNavigation, setBgmMuted } from "../use-bgm";

// Issue #189: visibilitychange / pagehide / pageshow による BGM 自動 pause / resume
// の挙動を検証する。HTMLMediaElement.play / pause は jsdom で実装されないため
// prototype レベルでスタブする。

const ORIGINAL_PLAY = HTMLMediaElement.prototype.play;
const ORIGINAL_PAUSE = HTMLMediaElement.prototype.pause;
const ORIGINAL_LOAD = HTMLMediaElement.prototype.load;
const ORIGINAL_PAUSED_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  HTMLMediaElement.prototype,
  "paused",
);

let playMock: ReturnType<typeof vi.fn>;
let pauseMock: ReturnType<typeof vi.fn>;
// jsdom HTMLAudioElement は play/pause で paused プロパティを自動更新しないため
// テスト用にグローバルな pausedRef で状態を擬似的に共有する。1 テストにつき
// audio 1 つ (旧 audio destroy → 新 audio 構築) しか同時には扱わない前提。
let pausedRef = true;

function setVisibility(state: "hidden" | "visible"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

function fireVisibilityChange(): void {
  document.dispatchEvent(new Event("visibilitychange"));
}

function firePageHide(persisted: boolean): void {
  // PageTransitionEvent は jsdom で対応していないため Event + persisted を持つ
  // オブジェクトとしてキャストする (実装側は e.persisted のみ参照する)
  const e = new Event("pagehide") as Event & { persisted: boolean };
  Object.defineProperty(e, "persisted", { value: persisted });
  window.dispatchEvent(e);
}

function firePageShow(persisted: boolean): void {
  const e = new Event("pageshow") as Event & { persisted: boolean };
  Object.defineProperty(e, "persisted", { value: persisted });
  window.dispatchEvent(e);
}

beforeEach(() => {
  vi.useFakeTimers();
  pausedRef = true;
  playMock = vi.fn().mockImplementation(() => {
    pausedRef = false;
    return Promise.resolve();
  });
  pauseMock = vi.fn().mockImplementation(() => {
    pausedRef = true;
  });
  HTMLMediaElement.prototype.play = playMock as unknown as () => Promise<void>;
  HTMLMediaElement.prototype.pause = pauseMock as unknown as () => void;
  // jsdom は load() を未実装で console エラーを出すため no-op で上書き
  HTMLMediaElement.prototype.load = (() => {}) as () => void;
  Object.defineProperty(HTMLMediaElement.prototype, "paused", {
    configurable: true,
    get: () => pausedRef,
  });
  setVisibility("visible");
  __forTest.resetState();
  // resetState 内で旧 audio に対する pause を呼ぶケースがあるため、テスト
  // ケースでカウントを観測する前に mock をクリアする。
  playMock.mockClear();
  pauseMock.mockClear();
});

afterEach(() => {
  HTMLMediaElement.prototype.play = ORIGINAL_PLAY;
  HTMLMediaElement.prototype.pause = ORIGINAL_PAUSE;
  HTMLMediaElement.prototype.load = ORIGINAL_LOAD;
  if (ORIGINAL_PAUSED_DESCRIPTOR) {
    Object.defineProperty(
      HTMLMediaElement.prototype,
      "paused",
      ORIGINAL_PAUSED_DESCRIPTOR,
    );
  }
  vi.useRealTimers();
});

describe("use-bgm: ページ可視性連動", () => {
  it("hidden 化で 200ms 後に audio.pause() が呼ばれる", async () => {
    __forTest.startBgm("bgm_home", "/sounds/test.mp3");
    // play() Promise を flush
    await vi.runOnlyPendingTimersAsync();
    expect(playMock).toHaveBeenCalled();
    expect(__forTest.getCurrentAudio()).not.toBeNull();

    setVisibility("hidden");
    fireVisibilityChange();

    // 200ms (HIDE_FADE_MS) + 30ms 余裕より前は pause していない
    expect(pauseMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(229);
    expect(pauseMock).not.toHaveBeenCalled();

    // 完全に進むと pause される
    vi.advanceTimersByTime(2);
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(__forTest.getWasPlayingBeforeHidden()).toBe(true);
  });

  it("hidden → visible 復帰で audio.play() が再呼出され fade-in する", async () => {
    __forTest.startBgm("bgm_home", "/sounds/test.mp3");
    await vi.runOnlyPendingTimersAsync();
    expect(playMock).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    fireVisibilityChange();
    vi.advanceTimersByTime(300);
    expect(pauseMock).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    fireVisibilityChange();

    // resume で再 play() が呼ばれる
    expect(playMock).toHaveBeenCalledTimes(2);
    // wasPlayingBeforeHidden は復帰時にリセットされる
    expect(__forTest.getWasPlayingBeforeHidden()).toBe(false);
  });

  it("hidden 直後に visible に戻ると pause がスキップされる (fade 中の復帰)", async () => {
    __forTest.startBgm("bgm_home", "/sounds/test.mp3");
    await vi.runOnlyPendingTimersAsync();

    setVisibility("hidden");
    fireVisibilityChange();
    // フェード完了前に visible 復帰
    vi.advanceTimersByTime(50);
    setVisibility("visible");
    fireVisibilityChange();
    // 残り時間も進めて setTimeout コールバックを発火させる
    vi.advanceTimersByTime(300);

    // setTimeout 内で visibilityState を再チェックして pause skip
    expect(pauseMock).not.toHaveBeenCalled();
    // 復帰側の play() は呼ばれている (resume で 2 回目)
    expect(playMock).toHaveBeenCalledTimes(2);
  });

  it("既に visible / 再生中で wasPlayingBeforeHidden=false の場合、visibilitychange visible は no-op", async () => {
    __forTest.startBgm("bgm_home", "/sounds/test.mp3");
    await vi.runOnlyPendingTimersAsync();
    expect(playMock).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    fireVisibilityChange();
    // play() は再呼出しされない
    expect(playMock).toHaveBeenCalledTimes(1);
  });

  it("mute=true 状態で hidden に入っても pause + 復帰時 fade 0→0 で再生継続される", async () => {
    __forTest.startBgm("bgm_home", "/sounds/test.mp3");
    await vi.runOnlyPendingTimersAsync();
    setBgmMuted(true);
    const audio = __forTest.getCurrentAudio();
    expect(audio).not.toBeNull();
    expect(audio!.volume).toBe(0);

    setVisibility("hidden");
    fireVisibilityChange();
    vi.advanceTimersByTime(300);
    // mute 中も「volume=0 で再生継続中」扱いなので pause される
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(__forTest.getWasPlayingBeforeHidden()).toBe(true);

    setVisibility("visible");
    fireVisibilityChange();
    expect(playMock).toHaveBeenCalledTimes(2);
    // 復帰時の target volume は mute 維持で 0
    // (a.volume は play().then 内で 0 にセットされるが、resolve 待ちで即時には反映されない。
    //  ここでは play が呼ばれたことだけを最終確認とする)
  });

  it("pagehide (persisted=false) で即時 audio.pause() が呼ばれる", async () => {
    __forTest.startBgm("bgm_home", "/sounds/test.mp3");
    await vi.runOnlyPendingTimersAsync();

    firePageHide(false);
    // 即時 pause (フェード待ちなし)
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(__forTest.getWasPlayingBeforeHidden()).toBe(true);
  });

  it("pagehide (persisted=true / bfcache 経路) では pause しない", async () => {
    __forTest.startBgm("bgm_home", "/sounds/test.mp3");
    await vi.runOnlyPendingTimersAsync();

    firePageHide(true);
    expect(pauseMock).not.toHaveBeenCalled();
    // bfcache 経路は pageshow.persisted=true で再構築される想定なので
    // wasPlayingBeforeHidden もここでは設定しない
    expect(__forTest.getWasPlayingBeforeHidden()).toBe(false);
  });

  it("pageshow (persisted=true) で wasPlayingBeforeHidden がリセットされ二重 play が起きない", async () => {
    __forTest.startBgm("bgm_home", "/sounds/test.mp3");
    await vi.runOnlyPendingTimersAsync();

    // hidden → bfcache に入る経路を再現
    setVisibility("hidden");
    fireVisibilityChange();
    vi.advanceTimersByTime(300);
    expect(__forTest.getWasPlayingBeforeHidden()).toBe(true);

    // bfcache 復帰: pageshow.persisted=true で audio 再構築
    setVisibility("visible");
    firePageShow(true);

    // 再構築によって新規 play() が呼ばれる (= 2 回目)
    await vi.runOnlyPendingTimersAsync();
    expect(playMock).toHaveBeenCalledTimes(2);
    // visibilitychange visible が後発しても二重 play しないこと
    fireVisibilityChange();
    expect(playMock).toHaveBeenCalledTimes(2);
    expect(__forTest.getWasPlayingBeforeHidden()).toBe(false);
  });
});

describe("use-bgm: prepareBgmForNavigation の prepared audio フロー", () => {
  it("同 path への遷移準備では prepared audio を作らず currentAudio も触らない", async () => {
    const matchPath = BGM_FILES.bgm_match_setup!;
    __forTest.startBgm("bgm_match_setup", matchPath);
    await vi.runOnlyPendingTimersAsync();
    const before = __forTest.getCurrentAudio();
    const playCallsBefore = playMock.mock.calls.length;

    // /play は bgm_match_setup と同 path のため何もすべきでない
    prepareBgmForNavigation("/play");
    await vi.runOnlyPendingTimersAsync();

    expect(__forTest.getCurrentAudio()).toBe(before);
    expect(__forTest.getPreparedAudio()).toBeNull();
    expect(playMock).toHaveBeenCalledTimes(playCallsBefore);
  });

  it("違う path への遷移準備で prepared audio が muted=true で作られ、currentAudio は変化しない", async () => {
    const matchPath = BGM_FILES.bgm_match_setup!;
    const gamePath = BGM_FILES.bgm_game!;
    __forTest.startBgm("bgm_match_setup", matchPath);
    await vi.runOnlyPendingTimersAsync();
    const before = __forTest.getCurrentAudio();

    prepareBgmForNavigation("/game/abc");
    await vi.runOnlyPendingTimersAsync();

    // ローディング中は currentAudio (= bgm_match_setup) を維持
    expect(__forTest.getCurrentAudio()).toBe(before);
    // 裏で prepared audio が unlock 済み状態で作られている
    const prepared = __forTest.getPreparedAudio();
    expect(prepared).not.toBeNull();
    expect(__forTest.getPreparedPath()).toBe(gamePath);
    // prepared audio は play() 後に pause されている
    expect(pauseMock).toHaveBeenCalled();
    // Issue #198: iOS Safari で volume プロパティが無効なため、無音再生は
    // muted=true でなければ実現できない。prepared 状態では muted=true で保持。
    expect(prepared!.muted).toBe(true);
  });

  it("画面遷移後の startBgm で prepared audio が再利用され、muted が解除される", async () => {
    const matchPath = BGM_FILES.bgm_match_setup!;
    const gamePath = BGM_FILES.bgm_game!;
    __forTest.startBgm("bgm_match_setup", matchPath);
    await vi.runOnlyPendingTimersAsync();

    prepareBgmForNavigation("/game/abc");
    await vi.runOnlyPendingTimersAsync();
    const prepared = __forTest.getPreparedAudio();
    expect(prepared).not.toBeNull();
    expect(prepared!.muted).toBe(true);

    // 画面遷移後の useBgm が startBgm を呼ぶシナリオ
    __forTest.startBgm("bgm_game", gamePath);
    await vi.runOnlyPendingTimersAsync();

    // prepared が currentAudio として再利用される
    expect(__forTest.getCurrentAudio()).toBe(prepared);
    // prepared スロットは消費されて空になる
    expect(__forTest.getPreparedAudio()).toBeNull();
    expect(__forTest.getPreparedPath()).toBe("");
    // Issue #198: 再利用時に muted=false に戻して通常再生に切替
    expect(prepared!.muted).toBe(false);
  });
});
