import { useEffect, useRef, type ReactElement } from 'react';
import { View } from 'react-native';

import { useKeyboardVisible } from '@/shared/lib/useKeyboardVisible';
import {
  RecordsIconActive,
  RecordsIconInactive,
} from '@/shared/ui/BottomTabBar';
import { NoteGlyph, SummaryChartGlyph } from '@/shared/ui/glyphs';
import { useToastBottom } from '@/shared/ui/useToastBottom';

import {
  NAV_BAR_BOTTOM_GAP,
  NAV_BAR_RESERVE,
  NAV_BAR_SIDE,
} from '../config/navBarLayout';
import { useDepartureTab } from '../model/useDepartureTab';
import { NavBarCell } from './BottomNavBar';
import { MorphNavBar } from './MorphNavBar';

/**
 * TRIP-1584 · 기록 3종(j01 방문 기록·j03 회고·j04 요약)이 같이 쓰는 하단 바 — 뒤로 + 기록·회고·요약 3칸 캡슐, 허브와 같은 변신 모션(`MorphNavBar`).
 * 상태·라우터·조회는 없다(controlled): 어느 칸이 활성인지(`active`)와 칸을 눌렀을 때 할 일(콜백)은 부모가 준다.
 *
 * 활성 칸은 `onPressActive` 를 주면 그것만 부르고(안 주면 아무 일 없다 — 지금 화면), 콜백이 없어도 비활성(`disabled`)이 아니다. 활성이 아닌 칸이 콜백이 없으면 눌림 자체를 막는다
 * (회고 = 미래·로딩 판정, 요약 = 서버 `ready` — 판정은 부모 몫). 요약 칸이 막히면 「요약 준비 중」으로 읽힌다. 라벨은 칸 이름뿐(INV-3).
 *
 * 입장 모프는 탭 바 위에서 들어온 화면에서만 돈다(`useDepartureTab` — 바로 아래 라우트가 `(tabs)`). 키보드가 뜨면 바를 트리에서 뺀다(TRIP-1280 —
 * 투명 처리면 보이지 않는 바가 입력 위 터치를 가로챈다). 빠졌다 돌아온 바는 새로 마운트되므로 "한 번 보였나"는 여기서 ref 로 기억해 모프를 다시 돌리지 않는다.
 */

export type RecordBarTab = 'records' | 'reflection' | 'summary';

export interface RecordNavBarProps {
  /** testID 접두. 바 루트 `p`, 앵커 `p-anchor`, 캡슐 `p-capsule`, 뒤로 `p-back`, 칸 `p-tab-{records|reflection|summary}`, 시작 5칸 복제 `p-start-{탭}`. */
  testIDPrefix: string;
  active: RecordBarTab;
  onBack: () => void;
  onPressRecords?: () => void;
  onPressReflection?: () => void;
  onPressSummary?: () => void;
  /** 활성 칸을 눌렀을 때만 부른다(TRIP-1593 — j01 이 내려간 시트를 되올린다). 안 주면 활성 칸은 눌러도 아무 일 없다. */
  onPressActive?: () => void;
  /** 바를 뺀다(j03 편집 모드 — 저장·취소 푸터가 키보드 위에 있어야 한다). 키보드가 떠 있을 때도 스스로 뺀다. */
  hidden?: boolean;
}

const noop = (): void => {};

/** 바가 그려져 있는 동안만 토스트 바닥을 올린다 — 바가 빠지면 이 자식도 사라져 신고가 거두어진다. */
function ReserveToastBottom(): null {
  useToastBottom(NAV_BAR_RESERVE);
  return null;
}

export function RecordNavBar({
  testIDPrefix: p,
  active,
  onBack,
  onPressRecords,
  onPressReflection,
  onPressSummary,
  onPressActive,
  hidden = false,
}: RecordNavBarProps): ReactElement | null {
  const departureTab = useDepartureTab();
  const keyboardShown = useKeyboardVisible();
  const barHidden = hidden || keyboardShown;
  const entranceRef = useRef(true);
  useEffect(() => {
    if (!barHidden) entranceRef.current = false;
  }, [barHidden]);
  if (barHidden) return null;

  const cell = (
    tab: RecordBarTab,
    label: string,
    icon: ReactElement,
    onPress: (() => void) | undefined,
    selected = active === tab
  ) => {
    const on = active === tab;
    const blocked = !on && onPress === undefined;
    return (
      <NavBarCell
        key={tab}
        testID={`${p}-tab-${tab}`}
        label={label}
        icon={icon}
        selected={selected}
        disabled={blocked}
        value={tab === 'summary' && blocked ? '요약 준비 중' : undefined}
        onPress={on ? (onPressActive ?? noop) : (onPress ?? noop)}
      />
    );
  };
  const glyphColor = (tab: RecordBarTab) =>
    active === tab ? 'primary' : 'muted';
  return (
    <View
      testID={`${p}-anchor`}
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: NAV_BAR_SIDE,
        right: NAV_BAR_SIDE,
        bottom: NAV_BAR_BOTTOM_GAP,
      }}
    >
      <MorphNavBar
        testID={p}
        capsuleTestID={`${p}-capsule`}
        backTestID={`${p}-back`}
        startCellTestID={(tab) => `${p}-start-${tab}`}
        onBack={onBack}
        survivorTab="records"
        survivorSelected={active === 'records'}
        renderSurvivor={(selected) =>
          cell(
            'records',
            '기록',
            selected ? <RecordsIconActive /> : <RecordsIconInactive />,
            onPressRecords,
            selected
          )
        }
        newCells={[
          cell(
            'reflection',
            '회고',
            <NoteGlyph size={27} color={glyphColor('reflection')} />,
            onPressReflection
          ),
          cell(
            'summary',
            '요약',
            <SummaryChartGlyph size={27} color={glyphColor('summary')} />,
            onPressSummary
          ),
        ]}
        entrance={entranceRef.current}
        departureTab={departureTab}
      />
      <ReserveToastBottom />
    </View>
  );
}
