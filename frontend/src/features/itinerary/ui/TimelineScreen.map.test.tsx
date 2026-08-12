import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import { buildDraftPins } from '../model/draftView';
import type { PlanDayTab } from '../model/planState';
import { buildSlotKey } from '../model/slotKey';
import {
  type ItineraryHeaderData,
  TimelineScreen,
  type ViewSegmentValue,
} from './TimelineScreen';

/**
 * TRIP-301 · 완성 일정 **지도 배선** 계약(AC-1·2·3·4·7·10). h25 시간표 화면의 `지도`
 * 세그먼트 placeholder(`지도는 곧 제공돼요`)를 실제 지도로 채우고, 핀 상세 바텀시트·폴백을
 * 얹는다. **범위 좁힘(01b §E-2): 미리보기 지도(구 AC-11)는 TRIP-354 소관이라 여기 없다.**
 *
 * 무엇을 보장하나 — [[가짜의 두께]] 얇은 층:
 *  - 🔴 지도로 넘어가는 `pins` 가 슬롯 좌표를 번호와 함께 담는다(AC-1). 좌표 없는 슬롯은 핀에서
 *    빠지되 번호는 뛴다(AC-2 · `buildDraftPins` 재사용). 탐색 지도라 viewOnly 가 아니다(D6).
 *  - 🔴 핀을 누르면(PIN_TAP) **라우트가 아니라** 제자리 바텀시트로 그 슬롯 상세가 뜨고(AC-3),
 *    다른 핀을 누르면 시트 내용이 교체된다(AC-10). 영업시간 null 이면 시트에도 "미확인"(AC-4).
 *  - 🔴 지도가 실패하면 폴백 박스+재시도가 뜨고 **POI 카드 목록은 살아남는다**(AC-7 · INV-4).
 *
 * 무엇을 보장하지 **못**하나(6-b 실기 전용 · 02a ★2): `viewOnly=false` 가 실제로 제스처를
 * 허용하나 · `setMaxLevel` 이 실제로 줌을 막나 · 핀 클릭이 실제로 발화하나 · 폴리라인이 눈에
 * 보이나. 얇은 가짜는 지도로 **넘긴 prop 값**과 부모 배선까지만 본다(지도 대본은 실행하지 않는다).
 *
 * *(개념)* **얇은 가짜** — `@/shared/map` 을 목으로 바꾸면 `KakaoMapView` 가
 * `<Text testID="map-root" {...rest}>` 가 된다. 넘긴 prop 이 `map-root.props.*` 로 그대로
 * 노출돼 밖에서 읽을 수 있다(DraftScreen.test 선례). 콜백은 `act(() => props.onXxx(...))` 로
 * 직접 발화한다(WebView 안 이벤트를 jest 가 실행하지 못하므로).
 *
 * ⚠️ 구현이 `@/shared/map/KakaoMapView` 로 **딥 임포트**하면 이 목이 안 붙어 `map-root` 가
 * 관찰되지 않는다 — 배럴(`@/shared/map`)로 가져와야 한다(DraftScreen·MustVisitPicker 선례).
 *
 * 3동작 뼈대: 준비=`slots`·`segment` 를 만들어 렌더 → 실행=핀 메시지 발화·버튼 press →
 * 단언=지도로 넘어간 값·뜬 시트·폴백·불린 콜백.
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

/** 좌표 있는 두 슬롯 — 결번이 없어 `pins[i]` 가 곧 `slots[i]` 다(index↔슬롯 1:1 · 02a ★3). */
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

/** 가운데 슬롯 좌표가 null — 핀에서 빠지되 번호는 [1,3] 로 뛴다(AC-2 · D10). */
const GAP_A = slot({ poiId: 'gap-a', lat: 35.16, lng: 129.16 });
const GAP_B = slot({ poiId: 'gap-b', lat: null, lng: null });
const GAP_C = slot({ poiId: 'gap-c', lat: 35.17, lng: 129.13 });
const GAP_SLOTS = [GAP_A, GAP_B, GAP_C];

/** 영업시간 null 슬롯(AC-4 시트 미확인용) — 좌표는 있어 핀 탭이 성립한다. */
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
const onSegmentChange = jest.fn();
const onBack = jest.fn();

type Overrides = {
  slots?: ItineraryDaysItemSlotsItem[];
  segment?: ViewSegmentValue;
};

function renderMap(over: Overrides = {}) {
  return render(
    <TimelineScreen
      header={HEADER}
      days={DAYS}
      slots={over.slots ?? TAP_SLOTS}
      activeDayIndex={0}
      segment={over.segment ?? 'map'}
      status="PLANNED"
      onSelectDay={onSelectDay}
      onSegmentChange={onSegmentChange}
      onBack={onBack}
    />
  );
}

/** 얇은 가짜 지도(관찰 마커). 지도 세그먼트에 정확히 하나 렌더된다. */
function mapRoot() {
  return screen.getByTestId('map-root');
}

beforeEach(() => {
  onSelectDay.mockClear();
  onSegmentChange.mockClear();
  onBack.mockClear();
});

describe('🔴 MM1 · AC-1 — 좌표 슬롯을 지도에 번호 핀+동선으로 넘긴다 (US-SCHED-06 · BR-U3-09)', () => {
  it('지도로 넘어간 pins 가 buildDraftPins(slots) 이고, 선을 끄지 않으며, 탐색 지도라 viewOnly 가 아니다', () => {
    renderMap({ segment: 'map', slots: TAP_SLOTS });

    // 도달 앵커 — 지도 세그먼트 컨테이너와 지도가 실제로 떴다.
    expect(screen.getByTestId('itinerary-view-map')).toBeOnTheScreen();
    const map = mapRoot();

    // 본체 — 넘긴 핀이 슬롯 좌표를 번호와 함께 담는다. 기대값을 실제 함수를 **불러** 만든다
    //   (핀 조립 규칙을 화면이 재구현하면 여기서 갈린다 · DraftScreen 선례).
    expect(map.props.pins).toEqual(buildDraftPins(TAP_SLOTS));

    // 동선 선(connectPins)은 끄지 않는다 = 기본값(true). 핀 번호가 솔버 확정 순서라 선이 사실이다.
    expect(map.props.connectPins).not.toBe(false);

    // 지도 세그먼트는 탐색하는 본 지도라 viewOnly 를 켜지 않는다(D6 — 제스처 허용+setMaxLevel).
    // 실제 제스처 허용·줌 상한은 6-b 실기 몫이다(02a ★2).
    expect(map.props.viewOnly).toBeFalsy();
  });
});

describe('🔴 MM2 · AC-2 — 좌표 없는 슬롯은 핀에서 빠지되 번호는 뛴다 (INV-4 · D10)', () => {
  it('가운데 좌표 null 슬롯이 핀에서 빠지고 남은 번호가 [1,3] 이다', () => {
    renderMap({ segment: 'map', slots: GAP_SLOTS });
    const map = mapRoot();

    // 핀 배열은 buildDraftPins 그대로 — 2개(가운데 건너뜀).
    expect(map.props.pins).toEqual(buildDraftPins(GAP_SLOTS));
    expect(map.props.pins).toHaveLength(2);

    // ★ 번호는 **다시 매기지 않는다** — ①③ 로 뛴다(재번호하면 지도 ③ 과 카드 ③ 이 어긋난다).
    expect(map.props.pins.map((pin: { number: number }) => pin.number)).toEqual(
      [1, 3]
    );
  });
});

describe('🔴 MM3 · AC-3 — 핀을 누르면 라우트가 아니라 바텀시트로 그 슬롯 상세가 뜬다', () => {
  it('PIN_TAP 전에는 시트가 없고, 누르면 그 슬롯의 시각·이름·분류·영업시간·거리가 뜬다', () => {
    renderMap({ segment: 'map', slots: TAP_SLOTS });

    // 탭 전 — 시트는 트리에 없다(상태 게이트 · 02a ★4). queryBy 로 부재를 잰다.
    expect(screen.queryByTestId('itinerary-pin-detail-sheet')).toBeNull();

    // 도달 앵커 — 핀 메시지 통로가 배선돼 있다(미배선이면 여기서 죽는다).
    const map = mapRoot();
    expect(typeof map.props.onMapMessage).toBe('function');

    // 실행 — 0번 핀(= 슬롯0)을 눌렀다고 친다. index 는 pins 배열의 0-기반 위치다(02a ★3).
    act(() => map.props.onMapMessage({ type: 'PIN_TAP', index: 0 }));

    // 시트가 제자리에 뜨고 슬롯0의 값을 담는다(여러 값이 이어지므로 **정규식** 부분 포함).
    //   라우트 이동이 아니다 — TimelineScreen 은 router 를 임포트하지 않는다(구조적 이동 불가).
    const sheet = screen.getByTestId('itinerary-pin-detail-sheet');
    expect(sheet).toHaveTextContent(/광안리 해변/);
    expect(sheet).toHaveTextContent(/해변/);
    expect(sheet).toHaveTextContent(/09:30/);
    expect(sheet).toHaveTextContent(/24시간 개방/);
    expect(sheet).toHaveTextContent(/약 1\.2km/);
  });
});

describe('🔴 MM4 · AC-4 — 시트에서도 영업시간 null 은 빈칸이 아니라 "미확인" 이다', () => {
  it('영업시간 null 슬롯을 열면 시트가 "미확인" 을 담는다 (카드와 별개 컴포넌트라 따로 잠근다)', () => {
    renderMap({ segment: 'map', slots: [NULLHOURS] });
    const map = mapRoot();

    act(() => map.props.onMapMessage({ type: 'PIN_TAP', index: 0 }));

    const sheet = screen.getByTestId('itinerary-pin-detail-sheet');
    // 앵커 — 시트가 실제로 그 슬롯을 열었다.
    expect(sheet).toHaveTextContent(/자갈치/);
    // 본체 — 영업시간 칸이 비지 않고 "미확인" 이다.
    expect(sheet).toHaveTextContent(/미확인/);
  });
});

describe('🔴 MM5 · AC-10 — 다른 핀을 누르면 시트 내용이 교체된다 (닫고 다시 아님 · D5)', () => {
  it('0번 핀 시트가 뜬 뒤 1번 핀을 누르면 내용이 슬롯1로 바뀌고 슬롯0 값은 사라진다', () => {
    renderMap({ segment: 'map', slots: TAP_SLOTS });
    const map = mapRoot();

    act(() => map.props.onMapMessage({ type: 'PIN_TAP', index: 0 }));
    expect(screen.getByTestId('itinerary-pin-detail-sheet')).toHaveTextContent(
      /광안리 해변/
    );

    // 재선택 — 시트를 닫지 않고 내용만 교체한다.
    act(() => map.props.onMapMessage({ type: 'PIN_TAP', index: 1 }));

    const sheet = screen.getByTestId('itinerary-pin-detail-sheet');
    expect(sheet).toHaveTextContent(/감천문화마을/); // 새 슬롯
    expect(sheet).not.toHaveTextContent(/광안리 해변/); // 옛 슬롯은 사라진다(겹치지 않음)

    // 시트는 여전히 정확히 하나다(닫고 새로 여는 구현이면 두 개가 겹칠 수 있다).
    expect(screen.queryAllByTestId('itinerary-pin-detail-sheet')).toHaveLength(
      1
    );
  });
});

describe('🔴 MM6 · AC-7 — 지도 실패 시 폴백+재시도를 보이고 POI 카드 목록은 살아남는다 (INV-4)', () => {
  it('onLoadFailed 로 폴백이 뜨고 카드가 유지되며, 재시도하면 지도가 돌아온다', () => {
    renderMap({ segment: 'map', slots: TAP_SLOTS });

    // 도달 앵커 — 실패 통지 통로가 배선돼 있다.
    const map = mapRoot();
    expect(typeof map.props.onLoadFailed).toBe('function');

    // 실행 — 지도 로드가 실패했다고 부모에 알린다.
    act(() => map.props.onLoadFailed());

    // 폴백 박스와 재시도가 뜨고, 문구는 비어 있지 않다(침묵 실패 금지 · INV-4).
    const fallback = screen.getByTestId('itinerary-map-fallback');
    expect(fallback).toHaveTextContent(/\S/);
    expect(screen.getByTestId('itinerary-map-retry')).toBeOnTheScreen();

    // ★ 화면 전체를 비우면 위반 — 통일 POI 카드 목록이 세로로 유지된다.
    expect(
      screen.getByTestId(`itinerary-poi-card-${buildSlotKey(DAY1, 'poi-a')}`)
    ).toBeOnTheScreen();
    // 지도 자리는 폴백으로 대체된다(고장난 지도를 그대로 두지 않는다).
    expect(screen.queryByTestId('map-root')).toBeNull();

    // 재시도 — key remount 로 지도를 다시 로드한다(관찰 가능한 결과만 잰다 · 02a ★6).
    fireEvent.press(screen.getByTestId('itinerary-map-retry'));

    expect(screen.getByTestId('map-root')).toBeOnTheScreen();
    expect(screen.queryByTestId('itinerary-map-fallback')).toBeNull();
    // 재시도 후에도 카드는 그대로다(폴백 왕복이 목록을 지우지 않는다).
    expect(
      screen.getByTestId(`itinerary-poi-card-${buildSlotKey(DAY1, 'poi-a')}`)
    ).toBeOnTheScreen();
  });
});
