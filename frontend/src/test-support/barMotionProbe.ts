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
 * TRIP-1522 · 하단 바 모프를 jest 로 재는 공용 도우미(`LiveBottomBar`·`LiveHubView` 테스트가 같이 쓴다).
 * 모션 **값**(스케일·폭·곡선)은 순수 함수 `barMorphFrame` 의 숫자 계약(barMorph.test)이 맡고, 여기서는 눈에 보이는 결과 상태
 * (보이는 칸 목록·루트 1개·일정 칸 같은 노드·움직였나·칸이 처음 보인/사라진 시각)와 OS 동작 줄이기 답의 순서를 잰다.
 * ⚠️ reanimated 스타일은 `props.style` 로 읽으면 첫 렌더 값에 굳는다 — `getAnimatedStyle` + 가짜 타이머(`useAnimatedProbe`)로만 읽는다.
 *
 * TRIP-1584 · 기록 바(`RecordNavBar`)도 같은 도구로 잰다 — id 를 쓰는 함수들은 "지금 id 묶음"(`withBarIds`, 기본 = 허브)을 읽는다. 허브 테스트는 안 바뀐다.
 */

export const BAR_ROOT = 'execution-live-bottom-bar';
const CAPSULE_WRAP = 'execution-live-bar-capsule';
const BACK = 'execution-live-back';
export const SCHEDULE = 'execution-live-bar-schedule';
const EDIT = 'execution-live-bar-edit';
const CHATBOT = 'execution-live-bar-chatbot';
const EVENT = 'execution-live-bar-event';
export const START_HOME = 'execution-live-start-home';
export const START_EXPLORE = 'execution-live-start-explore';
export const START_RECORDS = 'execution-live-start-records';
export const START_MY = 'execution-live-start-my';
/** 시작 칸 4개(일정은 같은 노드가 `SCHEDULE` 로 선다) — 왼→오. */
export const START_CELLS = [START_HOME, START_EXPLORE, START_RECORDS, START_MY];
/** 최종 구조(뒤로 + 4칸) · 시작 5칸 · 새로 나타나는 칸 — 트리 순서. */
export const FINAL_IDS = [BACK, SCHEDULE, EDIT, CHATBOT, EVENT];
export const START5_IDS = [
  START_HOME,
  START_EXPLORE,
  SCHEDULE,
  START_RECORDS,
  START_MY,
];
export const NEW_CELLS = [BACK, EDIT, CHATBOT, EVENT];

/** 바 하나의 id 묶음 — 모든 목록은 트리 순서. `start5` 는 시작 5칸(생존 칸 포함), `startCells` 는 그중 생존 칸을 뺀 4개. */
export interface BarIds {
  root: string;
  capsule: string;
  back: string;
  survivor: string;
  startCells: string[];
  start5: string[];
  final: string[];
  /** 최종 구조에서 새로 나타나는 것(뒤로 포함). */
  fresh: string[];
}
export const HUB_IDS: BarIds = {
  root: BAR_ROOT,
  capsule: CAPSULE_WRAP,
  back: BACK,
  survivor: SCHEDULE,
  startCells: START_CELLS,
  start5: START5_IDS,
  final: FINAL_IDS,
  fresh: NEW_CELLS,
};
let current: BarIds = HUB_IDS;
/** describe 본문에서 한 번 — 그 describe 동안 id 를 쓰는 도우미들이 이 묶음을 읽는다(끝나면 허브로 되돌린다). */
export function withBarIds(ids: BarIds): void {
  beforeEach(() => {
    current = ids;
  });
  afterEach(() => {
    current = HUB_IDS;
  });
}
const tracked = (): string[] => [
  ...new Set([...current.start5, ...current.final]),
];

/** 지금 **접근성에 보이는** 추적 칸을 트리 순서로 — 언마운트든 접근성 숨김이든 같게 읽힌다(opacity 0 만으로 숨긴 건 보이는 것). */
export function visibleIds(): string[] {
  const inTree = screen.root
    .findAll(
      (node: ReactTestInstance) =>
        typeof node.type === 'string' && tracked().includes(node.props.testID)
    )
    .map((node) => node.props.testID as string);
  return [...new Set(inTree)].filter((id) => screen.queryByTestId(id) !== null);
}

/** 한 장의 지문 = 캡슐 래퍼의 reanimated 스타일 + 보이는 칸. 움직임은 지문이 달라지는 것으로 읽는다. */
export const frameSample = (): string =>
  JSON.stringify([
    getAnimatedStyle(screen.getByTestId(current.capsule)),
    visibleIds(),
  ]);

const scheduleNode = (): ReactTestInstance | null =>
  screen.queryByTestId(current.survivor, { includeHiddenElements: true });

export interface MotionWatch {
  samples: string[];
  scheduleSelected: boolean[];
  shapes: string[][];
  rootCounts: number[];
  schedules: (ReactTestInstance | null)[];
  /** 프레임별 경과 ms (첫 프레임 0). */
  at: number[];
}

/** 지금 한 장 + 프레임마다(`stepMs`) 가짜 타이머를 흘리며 `frames` 장 더 찍는다. `onFrame` 은 매 프레임 직후 경과 ms 와 함께 불린다. */
export function watchMotion(
  frames = 40,
  stepMs = 16,
  onFrame?: (ms: number) => void
): MotionWatch {
  const watch: MotionWatch = {
    samples: [],
    scheduleSelected: [],
    shapes: [],
    rootCounts: [],
    schedules: [],
    at: [],
  };
  const take = (ms: number) => {
    watch.samples.push(frameSample());
    watch.shapes.push(visibleIds());
    watch.rootCounts.push(screen.queryAllByTestId(current.root).length);
    watch.schedules.push(scheduleNode());
    watch.scheduleSelected.push(
      scheduleNode()?.props.accessibilityState?.selected === true
    );
    watch.at.push(ms);
    onFrame?.(ms);
  };
  take(0);
  for (let i = 1; i <= frames; i += 1) {
    advance(stepMs);
    take(i * stepMs);
  }
  return watch;
}

/** 이어 찍은 두 관측을 하나로 잇는다(사이이 `await act` 로 OS 답을 보내는 등). */
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

/** 가짜 시계를 `ms` 만큼 흘린다(act). */
export function advance(ms: number): void {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

export const moved = (watch: MotionWatch): boolean =>
  new Set(watch.samples).size > 1;

/** 루트가 모든 프레임에서 하나이고 일정 칸이 **같은 노드**(리마운트 없음). */
export const structureSteady = (watch: MotionWatch): boolean =>
  watch.rootCounts.every((count) => count === 1) &&
  watch.schedules.every((node) => node !== null && node === watch.schedules[0]);

export const lastSample = (watch: MotionWatch): string =>
  watch.samples[watch.samples.length - 1];

const seenAt = (watch: MotionWatch, id: string) =>
  watch.shapes.findIndex((shape) => shape.includes(id));

/** `id` 가 처음 보인 시각(없으면 null). */
export function firstSeen(watch: MotionWatch, id: string): number | null {
  const index = seenAt(watch, id);
  return index < 0 ? null : watch.at[index];
}

/** `id` 가 보이다가 처음 안 보이게 된 시각(없으면 null). */
export function firstGone(watch: MotionWatch, id: string): number | null {
  const seen = seenAt(watch, id);
  if (seen < 0) return null;
  const gone = watch.shapes.findIndex(
    (shape, index) => index > seen && !shape.includes(id)
  );
  return gone < 0 ? null : watch.at[gone];
}

/** 한 번 보이게 된 `id` 가 다시 안 사라진다. */
export const staysOnceSeen = (watch: MotionWatch, id: string): boolean => {
  const seen = seenAt(watch, id);
  return seen < 0 || watch.shapes.slice(seen).every((s) => s.includes(id));
};

/** 한 번 사라진 `id` 가 다시 안 나타난다(처음부터 안 보였다면 계속 안 보여야 한다). */
export const staysOnceGone = (watch: MotionWatch, id: string): boolean => {
  const gone = watch.shapes.findIndex((shape) => !shape.includes(id));
  return gone < 0 || watch.shapes.slice(gone).every((s) => !s.includes(id));
};

/** OS 동작 줄이기 답이 아직 안 온 상태 — 나중에 `resolve(true|false)`. 마운트 **전**에 부른다. */
export function deferOsAnswer(): { resolve: (reduce: boolean) => void } {
  let resolve!: (reduce: boolean) => void;
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValue(
    new Promise<boolean>((done) => {
      resolve = done;
    })
  );
  return { resolve };
}

/** 답이 반영되도록 마이크로태스크를 흘린다. */
export async function flushOsAnswer(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** 파일 최상위 `beforeEach` 용 — 동작 줄이기 켜짐(true)으로 고정해 모션과 무관한 케이스를 결정적으로 돌린다. */
export function holdReduceMotionOn(): void {
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(true);
}

// ── 뒤로–캡슐 "간격·폭 합"을 렌더 트리에서 읽는다 ───────────────────────────────────────────────────────────────────────
// jest 는 className 을 style 로 안 바꿔 루트 `gap-sm` 같은 두 번째 간격이 읽히지 않았다(사이클 3 결함). 그래서 ① 가로 간격은 style
// 숫자로만 내고(유리 바깥 노드 className 에 gap/space-x/m·p 클래스 금지) ② 어디서 내든(행 gap·뒤로 marginRight·캡슐 marginLeft) 읽은 합이 설계값이다.

type Style = Record<string, unknown>;
const num = (value: unknown): number => (typeof value === 'number' ? value : 0);

/** 고정 style 과 reanimated 보간 값을 합친 지금 스타일. */
export function layoutStyle(node: ReactTestInstance): Style {
  return {
    ...(StyleSheet.flatten(node.props.style) as Style | undefined),
    ...(getAnimatedStyle(node) as Style),
  };
}

/** 노드 바로 아래 host 자식들(합성 컴포넌트는 건너뛴다). */
function directHostChildren(node: ReactTestInstance): ReactTestInstance[] {
  return node.children.flatMap((child) =>
    typeof child === 'string'
      ? []
      : typeof child.type === 'string'
        ? [child]
        : directHostChildren(child)
  );
}

/** 루트에서 **유리(BlurView) 바깥**의 host 노드만 — 루트·모션 래퍼·그림자 래퍼. */
function hostsOutsideGlass(node: ReactTestInstance): ReactTestInstance[] {
  if (node.type === (BlurView as unknown)) return [];
  const own = typeof node.type === 'string' ? [node] : [];
  const kids = node.children.filter(
    (child): child is ReactTestInstance => typeof child !== 'string'
  );
  return [...own, ...kids.flatMap(hostsOutsideGlass)];
}

const H_SPACING_CLASS =
  /(?:^|\s)(?:gap|gap-x|space-x|m|ml|mr|mx|ms|me|p|pl|pr|px|ps|pe)-/;

/** 가로 간격 className 을 가진 유리 바깥 노드들 — 비어 있어야 한다. */
export function hiddenSpacingClasses(): string[] {
  return hostsOutsideGlass(screen.getByTestId(current.root))
    .filter((node) => H_SPACING_CLASS.test(String(node.props.className ?? '')))
    .map(
      (node) =>
        `testID=${String(node.props.testID)} className=${String(node.props.className)}`
    );
}

// 허용 키(행 gap · 뒤로 marginRight · 캡슐 marginLeft) 밖의 가로 간격·오프셋 style 은 0/없음이어야 한다.
const STRAY_KEYS = [
  ...['margin', 'marginHorizontal', 'marginStart', 'marginEnd'],
  ...['padding', 'paddingHorizontal', 'paddingLeft', 'paddingRight'],
  ...['paddingStart', 'paddingEnd', 'left', 'right', 'start', 'end'],
];

export interface RowReading {
  /** 뒤로 가지 폭(가지가 없으면 0). */
  backWidth: number | undefined;
  /** 뒤로–캡슐 간격 = 행 gap + 뒤로 marginRight + 캡슐 marginLeft. */
  spacing: number;
  /** 캡슐이 남는 폭을 채운다(`flex`/`flexGrow` ≥ 1, 고정 `width` 없음). */
  capsuleFills: boolean;
  /** 허용 키 밖의 가로 간격·오프셋 style. */
  strayKeys: string[];
}

export function readRow(): RowReading {
  const root = screen.getByTestId(current.root);
  const branches = directHostChildren(root);
  const branchWith = (id: string) =>
    branches.find(
      (branch) =>
        branch.props.testID === id ||
        branch.findAll((node) => node.props?.testID === id).length > 0
    );
  const backBranch = branchWith(current.back); // 시작 5칸에서는 없을 수 있다 → 폭 0
  const capsuleBranch = branchWith(current.capsule);
  if (!capsuleBranch) throw new Error('바 루트 바로 아래에 캡슐 가지가 없다');
  const row = layoutStyle(root);
  const back: Style = backBranch ? layoutStyle(backBranch) : { width: 0 };
  const capsule = layoutStyle(capsuleBranch);
  const strayKeys: string[] = [];
  const check = (name: string, style: Style, keys: string[]) =>
    keys
      .filter((key) => num(style[key]) !== 0)
      .forEach((key) => strayKeys.push(`${name}.${key}=${String(style[key])}`));
  check('row', row, STRAY_KEYS);
  check('back', back, [...STRAY_KEYS, 'marginLeft']);
  check('capsule', capsule, [...STRAY_KEYS, 'marginRight']);
  return {
    backWidth: typeof back.width === 'number' ? back.width : undefined,
    spacing:
      num(row.columnGap ?? row.gap) +
      num(back.marginRight) +
      num(capsule.marginLeft),
    capsuleFills:
      (num(capsule.flex) >= 1 || num(capsule.flexGrow) >= 1) &&
      capsule.width === undefined,
    strayKeys,
  };
}

// ── 단계 함수 값 ↔ 칸 스타일 고리 · 기기 폭 ───────────────────────────────────────────────────────────────────────────────
// 칸 효과 = 캡슐 래퍼 앞까지 올라가며 만나는 host 조상들의 reanimated 스타일을 합친 값(불투명도 곱 · 확대 곱 · translateX 합) —
// 어느 래퍼가 어느 값을 내든 같게 읽힌다. 오라클은 늘 `barMorphFrame` 호출 결과이고 구현 수식을 베끼지 않는다.

/** 기기(윈도우) 폭을 바꾼다 — 바 폭 = 윈도우 폭 − 60. 반환한 스파이를 afterEach 에서 `mockRestore()`. */
export const setWindowWidth = (width: number): jest.SpyInstance =>
  jest
    .spyOn(Dimensions, 'get')
    .mockReturnValue({ width, height: 800, scale: 2, fontScale: 1 });

export interface SlotEffect {
  opacity: number;
  scale: number;
  translateX: number;
}

const transformsOf = (style: Style): Record<string, unknown>[] =>
  Array.isArray(style.transform)
    ? (style.transform as Record<string, unknown>[])
    : [];

/** 칸 `id` 에서 캡슐 래퍼 앞까지의 조상 효과(없으면 불투명도 1·확대 1·이동 0). */
export function slotEffect(id: string): SlotEffect {
  const effect: SlotEffect = { opacity: 1, scale: 1, translateX: 0 };
  const capsule = screen.getByTestId(current.capsule);
  let node: ReactTestInstance | null = screen.getByTestId(id, {
    includeHiddenElements: true,
  });
  for (; node && node !== capsule; node = node.parent) {
    if (typeof node.type !== 'string') continue;
    const style = layoutStyle(node);
    if (typeof style.opacity === 'number') effect.opacity *= style.opacity;
    for (const entry of transformsOf(style)) {
      if (typeof entry.scale === 'number') effect.scale *= entry.scale;
      if (typeof entry.translateX === 'number')
        effect.translateX += entry.translateX;
    }
  }
  return effect;
}

/** 바 루트의 바 전체 확대. */
export const rootScale = (): number =>
  transformsOf(layoutStyle(screen.getByTestId(current.root))).reduce(
    (scale, entry) =>
      typeof entry.scale === 'number' ? scale * entry.scale : scale,
    1
  );

/** 마운트돼 있는가(접근성 숨김 포함). */
export const isMounted = (id: string): boolean =>
  screen.queryByTestId(id, { includeHiddenElements: true }) !== null;

/**
 * 일정 칸이 **지금 화면에서 보이는 중심 x**(바 앵커 왼쪽 = 0) = 레이아웃 자리 + 칸에 걸린 translateX. 레이아웃 자리는 flex 를 못 돌리므로
 * 구조에서 직접 계산한다(구현 수식이 아니라 기하): 캡슐 왼쪽 끝 = 뒤로 폭 + 간격(`readRow`), 안쪽 패딩 10, 마운트된 칸들이 폭을 똑같이 나눠 가진다.
 */
export function scheduleVisibleCenter(barWidth: number): number {
  const row = readRow();
  const barLeft = (row.backWidth ?? 0) + row.spacing;
  const inner = barWidth - barLeft - 20;
  const slotIds = [
    ...current.startCells,
    current.survivor,
    ...current.fresh.filter((id) => id !== current.back),
  ];
  const order = screen.root
    .findAll(
      (node: ReactTestInstance) =>
        typeof node.type === 'string' && slotIds.includes(node.props.testID)
    )
    .map((node) => node.props.testID as string)
    .filter((id, index, all) => all.indexOf(id) === index);
  const index = order.indexOf(current.survivor);
  const layoutCenter = barLeft + 10 + (inner * (index + 0.5)) / order.length;
  return layoutCenter + slotEffect(current.survivor).translateX;
}

// ── 입장 모프 시작 지연 ────────────────────────────────────────────────────────────────────────────────────────────────
// 계약: 모프는 OS 답 false + `InteractionManager.runAfterInteractions` 완료 + 마운트 후 `BAR_ENTER_DELAY_MS` 중 가장 늦은 시점에 시작한다.
// ⚠️ 진짜 `InteractionManager` 는 `setImmediate` 핸들을 모듈 변수에 쥔다 — 가짜 타이머 아래서 그 즉시 실행이 돌기 전에 테스트가 끝나면
//   핸들이 죽은 채 남아 이후 모든 `runAfterInteractions` 가 영영 안 불린다(바 입장과 무관한 테스트가 연쇄로 깨진 실측). 그래서 모프
//   describe 는 `useInteractionGate()` 로 스파이를 건다: 기본은 마이크로태스크 뒤 즉시 완료, `hold()` 하면 `finish()` 까지 미룬다.
export interface InteractionGate {
  hold: () => void;
  finish: () => void;
  /** 완료도 취소도 안 된 대기 건수. */
  pending: () => number;
}

export function useInteractionGate(): InteractionGate {
  let held = false;
  let queue: { run: () => void }[] = [];
  let spy: jest.SpyInstance | null = null;
  beforeEach(() => {
    held = false;
    queue = [];
    spy = jest
      .spyOn(InteractionManager, 'runAfterInteractions')
      .mockImplementation(((task?: () => void) => {
        let done: () => void = () => {};
        const promise = new Promise<void>((resolve) => {
          done = resolve;
        });
        const entry = {
          run: () => {
            task?.();
            done();
          },
        };
        if (held) queue.push(entry);
        else queueMicrotask(entry.run);
        return {
          then: promise.then.bind(promise),
          cancel: () => {
            entry.run = () => {};
            queue = queue.filter((item) => item !== entry);
          },
        };
      }) as unknown as typeof InteractionManager.runAfterInteractions);
  });
  afterEach(() => spy?.mockRestore());
  return {
    hold: () => {
      held = true;
    },
    finish: () => {
      held = false;
      const waiting = queue;
      queue = [];
      act(() => waiting.forEach((entry) => entry.run()));
    },
    pending: () => queue.length,
  };
}
