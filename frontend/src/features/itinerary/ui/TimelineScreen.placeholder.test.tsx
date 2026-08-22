import { render, screen } from '@testing-library/react-native';

import type {
  ItineraryDaysItemSlotsItem,
  ItineraryStatus,
} from '@/shared/api/generated/schemas';

import type { PlanDayTab } from '../model/planState';
import { buildSlotKey } from '../model/slotKey';
import { type ItineraryHeaderData, TimelineScreen } from './TimelineScreen';

/**
 * TRIP-465 · 사진 없는 슬롯의 **카테고리 플레이스홀더**가 h25 카드에 실제로 뜨는지(렌더 배선).
 *
 * 무엇을 보장하나:
 *  - 🔴 **AC-1** imageUrl null + category "맛집" → 사진 leaf(`-image-`) 자리에 플레이스홀더
 *    (`-photoplaceholder-`)가 뜨고, 그 노드가 틴트 className `bg-primary-pale` 을 단다. 예전 빈
 *    자리(`: null`)가 아니다. 순수 매핑(`categoryPlaceholder.test.ts`)이 옳아도 화면이 그 값을
 *    testID 노드에 **얹지 않으면** 여기서 red — 배선(SlotPhotoPlaceholder 소비)을 잠근다.
 *  - 🟢 **AC-2**(선제 green · 상호 배타 회귀 앵커) imageUrl 있으면 기존 `<Image>` 가 그대로 뜨고
 *    플레이스홀더는 안 뜬다. 구현 전에도 참(플레이스홀더가 아직 없음) — 구현 후에도 참이어야 한다.
 *  - 🔴 **AC-4** category "액티비티"(enum 밖)·null → 폴백 플레이스홀더가 뜨고(빈 자리·크래시 아님)
 *    폴백 틴트 `bg-surface-soft` 를 단다.
 *
 * *(개념)* NativeWind `className` 은 jest 렌더 트리에 **평문 문자열 prop** 으로 남는다(`toHaveStyle`
 *   은 style 이 undefined 라 못 쓴다) — `getByTestId(id).props.className` 로 읽어 공백으로 쪼갠
 *   **토큰 배열**에 `toContain('bg-primary-pale')` 한다. 토큰 배열의 `toContain` 은 원소 완전일치라
 *   `bg-primary` 같은 부분포함 오탐이 없다(리포 선례: SocialLoginScreen.visual·MustVisitPickerScreen).
 *
 * 얇은 가짜 지도(`@/shared/map` 목) — 상시 인라인 지도를 관찰 마커로 바꿔 카드에 집중한다.
 *
 * 3동작 뼈대: 준비=사진 없는/있는·카테고리별 슬롯 → 실행=렌더 → 단언=플레이스홀더 존재·틴트·상호배타.
 */
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

const DAY1 = '2026-06-10';

function slot(
  over: Partial<ItineraryDaysItemSlotsItem> & { poiId: string }
): ItineraryDaysItemSlotsItem {
  return {
    startAt: '09:30:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
    lat: 35.16,
    lng: 129.16,
    ...over,
  };
}

function sk(poiId: string): string {
  return buildSlotKey(DAY1, poiId);
}

function placeholderId(poiId: string): string {
  return `itinerary-timeline-slot-photoplaceholder-${sk(poiId)}`;
}

function imageId(poiId: string): string {
  return `itinerary-timeline-slot-image-${sk(poiId)}`;
}

/** className 토큰 배열(공백 분리). 원소 완전일치로 틴트를 잰다. */
function classTokens(node: { props: { className?: unknown } }): string[] {
  return String(node.props.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
}

const HEADER: ItineraryHeaderData = {
  title: '부산 여행',
  nightsLabel: '3박 4일',
  totalPlaces: 1,
};

function renderCards(
  slots: ItineraryDaysItemSlotsItem[],
  status: ItineraryStatus = 'PLANNED'
) {
  const days: PlanDayTab[] = [{ dayIndex: 1, date: DAY1, count: slots.length }];
  return render(
    <TimelineScreen
      header={HEADER}
      days={days}
      slots={slots}
      activeDayIndex={0}
      status={status}
      onSelectDay={jest.fn()}
      onBack={jest.fn()}
      onConfirm={jest.fn()}
    />
  );
}

describe('🔴 PH1 · AC-1 — 사진 없는 "맛집" 슬롯 → 틴트 플레이스홀더(빈 자리 아님)', () => {
  it('플레이스홀더가 뜨고 bg-primary-pale 틴트를 달며, 사진 leaf 는 없다(상호 배타)', () => {
    const s = slot({ poiId: 'poi-food', imageUrl: null, category: '맛집' });
    renderCards([s]);

    // 플레이스홀더가 사진 자리에 실재한다(구현 전엔 `: null` 이라 없음 → red).
    const ph = screen.getByTestId(placeholderId('poi-food'));
    expect(ph).toBeOnTheScreen();

    // 틴트 className 이 그 testID 노드에 얹혀 있다(맛집 = bg-primary-pale).
    expect(classTokens(ph)).toContain('bg-primary-pale');

    // 사진 leaf 는 없다 — 사진 없는 슬롯이라 기본 이미지를 지어내지 않는다(INV-1).
    expect(screen.queryAllByTestId(imageId('poi-food'))).toEqual([]);
  });
});

describe('🟢 PH2 · AC-2 — 사진 있는 슬롯 → 기존 이미지 그대로, 플레이스홀더는 안 뜬다 (상호 배타)', () => {
  it('<Image> 가 뜨고 플레이스홀더는 0건이다', () => {
    const s = slot({
      poiId: 'poi-img',
      imageUrl: 'https://img.example.com/x.jpg',
      category: '맛집',
    });
    renderCards([s]);

    // 긍정 — 기존 사진 leaf 는 그대로 뜬다.
    expect(screen.getByTestId(imageId('poi-img'))).toBeOnTheScreen();
    // 짝 — 사진이 있으면 플레이스홀더는 아예 없다(둘은 상호 배타).
    expect(screen.queryAllByTestId(placeholderId('poi-img'))).toEqual([]);
  });
});

describe('🔴 PH3 · AC-4 — 매핑 밖 카테고리도 폴백 플레이스홀더를 그린다(빈 자리·크래시 아님)', () => {
  it('category "액티비티"(enum 밖) → 폴백 플레이스홀더 + bg-surface-soft 틴트', () => {
    const s = slot({ poiId: 'poi-act', imageUrl: null, category: '액티비티' });
    renderCards([s]);

    const ph = screen.getByTestId(placeholderId('poi-act'));
    expect(ph).toBeOnTheScreen();
    expect(classTokens(ph)).toContain('bg-surface-soft');
  });

  it('category null → 폴백 플레이스홀더가 뜬다(카드가 비지 않는다)', () => {
    const s = slot({ poiId: 'poi-null', imageUrl: null, category: null });
    renderCards([s]);

    expect(screen.getByTestId(placeholderId('poi-null'))).toBeOnTheScreen();
  });
});
