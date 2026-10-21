import { act, screen } from '@testing-library/react-native';
import { BlurView } from 'expo-blur';
import {
  AccessibilityInfo,
  Dimensions,
  InteractionManager,
  StyleSheet,
} from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import type { ReactTestInstance } from 'react-test-renderer';

/**
 * TRIP-1522 사이클 3·4 · 하단 바 변신 모션을 jest 로 재는 공용 도우미 — `LiveBottomBar`·`LiveHubView` 테스트가 같이 쓴다.
 *
 * 무엇을 재나: **모션 값(폭 숫자·타이밍)이 아니라 눈에 보이는 결과 상태**(02a ★1) —
 *  ① 지금 보이는 추적 칸 목록(`visibleIds`: 시작 5칸 / 최종 / 그 사이) ② 루트가 하나이고 일정 칸이 같은 노드인가(`structureSteady`)
 *  ③ 움직였나(샘플이 둘 이상) ④ 칸이 처음 보인/사라진 시각(`firstSeen`·`firstGone`) ⑤ OS 동작 줄이기 답의 순서(대기 → true/false).
 * 모션 값 자체(스케일·폭 숫자)는 순수 함수 `barMorphFrame` 의 숫자 계약(barMorph.test)이 맡는다.
 *
 * ⚠️ reanimated 스타일은 jest 에서 `props.style` 로 읽으면 첫 렌더 값에 굳는다 — `getAnimatedStyle` + **가짜 타이머**로만
 *   읽고, 프레임은 `act` 로 감싸 흘린다(원인 act 와 분리). 호출하는 테스트가 `useAnimatedProbe()`(가짜 타이머 + OS 답 제어)를
 *   describe 에서 불러 두어야 한다. 실제 모양·길이·부드러움·안드로이드 블러+폭은 6-b.
 */

export const BAR_ROOT = 'execution-live-bottom-bar';
/** 알약(캡슐) 래퍼 — 시작 5칸·최종 모두 이 알약 안에 선다(계약, 02a §1-2). 샘플은 여기 reanimated 스타일을 읽는다. */
export const CAPSULE_WRAP = 'execution-live-bar-capsule';
export const BACK = 'execution-live-back';
export const SCHEDULE = 'execution-live-bar-schedule';
export const EDIT = 'execution-live-bar-edit';
export const CHATBOT = 'execution-live-bar-chatbot';
export const EVENT = 'execution-live-bar-event';
export const START_HOME = 'execution-live-start-home';
export const START_EXPLORE = 'execution-live-start-explore';
export const START_RECORDS = 'execution-live-start-records';
export const START_MY = 'execution-live-start-my';
/** 시작 칸 4개(일정은 `SCHEDULE` 로 같은 노드가 서 있다) — 왼→오 순서. */
export const START_CELLS = [START_HOME, START_EXPLORE, START_RECORDS, START_MY];
/** 최종 구조의 추적 칸(뒤로 + 일정·수정·챗봇·행사) — 트리 순서. */
export const FINAL_IDS = [BACK, SCHEDULE, EDIT, CHATBOT, EVENT];
/** 시작 5칸의 트리 순서 — 홈·탐색·일정·기록·마이. */
export const START5_IDS = [
  START_HOME,
  START_EXPLORE,
  SCHEDULE,
  START_RECORDS,
  START_MY,
];
/** 새로 나타나는 칸(뒤로·수정·챗봇·행사). */
export const NEW_CELLS = [BACK, EDIT, CHATBOT, EVENT];
const TRACKED = [...new Set([...START5_IDS, ...FINAL_IDS])];

/**
 * 지금 **접근성에 보이는** 추적 칸 id 를 트리 순서로. 기본 쿼리가 못 찾는 요소(`accessibilityElementsHidden` 등)는 빠진다 —
 * 시작 5칸에서 뒤로·새 칸이 "언마운트든 숨김이든" 같은 결과로 읽히게 하는 중립 관측이다.
 */
export function visibleIds(): string[] {
  const inTree = screen.root
    .findAll(
      (node: ReactTestInstance) =>
        typeof node.type === 'string' && TRACKED.includes(node.props.testID)
    )
    .map((node) => node.props.testID as string);
  return [...new Set(inTree)].filter((id) => screen.queryByTestId(id) !== null);
}

/** 캡슐 래퍼의 지금 reanimated 스타일(JSON) — 값이 뭔지는 안 본다. */
function capsuleStyle(): string {
  return JSON.stringify(getAnimatedStyle(screen.getByTestId(CAPSULE_WRAP)));
}

/** 지금 한 장의 지문 = 캡슐 스타일 + 보이는 칸 목록. 움직임은 이 지문이 달라지는 것으로 읽는다. */
export function frameSample(): string {
  return JSON.stringify([capsuleStyle(), visibleIds()]);
}

/** 일정 칸 노드(숨김 포함) — 같은 노드인지(`toBe`) 비교하려고 잡아 둔다. */
function scheduleNode(): ReactTestInstance | null {
  return screen.queryByTestId(SCHEDULE, { includeHiddenElements: true });
}

export interface MotionWatch {
  /** 프레임별 지문(캡슐 스타일 + 보이는 칸). */
  samples: string[];
  /** 프레임별 일정 칸의 selected(활성 표시). */
  scheduleSelected: boolean[];
  /** 프레임별 보이는 추적 칸 목록. */
  shapes: string[][];
  rootCounts: number[];
  schedules: (ReactTestInstance | null)[];
  /** 프레임별 경과 ms (첫 프레임 0). */
  at: number[];
}

/**
 * 지금 한 장 + 프레임마다(`stepMs`) 가짜 타이머를 흘리며 `frames` 장 더 찍는다.
 * `onFrame` 은 매 프레임을 찍은 직후 경과 ms 와 함께 불린다(특정 시각에 뒤로를 누르는 등).
 */
export function watchMotion(
  frames = 40,
  stepMs = 16,
  onFrame?: (ms: number) => void
): MotionWatch {
  const watch: MotionWatch = {
    scheduleSelected: [],
    samples: [],
    shapes: [],
    rootCounts: [],
    schedules: [],
    at: [],
  };
  const take = (ms: number) => {
    watch.samples.push(frameSample());
    watch.shapes.push(visibleIds());
    watch.rootCounts.push(screen.queryAllByTestId(BAR_ROOT).length);
    watch.schedules.push(scheduleNode());
    watch.scheduleSelected.push(
      scheduleNode()?.props.accessibilityState?.selected === true
    );
    watch.at.push(ms);
    onFrame?.(ms);
  };
  take(0);
  for (let i = 1; i <= frames; i += 1) {
    act(() => {
      jest.advanceTimersByTime(stepMs);
    });
    take(i * stepMs);
  }
  return watch;
}

/** 이어 찍은 두 관측을 하나로 잇는다(사이에 `await act` 로 OS 답을 보내는 등) — 시각은 이어서 센다. */
export function joinWatches(
  first: MotionWatch,
  second: MotionWatch,
  stepMs = 16
): MotionWatch {
  const offset = first.at[first.at.length - 1] + stepMs;
  return {
    samples: [...first.samples, ...second.samples],
    scheduleSelected: [...first.scheduleSelected, ...second.scheduleSelected],
    shapes: [...first.shapes, ...second.shapes],
    rootCounts: [...first.rootCounts, ...second.rootCounts],
    schedules: [...first.schedules, ...second.schedules],
    at: [...first.at, ...second.at.map((ms) => ms + offset)],
  };
}

/** 가짜 시계를 `ms` 만큼 한 번에 흘린다(act 로 감싼다). */
export function advance(ms: number): void {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

/** 움직였다 = 서로 다른 지문이 둘 이상. */
export const moved = (watch: MotionWatch): boolean =>
  new Set(watch.samples).size > 1;

/**
 * 구조가 모션 내내 안정적이었다 = 루트가 모든 프레임에서 하나이고, 일정 칸이 **같은 노드**다(리마운트 없음).
 * (사이클 3 의 "testID 집합이 한 가지"는 시작 칸이 ② 이후 사라지는 새 구조에서 거짓이라 버렸다 — 02a ★9.)
 */
export const structureSteady = (watch: MotionWatch): boolean =>
  watch.rootCounts.every((count) => count === 1) &&
  watch.schedules.every((node) => node !== null && node === watch.schedules[0]);

export const lastSample = (watch: MotionWatch): string =>
  watch.samples[watch.samples.length - 1];

/** `id` 가 처음 보인 시각(ms). 한 번도 안 보이면 null. */
export function firstSeen(watch: MotionWatch, id: string): number | null {
  const index = watch.shapes.findIndex((shape) => shape.includes(id));
  return index < 0 ? null : watch.at[index];
}

/** `id` 가 보이다가 **처음 안 보이게 된** 시각(ms). 처음부터 안 보였거나 계속 보이면 null. */
export function firstGone(watch: MotionWatch, id: string): number | null {
  const seen = watch.shapes.findIndex((shape) => shape.includes(id));
  if (seen < 0) return null;
  const gone = watch.shapes.findIndex(
    (shape, index) => index > seen && !shape.includes(id)
  );
  return gone < 0 ? null : watch.at[gone];
}

/** 한 번 보이게 된 `id` 가 이후 다시 안 사라진다. */
export const staysOnceSeen = (watch: MotionWatch, id: string): boolean => {
  const seen = watch.shapes.findIndex((shape) => shape.includes(id));
  return (
    seen < 0 || watch.shapes.slice(seen).every((shape) => shape.includes(id))
  );
};

/** 한 번 사라진 `id` 가 이후 다시 안 나타난다(처음부터 안 보였다면 계속 안 보여야 한다). */
export const staysOnceGone = (watch: MotionWatch, id: string): boolean => {
  const gone = watch.shapes.findIndex((shape) => !shape.includes(id));
  return (
    gone < 0 || watch.shapes.slice(gone).every((shape) => !shape.includes(id))
  );
};

/** OS 동작 줄이기 답이 아직 안 온 상태를 만든다 — 호출 쪽이 나중에 `resolve(true|false)` 로 답을 보낸다. 마운트 **전**에 부른다. */
export function deferOsAnswer(): { resolve: (reduce: boolean) => void } {
  let resolve!: (reduce: boolean) => void;
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValue(
    new Promise<boolean>((done) => {
      resolve = done;
    })
  );
  return { resolve };
}

/** 보낸/기본 OS 답이 훅 상태에 반영되도록 마이크로태스크를 흘린다. */
export async function flushOsAnswer(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** 파일 최상위 `beforeEach` 용 — OS 답을 "동작 줄이기 켜짐(true)"으로 고정해 모션과 무관한 기존 케이스를 결정적으로 돌린다. */
export function holdReduceMotionOn(): void {
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(true);
}

// ── 사이클 3 · 5-b 후 보강 — 뒤로–캡슐 "간격·폭 합"을 렌더 트리에서 읽는 도우미 ──────────────────────────────────────────────
// 설계: 뒤로 58 + 간격 8 + 캡슐 264 = 330(좌우 30). 입장 시작·퇴장 끝의 단일 알약은 뒤로 0 + 간격 0 + 캡슐 330(x30).
// 사이클 3 구현은 루트 `className="gap-sm"`(8)과 캡슐 `marginLeft`(8)를 둘 다 둬 간격이 16 이 됐다 — jest 는 `className` 을 style 로
// 안 바꿔서 `gap-sm` 이 읽히지 않았다(루트 `props.style` 이 undefined). 그래서 계약은 둘이다(02a 5-b 후 보강):
//  ① 가로 간격은 **style 숫자**로만 낸다 — 루트·뒤로 래퍼·캡슐 래퍼(유리 바깥)의 className 에 가로 간격 클래스(gap/space-x/m·p 계열)를 두지 않는다
//  ② 간격을 어디서 내든(행 `gap`/`columnGap` · 뒤로 `marginRight` · 캡슐 `marginLeft`) 읽은 합이 설계값이다 — 어느 쪽이든 통과(중립).

type Style = Record<string, unknown>;

const num = (value: unknown): number => (typeof value === 'number' ? value : 0);

/** 지금 보이는 스타일 — 고정 style 과 reanimated 보간 값을 합친다(정적 노드는 `getAnimatedStyle` 이 `{}`). */
export function layoutStyle(node: ReactTestInstance): Style {
  return {
    ...(StyleSheet.flatten(node.props.style) as Style | undefined),
    ...(getAnimatedStyle(node) as Style),
  };
}

/** 노드의 바로 아래 host 자식들(합성 컴포넌트는 건너뛴다). */
function directHostChildren(node: ReactTestInstance): ReactTestInstance[] {
  return node.children.flatMap((child) =>
    typeof child === 'string'
      ? []
      : typeof child.type === 'string'
        ? [child]
        : directHostChildren(child)
  );
}

/** 루트에서 시작해 **유리(BlurView) 바깥**의 host 노드만 모은다 — 루트·모션 래퍼·유리 바깥 그림자 래퍼. 유리 안(칸·뒤로 버튼)은 안 본다. */
function hostsOutsideGlass(node: ReactTestInstance): ReactTestInstance[] {
  if (node.type === (BlurView as unknown)) return [];
  const own = typeof node.type === 'string' ? [node] : [];
  const kids = node.children.filter(
    (child): child is ReactTestInstance => typeof child !== 'string'
  );
  return [...own, ...kids.flatMap(hostsOutsideGlass)];
}

/** 가로 간격을 내는 className 토큰 — gap·gap-x·space-x, 그리고 margin·padding 계열(m-·mx-·ml-·mr-·p-·px-·pl-·pr- …). */
const H_SPACING_CLASS =
  /(?:^|\s)(?:gap|gap-x|space-x|m|ml|mr|mx|ms|me|p|pl|pr|px|ps|pe)-/;

/** 가로 간격 className 을 가진 유리 바깥 노드들의 설명 — 비어 있어야 한다. */
export function hiddenSpacingClasses(): string[] {
  return hostsOutsideGlass(screen.getByTestId(BAR_ROOT))
    .filter((node) => H_SPACING_CLASS.test(String(node.props.className ?? '')))
    .map(
      (node) =>
        `testID=${String(node.props.testID)} className=${String(node.props.className)}`
    );
}

// style 로 내는 가로 간격으로 허용하는 키 외에는 0/없음이어야 한다(그 밖의 키가 숨은 간격·오프셋이 되지 않게).
const STRAY_KEYS = [
  'margin',
  'marginHorizontal',
  'marginStart',
  'marginEnd',
  'padding',
  'paddingHorizontal',
  'paddingLeft',
  'paddingRight',
  'paddingStart',
  'paddingEnd',
  'left',
  'right',
  'start',
  'end',
] as const;

export interface RowReading {
  /** 뒤로 가지(루트의 바로 아래 host 중 뒤로 버튼을 품은 것)의 폭 — 숫자로 읽혀야 한다(가지가 없으면 0). */
  backWidth: number | undefined;
  /** 뒤로–캡슐 사이 간격 = 행 gap + 뒤로 marginRight + 캡슐 marginLeft. */
  spacing: number;
  /** 캡슐 가지가 남는 폭을 채운다(`flex`/`flexGrow` ≥ 1, 고정 `width` 없음) — 캡슐 폭 = 행 폭 − 뒤로 − 간격. */
  capsuleFills: boolean;
  /** 허용 키 밖의 가로 간격·오프셋 style(비어 있어야 한다). */
  strayKeys: string[];
}

export function readRow(): RowReading {
  const root = screen.getByTestId(BAR_ROOT);
  const branches = directHostChildren(root);
  const withTestID = (id: string) =>
    branches.find(
      (branch) =>
        branch.props.testID === id ||
        branch.findAll((node) => node.props?.testID === id).length > 0
    );
  // 뒤로 가지는 없을 수 있다(시작 5칸에서 언마운트해도 된다 — 02a ★10): 없으면 폭 0·여백 0 으로 읽는다.
  const backBranch = withTestID('execution-live-back');
  const capsuleBranch = withTestID(CAPSULE_WRAP);
  if (!capsuleBranch) {
    throw new Error('바 루트 바로 아래에서 캡슐 가지를 못 찾았다');
  }
  const row = layoutStyle(root);
  const back: Style = backBranch ? layoutStyle(backBranch) : { width: 0 };
  const capsule = layoutStyle(capsuleBranch);
  const stray: string[] = [];
  const watch = (name: string, style: Style, keys: readonly string[]) => {
    keys.forEach((key) => {
      if (num(style[key]) !== 0)
        stray.push(`${name}.${key}=${String(style[key])}`);
    });
  };
  watch('row', row, STRAY_KEYS);
  watch('back', back, [...STRAY_KEYS, 'marginLeft']);
  watch('capsule', capsule, [...STRAY_KEYS, 'marginRight']);
  return {
    backWidth: typeof back.width === 'number' ? back.width : undefined,
    spacing:
      num(row.columnGap ?? row.gap) +
      num(back.marginRight) +
      num(capsule.marginLeft),
    capsuleFills:
      (num(capsule.flex) >= 1 || num(capsule.flexGrow) >= 1) &&
      capsule.width === undefined,
    strayKeys: stray,
  };
}

// ── 사이클 4 · 5-b 후 보강 — 단계 함수 값 ↔ 칸 스타일 고리, 기기 폭 ────────────────────────────────────────────────────
// 읽는 것: 각 칸에서 **바깥 캡슐 래퍼 전까지 올라가며 만나는 host 조상들의 reanimated 스타일을 합친 효과**(불투명도의 곱 · 확대의 곱 ·
// translateX 의 합). 어느 래퍼가 어느 값을 내든(불투명도와 확대를 한 겹에 두든 두 겹에 두든) 같은 효과로 읽힌다 — 구현 방식 중립.
// 오라클은 늘 단계 함수(`barMorphFrame`) 호출 결과다. 구현의 수식(translateX = scheduleCenterX − 칸 레이아웃 중심 등)은 베끼지 않는다.

/** 기기(윈도우) 폭을 바꾼다 — 바의 폭은 윈도우 폭 − 좌우 30×2. 반환한 스파이를 afterEach 에서 `mockRestore()` 한다. */
export function setWindowWidth(width: number): jest.SpyInstance {
  return jest.spyOn(Dimensions, 'get').mockReturnValue({
    width,
    height: 800,
    scale: 2,
    fontScale: 1,
  });
}

function hostAncestorsUntilCapsule(id: string): ReactTestInstance[] {
  const cell = screen.getByTestId(id, { includeHiddenElements: true });
  const capsule = screen.getByTestId(CAPSULE_WRAP);
  const chain: ReactTestInstance[] = [];
  for (
    let node: ReactTestInstance | null = cell;
    node && node !== capsule;
    node = node.parent
  ) {
    if (typeof node.type === 'string') chain.push(node);
  }
  return chain;
}

export interface SlotEffect {
  opacity: number;
  scale: number;
  translateX: number;
}

/** 칸 `id` 에서 캡슐 래퍼 앞까지의 조상 효과를 합친 값(없으면 불투명도 1·확대 1·이동 0). */
export function slotEffect(id: string): SlotEffect {
  let opacity = 1;
  let scale = 1;
  let translateX = 0;
  for (const node of hostAncestorsUntilCapsule(id)) {
    const style = layoutStyle(node);
    if (typeof style.opacity === 'number') opacity *= style.opacity;
    const transform = style.transform;
    if (Array.isArray(transform)) {
      for (const entry of transform as Record<string, unknown>[]) {
        if (typeof entry.scale === 'number') scale *= entry.scale;
        if (typeof entry.translateX === 'number')
          translateX += entry.translateX;
      }
    }
  }
  return { opacity, scale, translateX };
}

/** 바 루트의 바 전체 확대(transform scale). */
export function rootScale(): number {
  const transform = layoutStyle(screen.getByTestId(BAR_ROOT)).transform;
  let scale = 1;
  if (Array.isArray(transform)) {
    for (const entry of transform as Record<string, unknown>[]) {
      if (typeof entry.scale === 'number') scale *= entry.scale;
    }
  }
  return scale;
}

/** 마운트돼 있는가(접근성 숨김 포함) — 모션 초반에 아직 안 서 있는 칸은 건너뛰는 단언용. */
export const isMounted = (id: string): boolean =>
  screen.queryByTestId(id, { includeHiddenElements: true }) !== null;

/**
 * 일정 칸이 **지금 화면에서 보이는 중심 x**(바 앵커 왼쪽이 0) = 레이아웃이 놓은 자리 + 칸에 걸린 translateX.
 * 레이아웃 자리는 jest 가 flex 를 안 돌리므로 **구조에서 직접 계산**한다(구현 수식이 아니라 기하): 캡슐 왼쪽 끝 = 뒤로 폭 + 간격(`readRow`),
 * 캡슐 폭 = 바 폭 − 왼쪽 끝, 안쪽 패딩 10, 지금 **마운트돼 있는 칸들이 폭을 똑같이 나눠 가진다**(시작 5칸 5등분 · 최종 4칸 4등분 · 마운트된
 * 칸 수가 얼마든) 그중 일정 칸의 순서 번째. `barWidth` 는 호출 쪽이 아는 값(윈도우 폭 − 60).
 */
export function scheduleVisibleCenter(barWidth: number): number {
  const row = readRow();
  const barLeft = (row.backWidth ?? 0) + row.spacing;
  const inner = barWidth - barLeft - 20;
  const slotIds = [...START_CELLS, SCHEDULE, EDIT, CHATBOT, EVENT];
  const order = screen.root
    .findAll(
      (node: ReactTestInstance) =>
        typeof node.type === 'string' && slotIds.includes(node.props.testID)
    )
    .map((node) => node.props.testID as string)
    .filter((id, index, all) => all.indexOf(id) === index); // findAll 은 트리 순서
  const index = order.indexOf(SCHEDULE);
  const layoutCenter = barLeft + 10 + (inner * (index + 0.5)) / order.length;
  return layoutCenter + slotEffect(SCHEDULE).translateX;
}

// ── 사이클 4 6-b 후 보강 3 — 입장 모프 시작 지연 (허브 첫 렌더 뒤로 미룬다) ─────────────────────────────────────────────
// 계약: 입장 모프는 OS 답이 false 로 확인되고, **`InteractionManager.runAfterInteractions` 가 끝났고, 마운트 후 `BAR_ENTER_DELAY_MS` 가
// 지난 뒤** 중 가장 늦은 시점에 시작한다(그 전까지 시작 5칸이 그대로 — 숨기지 않는다). 지연 시간 안에는 확대(①)도 시작하지 않는다.
//
// ⚠️ 왜 RN 의 진짜 `InteractionManager` 를 안 쓰고 스파이로 갈아 끼우나(실검증): 진짜 모듈은 `setImmediate` 한 개의 핸들(`_nextUpdateHandle`)을
//   모듈 변수에 쥐는데, 가짜 타이머 아래에서 그 즉시 실행이 돌기 전에 테스트가 끝나 타이머가 되돌려지면 핸들이 죽은 채 남아 **이후
//   모든 테스트의 `runAfterInteractions` 가 영영 안 불린다**(연쇄 red — 실측: 바 입장과 무관한 BM4·BM4b·BM5… 가 줄줄이 깨졌다).
//   그래서 모프가 있는 describe 는 `useInteractionGate()` 로 스파이를 걸어 "기본은 마이크로태스크 뒤 즉시 끝남 · `hold()` 하면 `finish()` 까지 안 끝남"을
//   결정적으로 만든다. 호출 모양(`InteractionManager.runAfterInteractions(task)` → `{ then, cancel }`)만 맞으면 구현은 어느 쪽으로 불러도 된다.
export interface InteractionGate {
  /** 이후 부르는 `runAfterInteractions` 의 완료를 `finish()` 까지 미룬다(허브가 아직 바쁜 상태 흉내). */
  hold: () => void;
  /** 미뤄 둔 작업을 모두 끝낸다(act 로 감싸서 부른다). */
  finish: () => void;
  /** 아직 끝나지 않은(취소도 안 된) 대기 건수. */
  pending: () => number;
}

export function useInteractionGate(): InteractionGate {
  let held = false;
  let queue: { run: () => void; cancelled: boolean }[] = [];
  let spy: jest.SpyInstance | null = null;
  beforeEach(() => {
    held = false;
    queue = [];
    spy = jest
      .spyOn(InteractionManager, 'runAfterInteractions')
      .mockImplementation(((task?: unknown) => {
        const entry = { run: () => {}, cancelled: false };
        const promise = new Promise<void>((resolve) => {
          entry.run = () => {
            if (entry.cancelled) return;
            if (typeof task === 'function') task();
            else if (
              task &&
              typeof (task as { run?: unknown }).run === 'function'
            )
              (task as { run: () => void }).run();
            resolve();
          };
        });
        if (held) queue.push(entry);
        else queueMicrotask(entry.run);
        return {
          then: promise.then.bind(promise),
          cancel: () => {
            entry.cancelled = true;
            queue = queue.filter((item) => item !== entry);
          },
        };
      }) as unknown as typeof InteractionManager.runAfterInteractions);
  });
  afterEach(() => {
    spy?.mockRestore();
    spy = null;
  });
  return {
    hold: () => {
      held = true;
    },
    finish: () => {
      held = false;
      const waiting = queue;
      queue = [];
      act(() => {
        waiting.forEach((entry) => entry.run());
      });
    },
    pending: () => queue.length,
  };
}
