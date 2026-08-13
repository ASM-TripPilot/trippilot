import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import { buildDraftPins } from '../model/draftView';
import type { PlanDayTab } from '../model/planState';
import { buildSlotKey } from '../model/slotKey';
import { type ItineraryHeaderData, TimelineScreen } from './TimelineScreen';

/**
 * TRIP-354 · 완성·확정 일정 **인라인 지도 + h26 확대 오버레이** 계약(AC7·8 · Q5). **재작성**:
 * 시간표/지도 세그먼트 토글이 사라지고(결정 D) 날짜탭 밑에 **작은 viewOnly 글랜스 지도**가 상시
 * 깔린다. 그 우상단 **"지도 크게 보기"** pill 이 HEAD 의 h26 얼굴(제스처 탐색 지도 + peekstrip
 * `PoiSlotCard` + 핀 상세 시트 + 폴백)을 **화면 내 확대 오버레이**로 연다(로컬 `expanded` 상태 ·
 * 새 라우트 없음 · 같은 slots·pins 재사용 · 닫기=오버레이 닫힘). h26 렌더는 삭제되지 않고 이 오버레이로
 * 이사한다(01b Q5 정정 — h26 은 TRIP-301 이 이미 구현한 "지도" 얼굴이었다).
 *
 * 무엇을 보장하나 — [[가짜의 두께]] 얇은 층:
 *  - 🔴 기본 = 인라인 글랜스 지도(pins) + "지도 크게 보기" + 세로 풀카드. **세그먼트 토글 버튼 없음**(AC7).
 *  - 🔴 "지도 크게 보기" press → **확대 오버레이가 h26(제스처 지도 + peekstrip PoiSlotCard)를 연다**,
 *    닫기 → 인라인 복귀(Q5). 오버레이 안에서 핀탭→상세시트, 지도 실패→폴백+재시도가 산다.
 *  - 🔴 peekstrip `PoiSlotCard` 는 오버레이에서 통일 카드 표면(이름·분류·영업시간·거리·좌표없음 배지)을
 *    그린다(TRIP-301 커버리지 계승 · null→"미확인"·좌표없음 배지).
 *
 * 무엇을 보장하지 **못**하나(6-b 실기 전용 · 02a ★14): 글랜스 viewOnly vs 오버레이 제스처 · 줌 상한 ·
 * 핀 실렌더 · 폴리라인. "크게 보기가 확대 지도를 연다"까지만 잰다(01b Q5). 얇은 가짜는 넘긴 prop·배선만 본다.
 *
 * *(개념)* **얇은 가짜** — `@/shared/map` 을 목으로 바꾸면 `KakaoMapView` 가
 * `<Text testID="map-root" {...rest}>` 가 된다. 기본/오버레이 지도는 **상호 배타**(한 번에 하나만
 * 렌더)라 `map-root` 가 언제나 하나다. 콜백은 `act(() => props.onXxx(...))` 로 직접 발화한다.
 *
 * 3동작 뼈대: 준비=`slots` 로 렌더 → 실행=크게 보기 press·핀 메시지 발화 → 단언=오버레이·지도값·시트·폴백.
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

/** peekstrip 통일 카드 하위 요소 — `itinerary-poi-card-{role}-{slotKey}`. */
function poiField(role: string, poiId: string): string {
  return `itinerary-poi-card-${role}-${sk(poiId)}`;
}

/** 좌표 있는 두 슬롯 — 결번이 없어 `pins[i]` 가 곧 `slots[i]` 다. */
const TAP_A = slot({
  poiId: 'poi-a',
  lat: 35.16,
  lng: 129.16,
  startAt: '09:30:00',
  nameKo: '광안리 해변',
  category: '해변',
  openingHours: '24시간 개방',
  distanceRange: '약 1.2km · 도보 추정',
});
const TAP_B = slot({
  poiId: 'poi-b',
  lat: 35.17,
  lng: 129.13,
  startAt: '11:00:00',
  nameKo: '감천문화마을',
  category: '명소',
  openingHours: '09:00–18:00 영업',
  distanceRange: '약 3.1km · 차량 추정',
});
const TAP_SLOTS = [TAP_A, TAP_B];

/** 가운데 슬롯 좌표가 null — 핀에서 빠지되 번호는 [1,3] 로 뛴다. */
const GAP_A = slot({ poiId: 'gap-a', lat: 35.16, lng: 129.16 });
const GAP_B = slot({ poiId: 'gap-b', lat: null, lng: null });
const GAP_C = slot({ poiId: 'gap-c', lat: 35.17, lng: 129.13 });
const GAP_SLOTS = [GAP_A, GAP_B, GAP_C];

/** 영업시간 null 슬롯(시트 "미확인"용) — 좌표는 있어 핀 탭이 성립한다. */
const NULLHOURS = slot({
  poiId: 'poi-nh',
  lat: 35.1,
  lng: 129.03,
  nameKo: '자갈치시장',
  category: '시장',
  startAt: '10:00:00',
  openingHours: null,
});

const HEADER: ItineraryHeaderData = {
  title: '부산 여행',
  nightsLabel: '3박 4일',
  totalPlaces: 3,
};

const DAYS: PlanDayTab[] = [{ dayIndex: 1, date: DAY1, count: 3 }];

const onSelectDay = jest.fn();
const onBack = jest.fn();

function renderMap(slots: ItineraryDaysItemSlotsItem[] = TAP_SLOTS) {
  return render(
    <TimelineScreen
      header={HEADER}
      days={DAYS}
      slots={slots}
      activeDayIndex={0}
      status="PLANNED"
      onSelectDay={onSelectDay}
      onBack={onBack}
      onConfirm={jest.fn()}
    />
  );
}

/** 확대 오버레이를 연다 — 열려야 그 안의 지도/시트/peekstrip을 관찰할 수 있다. 구현자가 여닫이를
 * 완성하기 전(스텁)에는 오버레이가 안 열려 여기서 red 가 난다(그게 이 사이클의 red 앵커). */
function openExpanded() {
  fireEvent.press(screen.getByTestId('itinerary-map-expand'));
  return screen.getByTestId('itinerary-map-expanded');
}

/** 상호 배타라 언제나 하나. 기본에선 글랜스, 오버레이 열림 상태에선 h26 지도다. */
function mapRoot() {
  return screen.getByTestId('map-root');
}

beforeEach(() => {
  onSelectDay.mockClear();
  onBack.mockClear();
});

describe('🔴 M1 · AC7 — 기본 = 인라인 글랜스 지도 + "지도 크게 보기", 세그먼트 토글은 없다', () => {
  it('글랜스 지도가 상시 뜨고 pins 가 buildDraftPins 이며, 세그먼트 버튼은 0건·확대 버튼은 있다', () => {
    renderMap(TAP_SLOTS);

    // 상시 인라인 글랜스 — 컨테이너와 지도가 떴다.
    expect(screen.getByTestId('itinerary-view-map')).toBeOnTheScreen();
    expect(mapRoot().props.pins).toEqual(buildDraftPins(TAP_SLOTS));

    // ★ 세그먼트 토글 버튼은 제거됐다(결정 D · 02a ★1). 짝(부재) — 두 버튼 모두 0건.
    expect(screen.queryAllByTestId('itinerary-view-segment-map')).toEqual([]);
    expect(screen.queryAllByTestId('itinerary-view-segment-timeline')).toEqual(
      []
    );

    // h26 입구 — "지도 크게 보기" 버튼이 글랜스에 있다(눌러 확대 오버레이를 연다).
    expect(screen.getByTestId('itinerary-map-expand')).toBeOnTheScreen();
  });
});

describe('🔴 M2 · AC7 — 좌표 없는 슬롯은 핀에서 빠지되 번호는 뛴다 (INV-4)', () => {
  it('가운데 좌표 null 슬롯이 핀에서 빠지고 남은 번호가 [1,3] 이다', () => {
    renderMap(GAP_SLOTS);
    const map = mapRoot();

    expect(map.props.pins).toEqual(buildDraftPins(GAP_SLOTS));
    expect(map.props.pins).toHaveLength(2);
    expect(map.props.pins.map((pin: { number: number }) => pin.number)).toEqual(
      [1, 3]
    );
  });
});

describe('🔴 M3 · Q5 — 확대 오버레이 안에서 핀을 누르면 상세 시트가 뜬다', () => {
  it('크게 보기로 h26 을 열고 0번 핀을 누르면 그 슬롯의 시각·이름·분류·영업시간·거리가 뜬다', () => {
    renderMap(TAP_SLOTS);

    // 확대 오버레이를 연다(스텁에선 안 열려 여기서 red). 핀탭 인프라는 이 오버레이 안에 산다.
    expect(openExpanded()).toBeOnTheScreen();

    // 탭 전 — 시트는 트리에 없다(상태 게이트).
    expect(screen.queryByTestId('itinerary-pin-detail-sheet')).toBeNull();

    const map = mapRoot();
    expect(typeof map.props.onMapMessage).toBe('function');
    act(() => map.props.onMapMessage({ type: 'PIN_TAP', index: 0 }));

    const sheet = screen.getByTestId('itinerary-pin-detail-sheet');
    expect(sheet).toHaveTextContent(/광안리 해변/);
    expect(sheet).toHaveTextContent(/해변/);
    expect(sheet).toHaveTextContent(/09:30/);
    expect(sheet).toHaveTextContent(/24시간 개방/);
    expect(sheet).toHaveTextContent(/약 1\.2km/);
  });
});

describe('🔴 M4 · Q5 — 확대 오버레이 시트에서도 영업시간 null 은 "미확인" 이다', () => {
  it('영업시간 null 슬롯을 열면 시트가 "미확인" 을 담는다', () => {
    renderMap([NULLHOURS]);
    expect(openExpanded()).toBeOnTheScreen();

    act(() => mapRoot().props.onMapMessage({ type: 'PIN_TAP', index: 0 }));

    const sheet = screen.getByTestId('itinerary-pin-detail-sheet');
    expect(sheet).toHaveTextContent(/자갈치/);
    expect(sheet).toHaveTextContent(/미확인/);
  });
});

describe('🔴 M5 · Q5 — 다른 핀을 누르면 시트 내용이 교체된다 (닫고 다시 아님)', () => {
  it('0번 핀 시트가 뜬 뒤 1번 핀을 누르면 내용이 슬롯1로 바뀌고 슬롯0 값은 사라진다', () => {
    renderMap(TAP_SLOTS);
    expect(openExpanded()).toBeOnTheScreen();
    const map = mapRoot();

    act(() => map.props.onMapMessage({ type: 'PIN_TAP', index: 0 }));
    expect(screen.getByTestId('itinerary-pin-detail-sheet')).toHaveTextContent(
      /광안리 해변/
    );

    act(() => map.props.onMapMessage({ type: 'PIN_TAP', index: 1 }));
    const sheet = screen.getByTestId('itinerary-pin-detail-sheet');
    expect(sheet).toHaveTextContent(/감천문화마을/);
    expect(sheet).not.toHaveTextContent(/광안리 해변/);
    expect(screen.queryAllByTestId('itinerary-pin-detail-sheet')).toHaveLength(
      1
    );
  });
});

describe('🔴 M6 · AC8 — 확대 오버레이 지도가 실패하면 폴백+재시도 + peekstrip 은 살아남는다 (INV-4)', () => {
  it('onLoadFailed 로 폴백이 뜨고 peekstrip 카드가 유지되며, 재시도하면 지도가 돌아온다', () => {
    renderMap(TAP_SLOTS);
    expect(openExpanded()).toBeOnTheScreen();

    const map = mapRoot();
    expect(typeof map.props.onLoadFailed).toBe('function');
    act(() => map.props.onLoadFailed());

    const fallback = screen.getByTestId('itinerary-map-fallback');
    expect(fallback).toHaveTextContent(/\S/);
    expect(screen.getByTestId('itinerary-map-retry')).toBeOnTheScreen();

    // ★ 화면 전체를 비우면 위반 — peekstrip 통일 카드가 유지된다(h26 폴백은 목록을 지우지 않는다).
    expect(
      screen.getByTestId(`itinerary-poi-card-${sk('poi-a')}`)
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('map-root')).toBeNull();

    fireEvent.press(screen.getByTestId('itinerary-map-retry'));
    expect(screen.getByTestId('map-root')).toBeOnTheScreen();
    expect(screen.queryByTestId('itinerary-map-fallback')).toBeNull();
  });
});

describe('🔴 M7 · Q5 — "지도 크게 보기"가 h26 확대 오버레이를 열고 peekstrip 을 보이며, 닫기로 복귀한다', () => {
  it('기본엔 peekstrip 이 없고, 크게 보기로 열면 peekstrip PoiSlotCard 가 뜨고, 닫으면 인라인 복귀', () => {
    renderMap(TAP_SLOTS);

    // 기본(인라인 글랜스) — 오버레이도 peekstrip 카드도 아직 없다.
    expect(screen.queryByTestId('itinerary-map-expanded')).toBeNull();
    expect(
      screen.queryByTestId(`itinerary-poi-card-${sk('poi-a')}`)
    ).toBeNull();

    // 크게 보기 → 오버레이 열림 + peekstrip PoiSlotCard 보임(같은 날짜 slots 재사용).
    expect(openExpanded()).toBeOnTheScreen();
    expect(
      screen.getByTestId(`itinerary-poi-card-${sk('poi-a')}`)
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`itinerary-poi-card-${sk('poi-b')}`)
    ).toBeOnTheScreen();

    // 닫기 → 오버레이·peekstrip 사라지고 인라인 글랜스로 복귀(뒤로가기=오버레이 닫기 · Q5).
    fireEvent.press(screen.getByTestId('itinerary-map-collapse'));
    expect(screen.queryByTestId('itinerary-map-expanded')).toBeNull();
    expect(screen.getByTestId('itinerary-view-map')).toBeOnTheScreen();
  });
});

describe('🔴 M8 · Q5 — peekstrip 통일 카드 표면 (TRIP-301 커버리지 계승: 이름·분류·영업시간·거리·null·좌표없음)', () => {
  it('오버레이 peekstrip 이 표면을 그리고, 영업시간 null→"미확인", 좌표 없는 슬롯엔 배지가 뜬다', () => {
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
    const nohours = slot({
      poiId: 'no-h',
      lat: 35.1,
      lng: 129.03,
      nameKo: '자갈치시장',
      openingHours: null,
    });
    const nocoord = slot({
      poiId: 'no-xy',
      nameKo: '남포동',
      lat: null,
      lng: null,
    });
    renderMap([full, nohours, nocoord]);

    expect(openExpanded()).toBeOnTheScreen();

    // 통일 카드 표면(leaf 완전 일치 · itinerary-poi-card-{role}-{slotKey}).
    expect(screen.getByTestId(poiField('name', 'poi-a'))).toHaveTextContent(
      '해운대 블루라인'
    );
    expect(screen.getByTestId(poiField('category', 'poi-a'))).toHaveTextContent(
      '해변'
    );
    expect(screen.getByTestId(poiField('hours', 'poi-a'))).toHaveTextContent(
      '09:00–21:00 영업'
    );
    expect(screen.getByTestId(poiField('distance', 'poi-a'))).toHaveTextContent(
      '약 1.2km · 도보 추정'
    );

    // 영업시간 null → "미확인"(빈칸 아님). 좌표 없는 슬롯 → "지도 미표시" 배지(비-공백만 잠금).
    expect(screen.getByTestId(poiField('hours', 'no-h'))).toHaveTextContent(
      '미확인'
    );
    expect(screen.getByTestId(poiField('nomap', 'no-xy'))).toHaveTextContent(
      /\S/
    );
  });
});
