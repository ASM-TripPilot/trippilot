/**
 * TRIP-1522 사이클 4 · 허브 하단 바 4단계 모프의 단계 함수(순수 — 시간 → 각 요소의 값 표).
 *
 * 입장: ① 바가 살짝 커진다 → ② 일정만 남기고 시작 칸 4개 컷 → ③ 폭 330→264(오른쪽 끝 고정, 왼쪽 끝이 접힘)·일정 칸이 3번째 자리에서
 * 맨 앞으로 → ④ 뒤로 원이 자라고 수정·챗봇·행사가 작고 투명한 모습에서 1배로(왼→오 시차). 퇴장: ⓐ 뒤로 원·세 칸 즉시 사라짐 →
 * ⓑ 펼침 → ⓒ 시작 칸 왼→오 등장(확대 없음). 값은 참고 영상 실측(브리프 §3)이고 6-b 에서 조정한다.
 *
 * 화면(`MorphNavBar`)의 `useAnimatedStyle` 이 UI 스레드에서 매 프레임 부르므로 전부 'worklet' 이다. 좌표는 바 앵커(폭 330) 왼쪽이 0.
 *
 * TRIP-1584 — 허브(일정이 5칸의 3번째 → 맨 앞, 새 칸 3)와 기록 3종(기록이 4번째 → 맨 앞, 새 칸 2)이 같은 함수를 쓴다. 칸 구성은 `shape`
 * 매개로 받고, 안 주면 허브 값이다.
 */

export type BarMorphDirection = 'enter' | 'exit';
export interface MorphCell {
  opacity: number;
  scale: number;
}
export interface BarMorphFrame {
  /** 바 전체 중심 기준 확대 — 입장 ① 만 1→1.03, 그 밖엔 1. */
  barScale: number;
  /** 알약 왼쪽 끝(오른쪽 끝은 늘 330). 시작 0 ↔ 최종 66(= 뒤로 58 + 간격 8). */
  barLeft: number;
  barWidth: number;
  /** 생존 칸(허브는 일정) 중심 x. 허브: 시작 5칸의 3번째 165 ↔ 최종 맨 앞 106.5(= 66 + 10 + 칸 61 의 절반). 이름은 허브 때 그대로다. */
  scheduleCenterX: number;
  /** 시작 5칸 중 생존 칸을 뺀 4개(허브: 홈·탐색·기록·마이). */
  startCells: readonly [MorphCell, MorphCell, MorphCell, MorphCell];
  /** 뒤로 원 지름 0 ↔ 58 (오른쪽 가장자리가 58 에 고정되어 왼쪽으로 자란다). */
  backSize: number;
  /** 새로 나타나는 칸들(허브 수정·챗봇·행사 3개, 기록 회고·요약 2개) — 길이 = `shape.newCount`. */
  newCells: readonly MorphCell[];
}

/** 칸 구성 — `survivorSlot` 시작 5칸 중 끝까지 남는 칸의 0-기반 자리, `newCount` 최종 구조에서 그 칸 뒤에 새로 나타나는 칸 수. */
export interface BarMorphShape {
  survivorSlot: number;
  newCount: number;
}
export const HUB_BAR_SHAPE: BarMorphShape = { survivorSlot: 2, newCount: 3 };
export const RECORD_BAR_SHAPE: BarMorphShape = { survivorSlot: 3, newCount: 2 };

export const BAR_ENTER_MS = 460;
export const BAR_EXIT_MS = 400;
/**
 * 입장 시작 지연(ms) — 허브가 열린 직후엔 시트 마운트 애니메이션(≈250ms)과 지도·목록 첫 렌더가 겹쳐 모프가 끊긴다. 컴포넌트가
 * interactions 완료와 함께 이 시간이 지난 뒤에야 시계를 시작한다(단계 함수는 지연과 무관 — 경과 ms 는 시작 시점 기준).
 */
export const BAR_ENTER_DELAY_MS = 300;
/** 입장 ② 컷 시각 — 시작 칸이 사라지고 새 칸 자리가 마운트되는 때(화면 구조가 바뀌는 지점). */
export const BAR_ENTER_CUT_MS = 100;
/** 퇴장 ⓐ 끝 시각 — 뒤로 원·새 칸이 다 사라지고 시작 칸 자리가 마운트되는 때. */
export const BAR_EXIT_SWAP_MS = 50;

/** 바 폭 기본값 — 폭 390 기기(좌우 30 여백)의 값. 기기마다 `화면 폭 − 60` 을 넘긴다. */
export const BAR_DEFAULT_WIDTH = 330;
const FINAL_LEFT = 66;
const BACK_MAX = 58;
const BACK_GAP = 8;
const CAPSULE_PAD = 10;
const SCALE_MIN = 0.4;
const ENTER_SCALE_PEAK = 1.03;

function easeOut(x: number): number {
  'worklet';
  return 1 - (1 - x) * (1 - x);
}

/** t 가 [from, from+len] 을 지나며 0→1(감속). 범위 밖은 클램프. */
function span(t: number, from: number, len: number): number {
  'worklet';
  const x = (t - from) / len;
  return easeOut(x < 0 ? 0 : x > 1 ? 1 : x);
}

function appear(p: number): MorphCell {
  'worklet';
  return { opacity: p, scale: 1 - (1 - SCALE_MIN) * (1 - p) };
}

/**
 * elapsedMs 는 모션 시작 후 경과 ms — 범위 밖은 클램프(음수 = 시작, 총 길이 초과 = 끝). `fullWidth` 는 바 전체 폭(화면 폭 − 60):
 * 알약 폭과 생존 칸 중심만 폭을 따른다(뒤로 58·간격 8·패딩 10 은 고정값).
 */
export function barMorphFrame(
  direction: BarMorphDirection,
  elapsedMs: number,
  fullWidthArg?: number,
  shapeArg?: BarMorphShape
): BarMorphFrame {
  'worklet';
  // 기본값을 매개변수 초기값(`= BAR_DEFAULT_WIDTH`·`= HUB_BAR_SHAPE`)에 두면 worklets 플러그인이 그 모듈 상수를 UI 스레드 클로저에 못 담아 실기에서
  // ReferenceError 로 죽는다(jest 는 JS 스레드에서 돌려 안 드러난다) — 본문의 자유 변수는 수집되므로 여기서 푼다.
  const fullWidth = fullWidthArg ?? BAR_DEFAULT_WIDTH;
  const shape = shapeArg ?? HUB_BAR_SHAPE;
  const enter = direction === 'enter';
  const total = enter ? BAR_ENTER_MS : BAR_EXIT_MS;
  const t = elapsedMs < 0 ? 0 : elapsedMs > total ? total : elapsedMs;

  // 왼쪽 끝 진행(0 = 풀폭, 1 = 최종). 입장 ③ 100~300, 퇴장 ⓑ 50~340.
  const fold = enter ? span(t, BAR_ENTER_CUT_MS, 200) : 1 - span(t, 50, 290);
  const barLeft = FINAL_LEFT * fold;
  // 생존 칸 중심: 시작 = 5등분의 survivorSlot 번째, 최종 = (1 + 새 칸 수)등분의 첫째. 칸들은 알약 안쪽(패딩 10 제외)을 똑같이 나눠 갖는다.
  const scheduleStartX =
    CAPSULE_PAD +
    ((fullWidth - CAPSULE_PAD * 2) / 5) * (shape.survivorSlot + 0.5);
  const scheduleFinalX =
    BACK_MAX +
    BACK_GAP +
    CAPSULE_PAD +
    (fullWidth - FINAL_LEFT - CAPSULE_PAD * 2) / (2 * (1 + shape.newCount));

  const none = { opacity: 0, scale: 1 };
  const shown = { opacity: 1, scale: 1 };
  const started = (k: number) => appear(span(t, 220 + 25 * k, 105));
  const arrived = (i: number) => appear(span(t, 240 + 20 * i, 180));
  const vanishing = appear(1 - span(t, 0, 50));
  const newCells: MorphCell[] = [];
  for (let i = 0; i < shape.newCount; i += 1)
    newCells.push(enter ? arrived(i) : vanishing);

  return {
    barScale:
      enter && t < BAR_ENTER_CUT_MS
        ? 1 + (ENTER_SCALE_PEAK - 1) * span(t, 0, BAR_ENTER_CUT_MS)
        : 1,
    barLeft,
    barWidth: fullWidth - barLeft,
    scheduleCenterX: scheduleStartX - (scheduleStartX - scheduleFinalX) * fold,
    startCells: enter
      ? t < BAR_ENTER_CUT_MS
        ? [shown, shown, shown, shown]
        : [none, none, none, none]
      : [started(0), started(1), started(2), started(3)],
    backSize: BACK_MAX * (enter ? span(t, 240, 220) : 1 - span(t, 0, 50)),
    newCells,
  };
}
