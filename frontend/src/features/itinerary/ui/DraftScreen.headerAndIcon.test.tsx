import { render, screen } from '@testing-library/react-native';

import type { ItineraryDaysItem } from '@/shared/api/generated/schemas';

import type { DraftDayTab, DraftView } from '../model/draftView';
import { DraftScreen } from './DraftScreen';
import { CheckCircleGlyph } from './ItineraryGlyphs';

/**
 * TRIP-1039 · 셸로 옮긴 뒤 DraftScreen 에 **남는 얼굴**(loading·failed·empty)의 정리(QA #033).
 *
 * 무엇을 보장하나:
 *  - 🔴 헤더 우상단 「직접 고르기」와 「다시 만들기」 사이에 구분자가 있어 두 버튼으로 읽힌다(AC-9).
 *    「직접 고르기」가 없으면 구분자도 없다(짝).
 *  - 🔴 폴백 목록의 안내 아이콘이 ✓(CheckCircleGlyph)가 아니다(AC-7).
 *
 * 구분자가 실제로 "둘로 읽히게" 보이는지는 6-b 육안 몫이다 — 여기선 트리 순서만 잰다.
 *
 * 3동작 뼈대: 준비=얼굴(view)·콜백을 골라 렌더 → 실행=렌더 → 단언=testID 순서·글리프 개수.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const DAY1 = '2026-06-10';
const TABS: DraftDayTab[] = [{ date: DAY1, dayNumber: 1, hasData: true }];
const DAYS: ItineraryDaysItem[] = [
  {
    date: DAY1,
    slots: [
      {
        poiId: 'poi-a',
        startAt: '09:30:00',
        endAt: '11:00:00',
        isFixed: false,
        endsNextDay: false,
        hasViolation: false,
        alternatives: [],
        tags: [],
        nameKo: '성산일출봉',
      },
    ],
  },
];

function renderScreen(over: {
  view: DraftView;
  onManualPlan?: () => void;
  fallback?: boolean;
}) {
  return render(
    <DraftScreen
      view={over.view}
      tabs={TABS}
      selectedDate={DAY1}
      pins={[]}
      dayHeader="6월 10일 · 수"
      canRetry
      onSelectDay={jest.fn()}
      onRetry={jest.fn()}
      onBack={jest.fn()}
      onComplete={jest.fn()}
      onManualPlan={over.onManualPlan}
      fallback={over.fallback}
    />
  );
}

const REMAINING_FACES: { name: string; view: DraftView }[] = [
  { name: 'loading', view: { kind: 'loading' } as DraftView },
  { name: 'failed', view: { kind: 'failed' } as DraftView },
  { name: 'empty', view: { kind: 'empty' } as DraftView },
];

describe('🔴 H1 · AC-9 — 헤더 두 텍스트 버튼 사이에 구분자가 있다 (QA #033)', () => {
  it.each(REMAINING_FACES)(
    '$name 얼굴 — 직접 고르기 · 구분자 · 다시 만들기 순서다',
    ({ view }) => {
      renderScreen({ view, onManualPlan: jest.fn() });

      // getAllByTestId 는 트리 전위 순서로 돌려준다(02a §5 실측) — 구분자가 둘 **사이**에 있어야 한다.
      const order = screen
        .getAllByTestId(/^itinerary-draft-(pick-manual|header-divider|retry)$/)
        .map((node) => String(node.props.testID));

      expect(order).toEqual([
        'itinerary-draft-pick-manual',
        'itinerary-draft-header-divider',
        'itinerary-draft-retry',
      ]);
    }
  );
});

describe('H2 · AC-9 짝 — 「직접 고르기」가 없으면 구분자도 없다 (선제 green · 무조건 구분자 구현 차단)', () => {
  it('onManualPlan 미배선이면 다시 만들기만 있고 구분자는 없다', () => {
    renderScreen({ view: { kind: 'empty' } as DraftView });

    expect(screen.getByTestId('itinerary-draft-retry')).toBeOnTheScreen();
    expect(screen.queryByTestId('itinerary-draft-header-divider')).toBeNull();
  });
});

describe('🔴 I1 · AC-7 — 폴백 안내 아이콘은 ✓ 가 아니다 (QA #033)', () => {
  it.each([
    ...REMAINING_FACES.filter((face) => face.name !== 'loading'),
    {
      name: 'listed',
      view: { kind: 'listed', days: DAYS, staleFailed: false } as DraftView,
    },
  ])(
    '$name 얼굴 + fallback — 안내 제목은 기본 일정 결이고 CheckCircleGlyph 는 0개다',
    ({ view }) => {
      renderScreen({ view, fallback: true });

      // 긍정 앵커 — 폴백 안내가 실제로 그려졌다(빈 화면 공허 통과 방지).
      expect(
        screen.getByTestId('itinerary-draft-reason-title')
      ).toHaveTextContent('취향 반영 없이 만든 기본 일정이에요');
      expect(screen.UNSAFE_queryAllByType(CheckCircleGlyph)).toHaveLength(0);
    }
  );
});
