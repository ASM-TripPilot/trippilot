import { act, render, screen } from '@testing-library/react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import type { PlanDayTab } from '../model/planState';
import { buildSlotKey } from '../model/slotKey';
import {
  type ItineraryHeaderData,
  TimelineScreen,
  type ViewSegmentValue,
} from './TimelineScreen';

/**
 * TRIP-301 · **통일 POI 슬롯 카드** 계약(AC-9·4·5·2). 지도 밑 peekstrip(가로)과 지도 실패
 * 폴백 목록(세로) **두 곳이 같은 카드 컴포넌트 하나**를 쓴다(D8 · 01b §E-2 좁힘 — 시간표
 * 세그먼트 카드 업그레이드는 TRIP-354 소관이라 여기 없다).
 *
 * ⚠️ **접두가 `itinerary-poi-card-` 다** — 시간표 골격 카드(`itinerary-timeline-slot-*`)와
 * 다른 계열이라, 이 사이클은 TRIP-299 의 시간표 카드·그 회귀 테스트(C1·C7·C9)를 건드리지
 * 않는다(02a ★1·★5).
 *
 * 무엇을 보장하나:
 *  - 🔴 카드가 장소명·분류·영업시간·거리·사진을 그린다(AC-9). `tags` 는 안 그린다(D9 안 만듦).
 *  - 🔴 지도 실패 폴백 목록도 **같은 testID 의 같은 카드**를 그린다(AC-9 두 표면 통일).
 *  - 🔴 영업시간이 null 이면 빈칸이 아니라 **"미확인"**(AC-4).
 *  - 🔴 거리는 `distanceRange` **문자열 완전 일치**(가공·시간추정 금지 · AC-5 · INV-3 행동 축),
 *    null 이면 거리 줄 **부재**.
 *  - 🔴 좌표 없는 슬롯은 목록에서 빼지 않고 "지도 미표시" 배지를 단다(AC-2 · INV-4).
 *
 * 얇은 가짜(`@/shared/map`)로 지도를 관찰 마커로 바꿔 렌더 노이즈를 없앤다 — 이 파일의
 * 관심사는 카드지 지도가 아니다. `segment='map'` 로 렌더해 peekstrip 카드를 관찰한다.
 *
 * 3동작 뼈대: 준비=표면이 채워진/빈 슬롯을 만들어 지도 세그먼트로 렌더 → 실행=렌더(폴백은
 * onLoadFailed 발화) → 단언=카드가 그리는 것/안 그리는 것.
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
    ...over,
  };
}

function sk(poiId: string): string {
  return buildSlotKey(DAY1, poiId);
}

/** 통일 카드 하위 요소 testID — `itinerary-poi-card-{role}-{slotKey}`. */
function fieldId(role: string, poiId: string): string {
  return `itinerary-poi-card-${role}-${sk(poiId)}`;
}

const HEADER: ItineraryHeaderData = {
  title: '부산 여행',
  nightsLabel: '3박 4일',
  totalPlaces: 3,
};

function renderPoi(slots: ItineraryDaysItemSlotsItem[]) {
  const days: PlanDayTab[] = [{ dayIndex: 1, date: DAY1, count: slots.length }];
  const segment: ViewSegmentValue = 'map';
  return render(
    <TimelineScreen
      header={HEADER}
      days={days}
      slots={slots}
      activeDayIndex={0}
      segment={segment}
      status="PLANNED"
      onSelectDay={jest.fn()}
      onSegmentChange={jest.fn()}
      onBack={jest.fn()}
    />
  );
}

describe('🔴 PP1 · AC-9 — 통일 카드가 POI 표면을 그린다 (peekstrip · D8)', () => {
  it('장소명·분류·영업시간·거리·사진을 그리되, tags 는 안 그린다 (D9 안 만듦)', () => {
    const full = slot({
      poiId: 'poi-a',
      lat: 35.16,
      lng: 129.16,
      nameKo: '해운대 블루라인',
      category: '해변',
      openingHours: '09:00–21:00 영업',
      distanceRange: '약 1.2km · 도보 추정',
      imageUrl: 'https://img.example.com/a.jpg',
      tags: ['바다'],
    });
    renderPoi([full]);

    // 양성 — 카드가 표면을 그린다(leaf 라 문자열 완전 일치 · 02a §5-A).
    expect(screen.getByTestId(fieldId('name', 'poi-a'))).toHaveTextContent(
      '해운대 블루라인'
    );
    expect(screen.getByTestId(fieldId('category', 'poi-a'))).toHaveTextContent(
      '해변'
    );
    expect(screen.getByTestId(fieldId('hours', 'poi-a'))).toHaveTextContent(
      '09:00–21:00 영업'
    );
    expect(screen.getByTestId(fieldId('distance', 'poi-a'))).toHaveTextContent(
      '약 1.2km · 도보 추정'
    );
    expect(screen.getByTestId(fieldId('image', 'poi-a'))).toBeOnTheScreen();

    // 카드 루트가 있다(peekstrip 에 통일 카드 한 장).
    expect(
      screen.getByTestId(`itinerary-poi-card-${sk('poi-a')}`)
    ).toBeOnTheScreen();

    // 음성 — tags 는 D9 가 안 만든다. 카드에 태그 텍스트가 없다.
    const card = screen.getByTestId(`itinerary-poi-card-${sk('poi-a')}`);
    expect(card).not.toHaveTextContent(/바다/);
    expect(screen.queryAllByTestId(fieldId('tag', 'poi-a'))).toEqual([]);
  });
});

describe('🔴 PP2 · AC-9 — 지도 실패 폴백 목록도 같은 통일 카드를 쓴다 (두 표면 통일 · D8)', () => {
  it('peekstrip 에 있던 카드가 폴백에서도 같은 testID·같은 표면으로 뜬다', () => {
    const full = slot({
      poiId: 'poi-a',
      lat: 35.16,
      lng: 129.16,
      nameKo: '해운대 블루라인',
      category: '해변',
      openingHours: '09:00–21:00 영업',
      distanceRange: '약 1.2km · 도보 추정',
      imageUrl: 'https://img.example.com/a.jpg',
    });
    renderPoi([full]);

    // 앵커 — 지도 정상일 때 peekstrip 에 카드가 있다.
    expect(screen.getByTestId(fieldId('name', 'poi-a'))).toHaveTextContent(
      '해운대 블루라인'
    );

    // 실행 — 지도 실패 → 폴백 세로 목록으로 넘어간다.
    act(() => screen.getByTestId('map-root').props.onLoadFailed());

    // 폴백에서도 **같은 testID·같은 표면**이다(폴백이 골격이 아니라 풀 카드 = 두 곳 같은 컴포넌트).
    expect(screen.getByTestId(fieldId('name', 'poi-a'))).toHaveTextContent(
      '해운대 블루라인'
    );
    expect(screen.getByTestId(fieldId('category', 'poi-a'))).toHaveTextContent(
      '해변'
    );
  });
});

describe('🔴 PP3 · AC-4 — 영업시간이 null 이면 "미확인" 이다 (빈칸 아님)', () => {
  it('null 슬롯은 "미확인" 을, 값 있는 슬롯은 그 문자열을 그린다', () => {
    const nohours = slot({
      poiId: 'no-h',
      lat: 35.1,
      lng: 129.03,
      nameKo: '자갈치시장',
      openingHours: null,
    });
    const hasHours = slot({
      poiId: 'has-h',
      lat: 35.15,
      lng: 129.11,
      nameKo: '광안리',
      openingHours: '24시간 개방',
    });
    renderPoi([nohours, hasHours]);

    // null → "미확인"(빈 문자열이면 사용자가 "정보 없음"인지 "24시간"인지 못 가른다).
    expect(screen.getByTestId(fieldId('hours', 'no-h'))).toHaveTextContent(
      '미확인'
    );
    // 짝 — 값이 있으면 그 문자열 그대로("항상 미확인" 구현을 죽인다).
    expect(screen.getByTestId(fieldId('hours', 'has-h'))).toHaveTextContent(
      '24시간 개방'
    );
  });
});

describe('🔴 PP4 · AC-5 — 거리는 문자열 그대로, null 이면 거리 줄이 없다 (BR-U2-08 · INV-3)', () => {
  it('distanceRange 를 완전 일치로 그리고(가공 금지), null 이면 거리 요소가 0개다', () => {
    const hasDist = slot({
      poiId: 'has-d',
      lat: 35.16,
      lng: 129.16,
      nameKo: '감천',
      distanceRange: '약 1.2km · 도보 추정',
    });
    const noDist = slot({
      poiId: 'no-d',
      lat: 35.17,
      lng: 129.13,
      nameKo: '태종대',
      distanceRange: null,
    });
    renderPoi([hasDist, noDist]);

    // 문자열 통째로(완전 일치) — 앞뒤에 이동수단·소요시간을 덧붙이거나 뽑으면 red
    //   (계약엔 이동수단 필드가 없다 · INV-3 파생 금지의 행동 축 · 02a ★7).
    expect(screen.getByTestId(fieldId('distance', 'has-d'))).toHaveTextContent(
      '약 1.2km · 도보 추정'
    );

    // null → 거리 줄 부재. queryAll 로 0건(getAll 은 무매칭 시 throw).
    expect(screen.queryAllByTestId(fieldId('distance', 'no-d'))).toEqual([]);
  });
});

describe('🔴 PP5 · AC-2 — 좌표 없는 슬롯은 목록에 두고 "지도 미표시" 배지를 단다 (INV-4 · D10)', () => {
  it('좌표 null 슬롯에 배지가 있고, 좌표 있는 슬롯엔 없으며, 둘 다 목록에 남는다', () => {
    const noCoord = slot({
      poiId: 'no-xy',
      nameKo: '남포동',
      lat: null,
      lng: null,
    });
    const pinned = slot({
      poiId: 'pinned',
      nameKo: '용두산',
      lat: 35.1,
      lng: 129.03,
    });
    renderPoi([noCoord, pinned]);

    // 좌표 없는 슬롯 — 배지가 있고 문구는 비어 있지 않다(정확 문구는 비-공백만 잠금).
    const badge = screen.getByTestId(fieldId('nomap', 'no-xy'));
    expect(badge).toHaveTextContent(/\S/);

    // 짝 — 좌표 있는 슬롯엔 배지가 0개다.
    expect(screen.queryAllByTestId(fieldId('nomap', 'pinned'))).toEqual([]);

    // ★ 둘 다 목록에 남는다 — 좌표 없다고 조용히 빼면 INV-4 위반이다.
    expect(
      screen.getByTestId(`itinerary-poi-card-${sk('no-xy')}`)
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`itinerary-poi-card-${sk('pinned')}`)
    ).toBeOnTheScreen();
  });
});
