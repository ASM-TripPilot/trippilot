import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  InteractionManager,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { TAB_CONFIG, type ShellTabKey } from '@/shared/ui/BottomTabBar';

import {
  NAV_BAR_CAPSULE_PADDING_X,
  NAV_BAR_CELL_HEIGHT,
  NAV_BAR_HEIGHT,
  NAV_BAR_SIDE,
} from '../config/navBarLayout';
import {
  BAR_ENTER_CUT_MS,
  BAR_ENTER_DELAY_MS,
  BAR_ENTER_MS,
  BAR_EXIT_MS,
  BAR_EXIT_SWAP_MS,
  barMorphFrame,
  type BarMorphDirection,
  type BarMorphShape,
} from '../model/barMorph';
import { NavBarBackButton, NavBarCapsule } from './BottomNavBar';

/**
 * TRIP-1522 사이클 4 → TRIP-1584 · 하단 내비 바 변신 컨테이너(widgets) — 허브(`LiveBottomBar`)와 기록 3종(`RecordNavBar`)이 같이 쓴다.
 * 칸의 내용(어느 칸이 있고 무엇을 누르면 어디로 가나)은 호출자가 넣고, 이 컨테이너는 **움직임**만 진다.
 *
 * 변신 모션(영상 4단계 모프) — 출발 탭(`departureTab`)이 있으면 홈 탭 바와 같은 5칸(홈·탐색·일정·기록·마이)으로 시작해
 * ① 확대 → ② 생존 칸(허브 일정·기록 기록)만 남기고 컷 → ③ 폭이 줄며 생존 칸이 맨 앞으로 → ④ 뒤로 원 + 새 칸들 등장을 재생하고,
 * 뒤로 **버튼**은 그 역순을 재생한 **뒤**(`BAR_EXIT_MS` 타이머) `onBack` 을 부른다. 값은 순수 함수 `barMorphFrame(방향, 경과 ms, 폭, 칸 구성)` 이 내고,
 * 이 파일은 시간 하나(`time`)를 흘려 각 `useAnimatedStyle` 이 그 함수를 직접 읽게 한다. 구조(어느 칸이 마운트돼 있나)는 React 상태 `layer` 하나 —
 * 'start' = 홈 탭 바 5칸, 'final' = 뒤로 + 생존 칸 + 새 칸들. 생존 칸은 두 구조에서 같은 자리(같은 노드)라 리마운트되지 않는다.
 * 입장은 `entrance` 가 **마운트 순간** true 였을 때만(화면당 한 번 — 호출자가 정한다), OS 동작 줄이기 답이 `false` 로 확인된 뒤에 시작한다
 * (답 대기 중엔 시작 5칸 그대로, `true` 면 모션 없이 최종). 출발 탭이 없으면(탭 바 위가 아닌 진입) 모션 없이 최종 구조이고 뒤로는 즉시 `onBack`.
 * `onBack` 은 모션 완료 콜백이 아니라 **타이머**로 부른다(콜백이 안 와도 이동 — INV-4). 하드웨어·스와이프 뒤로는 가로채지 않는다.
 * 간격은 style 숫자 한 곳(캡슐 `marginLeft` = 알약 왼쪽 끝 − 뒤로 폭)에서만 난다 — Animated 노드엔 className 대신 style 을 쓴다.
 * 토스트 바닥 신고(`useToastBottom`)는 여기서 하지 않는다 — 호출자 몫이다(허브는 `LiveHubView`, 기록은 `RecordNavBar`).
 */

// 칸 슬롯 — 같은 구조 안의 칸들이 캡슐 폭을 똑같이 나눠 갖는다(시작 5칸은 5등분, 최종은 (1 + 새 칸 수)등분). 모양 변화는 불투명도·확대로만 한다.
const CELL_SLOT = { flexGrow: 1, flexBasis: 0 } as const;
const BAR_ROW = { flexDirection: 'row', alignItems: 'center' } as const;
const BACK_SLOT_ABSOLUTE = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: NAV_BAR_HEIGHT,
  height: NAV_BAR_HEIGHT,
} as const;
const LINEAR = (ms: number) => ({ duration: ms, easing: Easing.linear });

export interface MorphNavBarProps {
  /** 바 루트(허브 `execution-live-bottom-bar`). */
  testID: string;
  /** 캡슐 래퍼(허브 `execution-live-bar-capsule`). */
  capsuleTestID: string;
  backTestID: string;
  /** 시작 5칸 복제본의 id(허브 `execution-live-start-${tab}`). */
  startCellTestID: (tab: ShellTabKey) => string;
  onBack: () => void;
  /** 생존 칸이 홈 탭 바 5칸 중 어느 탭 자리인가 — 허브 'itinerary'(일정), 기록 'records'. */
  survivorTab: ShellTabKey;
  /** **최종 구조**에서 생존 칸이 활성인가. 시작 구조에서는 `departureTab === survivorTab` 가 대신한다. */
  survivorSelected: boolean;
  /** 생존 칸 하나(`NavBarCell`) — 같은 노드로 두 구조를 건넌다. 인자는 지금 구조에서의 활성 여부. */
  renderSurvivor: (selected: boolean) => ReactNode;
  /** 최종 구조에서 생존 칸 뒤에 새로 나타나는 칸들(`NavBarCell`). 길이가 곧 새 칸 수다. */
  newCells: ReactNode[];
  /** 마운트 후 입장 모션(시작 5칸 → 최종)을 한 번 재생한다. 마운트 순간의 값만 본다. 기본 꺼짐. `departureTab` 이 있어야 의미가 있다. */
  entrance?: boolean;
  /**
   * 이 화면으로 오기 직전 홈 탭 바에서 활성이던 탭. 시작 5칸의 활성 칸이자 퇴장이 끝날 때의 활성 칸이다(입장이 끝난 뒤에도 계속 준다).
   * 없으면 탭 바 위가 아닌 진입이라 모션 없이 최종 구조이고 뒤로는 즉시 `onBack` 이다.
   */
  departureTab?: ShellTabKey;
  /**
   * 뒤로 **버튼**의 퇴장이 끝날 때 활성인 탭(기록 3종은 늘 'records' — 어디서 왔든 뒤로는 기록 탭이다). 주면 출발 탭이 없어도 역순 모프를 재생하고(동작 줄이기만 즉시 이동),
   * 퇴장 중 시작 5칸의 활성 칸은 이 탭이다. 안 주면 위 `departureTab` 규칙 그대로(허브). 입장 모프는 여전히 `departureTab` 이 있어야 돈다.
   */
  exitTab?: ShellTabKey;
}

type Layer = 'start' | 'final';
type MorphClock = {
  dir: SharedValue<BarMorphDirection>;
  time: SharedValue<number>;
  /** 바 전체 폭 = 화면 폭 − 좌우 30×2 (바 앵커). 기기마다 다르다. */
  width: SharedValue<number>;
  /** 칸 구성(생존 칸 자리·새 칸 수) — 모션 내내 안 바뀌는 숫자 둘이라 일반 객체다. */
  shape: BarMorphShape;
};

/** 시작 칸·새 칸 슬롯 — 불투명도·확대를 단계 함수에서 읽는다(`barMorphFrame` 은 각 스타일 본문에서 직접 부른다 — 중첩 헬퍼는 jest 가 구독 못 한다). */
function MorphSlot({
  clock,
  group,
  index,
  children,
}: {
  clock: MorphClock;
  group: 'start' | 'new';
  index: number;
  children: ReactNode;
}): ReactElement {
  const style = useAnimatedStyle(() => {
    const frame = barMorphFrame(
      clock.dir.value,
      clock.time.value,
      undefined,
      clock.shape
    );
    const cell =
      group === 'start' ? frame.startCells[index] : frame.newCells[index];
    return { opacity: cell.opacity, transform: [{ scale: cell.scale }] };
  });
  return <Animated.View style={[CELL_SLOT, style]}>{children}</Animated.View>;
}

/**
 * 생존 칸 슬롯 — 구조가 바뀌어도 같은 노드다. 칸의 레이아웃 자리는 구조(5등분 `survivorSlot` 번째 / (1 + 새 칸 수)등분 첫째)와 알약 폭에 따라
 * 정해지고, 보이는 자리(`scheduleCenterX`)와의 차이를 translateX 로 메워 컷 순간에도 끊기지 않고 미끄러지게 한다.
 */
function SurvivorSlot({
  clock,
  layerSv,
  children,
}: {
  clock: MorphClock;
  layerSv: SharedValue<number>;
  children: ReactNode;
}): ReactElement {
  const style = useAnimatedStyle(() => {
    const frame = barMorphFrame(
      clock.dir.value,
      clock.time.value,
      clock.width.value,
      clock.shape
    );
    const inner = frame.barWidth - NAV_BAR_CAPSULE_PADDING_X * 2;
    const layoutCenter =
      frame.barLeft +
      NAV_BAR_CAPSULE_PADDING_X +
      (layerSv.value === 0
        ? (inner * (clock.shape.survivorSlot + 0.5)) / 5
        : inner / (2 * (1 + clock.shape.newCount)));
    return {
      transform: [{ translateX: frame.scheduleCenterX - layoutCenter }],
    };
  });
  return <Animated.View style={[CELL_SLOT, style]}>{children}</Animated.View>;
}

/** 시작 5칸 중 하나 — 홈 탭 바의 복제본일 뿐이라 누를 수 없다(탭 이동 없음). */
function StartCell({
  testID,
  tab,
  selected,
}: {
  testID: string;
  tab: (typeof TAB_CONFIG)[number];
  selected: boolean;
}): ReactElement {
  const Icon = selected ? tab.ActiveIcon : tab.InactiveIcon;
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected }}
      style={{ height: NAV_BAR_CELL_HEIGHT }}
      className="items-center justify-center gap-[3px]"
    >
      <Icon size={27} />
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        className={
          selected
            ? 'font-noto-bold text-micro font-bold text-primary'
            : 'font-noto text-micro text-muted'
        }
      >
        {tab.label}
      </Text>
    </View>
  );
}

export function MorphNavBar({
  testID,
  capsuleTestID,
  backTestID,
  startCellTestID,
  onBack,
  survivorTab,
  survivorSelected,
  renderSurvivor,
  newCells,
  entrance = false,
  departureTab,
  exitTab,
}: MorphNavBarProps): ReactElement {
  // 칸 구성 — 생존 칸이 홈 탭 바 몇 번째 자리인지(순서)와 새 칸 수(길이)에서 나온다. 시작 칸은 그 5칸에서 생존 칸을 뺀 4개.
  const startTabs = TAB_CONFIG.filter((tab) => tab.key !== survivorTab);
  const survivorSlot = TAB_CONFIG.findIndex((tab) => tab.key === survivorTab);
  const shape: BarMorphShape = { survivorSlot, newCount: newCells.length };
  // 입장 신호는 마운트 순간의 값만 본다 — 출발 탭이 없으면(탭 바 위가 아닌 진입) 신호가 와도 모션 없이 최종 구조다.
  const [playEntrance] = useState(entrance && departureTab !== undefined);
  // 구조: 입장 신호가 있으면 시작 5칸에서 선다(OS 답을 기다리는 동안에도 — 5칸도 완전한 바다), 아니면 처음부터 최종.
  const [layer, setLayer] = useState<Layer>(playEntrance ? 'start' : 'final');
  // 시계 — 방향과 경과 ms. 처음 값이 "그 구조의 모양"이라 모션이 없으면 아무것도 안 움직인다. `layerSv` 는 `layer` 의 UI 스레드 사본(0 = 시작).
  const dir = useSharedValue<BarMorphDirection>('enter');
  const time = useSharedValue(playEntrance ? 0 : BAR_ENTER_MS);
  const layerSv = useSharedValue(playEntrance ? 0 : 1);
  // 바 폭은 첫 프레임부터 윈도우 폭에서 파생한다(바 앵커 좌우 30) — `onLayout` 을 기다리지 않는다.
  const barWidth = useWindowDimensions().width - NAV_BAR_SIDE * 2;
  const widthSv = useSharedValue(barWidth);
  useEffect(() => {
    widthSv.value = barWidth;
  }, [barWidth, widthSv]);
  const clock: MorphClock = { dir, time, width: widthSv, shape };
  const showLayer = (next: Layer) => {
    layerSv.value = next === 'start' ? 0 : 1;
    setLayer(next);
  };
  // OS "동작 줄이기" 답 — Promise 라 늦게 온다(그 전엔 null). 화면을 다시 그릴 필요가 없어 상태가 아니라 ref 에 둔다.
  const reduceRef = useRef<boolean | null>(null);
  const leaving = useRef(false);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  // 구조를 바꾸는 시각·`onBack` 은 타이머로 건다(모션 완료 콜백이 아니라). 언마운트하면 전부 취소 — 화면이 먼저 사라졌는데 `back` 을 한 번 더 부르지 않는다.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };
  useEffect(() => {
    const pending = timers;
    return () => pending.current.forEach(clearTimeout);
  }, []);
  useEffect(() => {
    let alive = true;
    // 입장은 화면 첫 렌더가 끝난 뒤에 시작한다(시트 마운트·지도·목록 첫 렌더와 겹치면 프레임이 끊긴다): ① OS 답 false ② interactions 완료
    // ③ 마운트 후 `BAR_ENTER_DELAY_MS` 경과 — 셋 중 가장 늦은 순간. 그 전까지 시작 5칸을 그대로 보인다.
    const ready = { answer: false, interactions: false, delay: false };
    let started = false;
    const tryStart = () => {
      if (
        started ||
        leaving.current ||
        !(ready.answer && ready.interactions && ready.delay)
      )
        return;
      started = true;
      time.value = withTiming(BAR_ENTER_MS, LINEAR(BAR_ENTER_MS));
      later(() => showLayer('final'), BAR_ENTER_CUT_MS);
    };
    const interactions = playEntrance
      ? InteractionManager.runAfterInteractions(() => {
          ready.interactions = true;
          tryStart();
        })
      : null;
    if (playEntrance)
      later(() => {
        ready.delay = true;
        tryStart();
      }, BAR_ENTER_DELAY_MS);
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!alive) return;
      reduceRef.current = reduce;
      // 뒤로를 이미 눌렀다면(퇴장 중) 늦게 온 답이 아무것도 바꾸지 못한다. 입장은 답이 확인된 뒤에만 시작한다.
      if (leaving.current || !playEntrance) return;
      if (reduce) {
        time.value = BAR_ENTER_MS;
        showLayer('final');
        return;
      }
      ready.answer = true;
      tryStart();
    });
    return () => {
      alive = false;
      interactions?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 때 한 번(입장 신호도 마운트 순간 값)
  }, []);
  const pressBack = () => {
    if (leaving.current) return;
    leaving.current = true;
    // 출발 탭도 `exitTab` 도 모르면 끝 모양(어느 칸이 활성인 5칸인가)을 못 만든다 · 동작 줄이기 켜짐이면 모션이 없다 → 즉시 이동.
    if (
      (departureTab === undefined && exitTab === undefined) ||
      reduceRef.current === true
    ) {
      onBack();
      return;
    }
    // 답이 아직 안 왔어도(null) 퇴장한다. 입장 타이머를 취소하고 역순을 재생한 뒤 `BAR_EXIT_MS` 에 정확히 1회 이동.
    timers.current.forEach(clearTimeout);
    timers.current = [];
    dir.value = 'exit';
    time.value = 0;
    time.value = withTiming(BAR_EXIT_MS, LINEAR(BAR_EXIT_MS));
    later(() => showLayer('start'), BAR_EXIT_SWAP_MS);
    later(() => onBackRef.current(), BAR_EXIT_MS);
  };
  // 바 전체 확대(입장 ① 만).
  const rootStyle = useAnimatedStyle(() => ({
    transform: [{ scale: barMorphFrame(dir.value, time.value).barScale }],
  }));
  // 뒤로 원: 레이아웃 폭이 0 → 58 로 열린다. 안쪽 원(58×58)은 오른쪽 가장자리를 58 에 둔 채 왼쪽으로 자라도록 옮기고 줄인다.
  const backWrapStyle = useAnimatedStyle(() => ({
    width: barMorphFrame(dir.value, time.value).backSize,
  }));
  const backCircleStyle = useAnimatedStyle(() => {
    const size = barMorphFrame(dir.value, time.value).backSize;
    return {
      transform: [
        { translateX: NAV_BAR_HEIGHT / 2 - size / 2 },
        { scale: size / NAV_BAR_HEIGHT },
      ],
    };
  });
  // 캡슐: 왼쪽 끝이 `barLeft` 가 되도록 뒤로 폭을 뺀 만큼 왼쪽 여백을 낸다 — 뒤로–캡슐 간격 8 은 **여기 숫자 한 곳에서만** 난다
  // (최종 66 − 58 = 8, 시작 0). 루트에 `gap-*` 같은 className 간격을 또 두면 겹친다(jest 가 className 을 못 읽어 한 번 새어 나갔던 결함).
  const capsuleWrapStyle = useAnimatedStyle(() => {
    const frame = barMorphFrame(dir.value, time.value, widthSv.value);
    return { marginLeft: frame.barLeft - frame.backSize };
  });
  const start = layer === 'start';
  // 퇴장 중이면 시작 5칸의 활성 칸은 `exitTab` — ref 라 렌더 본문에서 매번 읽는다(`pressBack` 의 `showLayer('start')` 재렌더가 이 값을 바꾼다).
  const activeTab = leaving.current && exitTab ? exitTab : departureTab;
  const startSlot = (tab: (typeof TAB_CONFIG)[number], index: number) => (
    <MorphSlot key={tab.key} clock={clock} group="start" index={index}>
      <StartCell
        testID={startCellTestID(tab.key)}
        tab={tab}
        selected={activeTab === tab.key}
      />
    </MorphSlot>
  );
  const survivorOn = start ? activeTab === survivorTab : survivorSelected;
  return (
    <Animated.View
      testID={testID}
      pointerEvents="box-none"
      style={[BAR_ROW, rootStyle]}
    >
      {start ? null : (
        <Animated.View style={[{ height: NAV_BAR_HEIGHT }, backWrapStyle]}>
          <Animated.View style={[BACK_SLOT_ABSOLUTE, backCircleStyle]}>
            <NavBarBackButton testID={backTestID} onPress={pressBack} />
          </Animated.View>
        </Animated.View>
      )}
      <Animated.View
        testID={capsuleTestID}
        style={[{ flex: 1 }, capsuleWrapStyle]}
      >
        <NavBarCapsule>
          {start
            ? startTabs
                .slice(0, survivorSlot)
                .map((tab, index) => startSlot(tab, index))
            : null}
          <SurvivorSlot clock={clock} layerSv={layerSv}>
            {renderSurvivor(survivorOn)}
          </SurvivorSlot>
          {start
            ? startTabs
                .slice(survivorSlot)
                .map((tab, index) => startSlot(tab, survivorSlot + index))
            : null}
          {start
            ? null
            : newCells.map((cell, index) => (
                <MorphSlot key={index} clock={clock} group="new" index={index}>
                  {cell}
                </MorphSlot>
              ))}
        </NavBarCapsule>
      </Animated.View>
    </Animated.View>
  );
}
