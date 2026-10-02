import { render, screen, within } from '@testing-library/react-native';
import Svg, { Path } from 'react-native-svg';

import { TripCalendarMonth } from './TripCalendarMonth';
import type { MonthCell } from '@/shared/date/monthGrid';

/**
 * TRIP-767 · AC-5 — j07 월 캘린더 chevron 크기·색 정합(Figma 1570:1998: 얇은 회색 ≈16, 현 22 ink).
 *
 * 무엇을 보장하나(계약):
 *  - 🔴 이전/다음 월 chevron 이 `BackArrowGlyph` 에 **size 16**(Svg width=16)로 그려진다(현 22 → red).
 *  - 🔴 chevron 에 **기본 INK 아닌 회색 color 가 배선**된다(Path stroke ≠ #222222 → red). 정확한 회색
 *    값·두께는 6-b(글리프 fill 사각) — 여기선 "회색이 배선됐다"는 구조만.
 *
 * ★ 글리프 색 사각(repo-traps): 색 **값**은 안 단언한다. "≠ INK" 는 색 판정이 아니라 "TripCalendarMonth 가
 *   BackArrowGlyph 에 (기본이 아닌) color 를 실제로 넘겼다"는 **배선 증거**다. BackArrowGlyph.color 의 값
 *   자체 정합은 RecordGlyphs.test 가 잠근다.
 *
 * *(개념 — within 스코프)* chevron 이 prev/next 2개라 트리에 Svg·Path 가 각 2개다. `within(testID)` 로
 *  한 chevron Pressable 안으로 범위를 좁혀 그 안의 Svg/Path 1개만 집는다(§5 실검증 — 스코프당 1개 프로브 확인).
 *
 * 3동작 뼈대: 준비(무상태 props) → 실행(렌더) → 단언(각 chevron Svg width·Path stroke).
 */

const INK = '#222222';

/** 6월 그리드의 앞부분만 든 최소 픽스처(1일 셀 + 앞 패딩 null). chevron 만 관찰하므로 그리드는 최소면 족하다. */
const GRID: (MonthCell | null)[] = [null, { date: '2026-06-01', day: 1 }];

function renderMonth(): void {
  render(
    <TripCalendarMonth
      monthLabel="2026년 6월"
      grid={GRID}
      markedDays={[]}
      onPressPrev={() => {}}
      onPressNext={() => {}}
    />
  );
}

describe('🔴 AC-5 · 월 chevron 16 + 회색 color 배선', () => {
  it.each(['record-calendar-prev', 'record-calendar-next'])(
    '%s chevron 은 size 16(Svg width=16)이고 기본 INK 가 아닌 색이 배선된다',
    (chevronTestId) => {
      renderMonth();
      const chevron = within(screen.getByTestId(chevronTestId));

      // size 16 — 현 22 → red.
      expect(chevron.UNSAFE_getByType(Svg).props.width).toBe(16);

      // 색 배선 — 기본 INK(#222222)가 아니어야 한다(회색 color 를 넘겼다는 증거). 현 INK → red.
      // 정확한 회색 값·두께는 6-b(글리프 fill 사각).
      expect(chevron.UNSAFE_getByType(Path).props.stroke).not.toBe(INK);
    }
  );
});
