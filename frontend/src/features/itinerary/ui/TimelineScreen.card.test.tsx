import { fireEvent, render, screen } from '@testing-library/react-native';

import type {
  ItineraryDaysItemSlotsItem,
  ItineraryStatus,
} from '@/shared/api/generated/schemas';

import type { PlanDayTab } from '../model/planState';
import { buildSlotKey } from '../model/slotKey';
import { timeBandLabel } from '../model/timeBandLabel';
import { type ItineraryHeaderData, TimelineScreen } from './TimelineScreen';

/**
 * TRIP-354 · 시간표 **풀카드 + 구간행 + 휴관칩 + 이동합계** 계약. 골격 카드(번호·시각·라벨·고정·
 * 위반·익일만)를 풀카드로 올린다 — 사진·이름·영업시간·첫 태그가 붙고, 카드 사이에 구간행(거리 +
 * [길찾기])이 끼며, 날짜헤더가 그날 거리들을 합산한다. **카드 접두는 `itinerary-timeline-slot-*`
 * 를 유지**(02a §D 방향 ㄱ) — 동결 배지 계약과 h11 킬러 심판을 계승하려는 선택이다.
 *
 * 무엇을 보장하나:
 *  - 🔴 풀카드가 사진·장소명·영업시간·**첫 태그**를 각각 **값 하나만 담는 leaf**로 그린다(AC1).
 *    라벨 축은 `timeBandLabel`(Q1) — Figma 성격 축이 아니다.
 *  - 🔴 **반쪽 계약**(null 이 정상): imageUrl null→빈 자리·openingHours null→"미확인"·tags []→태그
 *    줄 부재·nameKo null→이름 leaf 부재. 기본이미지·더미 발명 금지(AC2 · INV-1).
 *  - 🔴 **휴관칩은 `openingHoursKnown===false` 에서만**(Q4). CONFIRMED 에선 그 값이 계약상 null 이라
 *    구조적으로 안 뜬다 — 그래서 **PLANNED 픽스처로 세운다**(null 케이스가 곧 h34 · 02a ★10).
 *  - 🔴 **구간행**: 슬롯[i]의 `distanceRange` 를 카드[i-1]↔[i] 사이에 **문자열 그대로** 그리고
 *    [길찾기](스텁)를 단다. 첫 카드 위엔 없고, null 이면 구간행 자체가 없다(AC5·6 · 02a ★6·★7).
 *  - 🔴 **이동합계**: 날짜헤더가 그날 `distanceRange` 들을 파싱·합산한 "이동 X" 를 그린다(Q2).
 *
 * 얇은 가짜 지도(`@/shared/map` 목) — 상시 인라인 지도를 관찰 마커로 바꿔 카드에 집중한다.
 *
 * 3동작 뼈대: 준비=표면이 채워진/빈/거리 있는 슬롯을 만들어 렌더 → 실행=렌더/press →
 * 단언=카드가 그리는 leaf·구간행·헤더.
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

function slotSub(role: string, poiId: string): string {
  return `itinerary-timeline-slot-${role}-${sk(poiId)}`;
}

function connectorId(poiId: string): string {
  return `itinerary-timeline-connector-${sk(poiId)}`;
}

function connectorSub(role: string, poiId: string): string {
  return `itinerary-timeline-connector-${role}-${sk(poiId)}`;
}

const HEADER: ItineraryHeaderData = {
  title: '부산 여행',
  nightsLabel: '3박 4일',
  totalPlaces: 3,
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

describe('🔴 CD1 · AC1 — 풀카드가 사진·장소명·영업시간·첫 태그를 각각 leaf 로 그린다', () => {
  it('사진·이름·영업시간·시각·시간대 라벨을 그리고, 태그는 첫 개만 그린다', () => {
    const full = slot({
      poiId: 'poi-a',
      startAt: '09:30:00',
      nameKo: '해운대 블루라인',
      imageUrl: 'https://img.example.com/a.jpg',
      openingHours: '24시간 개방',
      tags: ['바다', '야경'],
      category: '해변',
    });
    renderCards([full]);

    // leaf 라 문자열 완전 일치(02a §5-A).
    expect(screen.getByTestId(slotSub('name', 'poi-a'))).toHaveTextContent(
      '해운대 블루라인'
    );
    expect(screen.getByTestId(slotSub('hours', 'poi-a'))).toHaveTextContent(
      '24시간 개방'
    );
    expect(screen.getByTestId(slotSub('image', 'poi-a'))).toBeOnTheScreen();
    expect(screen.getByTestId(slotSub('time', 'poi-a'))).toHaveTextContent(
      '09:30'
    );
    // 라벨 축 = timeBandLabel(Q1). 실제 함수를 불러 기대값을 만든다(성격 축이면 자동 red).
    expect(screen.getByTestId(slotSub('band', 'poi-a'))).toHaveTextContent(
      timeBandLabel('09:30:00')
    );

    // 첫 태그만 — '#바다' 는 그리고 '야경' 은 안 그린다.
    expect(screen.getByTestId(slotSub('tag', 'poi-a'))).toHaveTextContent(
      '#바다'
    );
    const card = screen.getByTestId(`itinerary-timeline-slot-${sk('poi-a')}`);
    expect(card).not.toHaveTextContent(/야경/);
  });
});

describe('🔴 CD2 · AC2 — 반쪽 계약(null 이 정상): 빈 자리·"미확인"·부재 (INV-1)', () => {
  it('imageUrl null→사진 부재, openingHours null→"미확인", tags []→태그 부재, nameKo null→이름 부재', () => {
    const half = slot({
      poiId: 'poi-h',
      imageUrl: null,
      openingHours: null,
      tags: [],
      nameKo: null,
    });
    renderCards([half]);

    // 카드는 목록에 남는다(반쪽이라고 빼지 않는다).
    expect(
      screen.getByTestId(`itinerary-timeline-slot-${sk('poi-h')}`)
    ).toBeOnTheScreen();

    // 사진 요소 자체가 없다(기본 이미지 발명 금지).
    expect(screen.queryAllByTestId(slotSub('image', 'poi-h'))).toEqual([]);
    // 영업시간 null → 빈칸이 아니라 "미확인".
    expect(screen.getByTestId(slotSub('hours', 'poi-h'))).toHaveTextContent(
      '미확인'
    );
    // 태그 [] → 태그 leaf 부재. 이름 null → 이름 leaf 부재(더미 텍스트 금지).
    expect(screen.queryAllByTestId(slotSub('tag', 'poi-h'))).toEqual([]);
    expect(screen.queryAllByTestId(slotSub('name', 'poi-h'))).toEqual([]);
  });
});

describe('🔴 CD3 · Q4 — 휴관칩은 openingHoursKnown===false 에서만 뜬다 (h34 는 null 이라 안 뜸)', () => {
  it('openingHoursKnown false→휴관칩 있음, true/null→없음 (null 이 곧 CONFIRMED 케이스)', () => {
    const warn = slot({ poiId: 'w-false', openingHoursKnown: false });
    const known = slot({ poiId: 'w-true', openingHoursKnown: true });
    const unknown = slot({ poiId: 'w-null', openingHoursKnown: null });
    renderCards([warn, known, unknown], 'PLANNED');

    // 긍정 — false 에만 휴관칩. 문구는 비-공백만 잠근다(요일 필드가 계약에 없어 "월"을 발명 금지).
    const chip = screen.getByTestId(slotSub('warnchip', 'w-false'));
    expect(chip).toBeOnTheScreen();
    expect(chip).toHaveTextContent(/\S/);

    // 짝(부재) — true·null 에는 휴관칩이 0건이다. null 케이스가 곧 h34(CONFIRMED)라 구조적으로 안 뜸.
    expect(screen.queryAllByTestId(slotSub('warnchip', 'w-true'))).toEqual([]);
    expect(screen.queryAllByTestId(slotSub('warnchip', 'w-null'))).toEqual([]);
  });
});

describe('🔴 CD4 · AC5 — 구간행: 슬롯 distanceRange 를 문자열 그대로 + [길찾기], 첫 카드 위엔 없다', () => {
  it('첫 카드 위 구간행 부재, 둘째·셋째는 그 문자열 완전 일치 + 길찾기 스텁이 무해하다', () => {
    // S1 은 distanceRange 가 있어도 **첫 카드**라 구간행이 없다(위에 카드가 없다 · 02a ★6).
    const s1 = slot({
      poiId: 's1',
      distanceRange: '약 500m · 도보 추정',
    });
    const s2 = slot({ poiId: 's2', distanceRange: '약 950m · 도보 추정' });
    const s3 = slot({ poiId: 's3', distanceRange: '약 3.1km · 차량 추정' });
    renderCards([s1, s2, s3]);

    // 첫 카드 위엔 구간행이 없다(값이 있어도).
    expect(screen.queryByTestId(connectorId('s1'))).toBeNull();

    // 둘째·셋째 구간행에 서버 문자열이 **가공 없이 그대로**(BR-U3-08 · 02a ★7).
    expect(
      screen.getByTestId(connectorSub('distance', 's2'))
    ).toHaveTextContent('약 950m · 도보 추정');
    expect(
      screen.getByTestId(connectorSub('distance', 's3'))
    ).toHaveTextContent('약 3.1km · 차량 추정');

    // [길찾기]는 스텁 — 존재 + 눌러도 무해(콜백 없음 · Q6 · 02a ★11).
    const directions = screen.getByTestId(connectorSub('directions', 's2'));
    expect(directions).toBeOnTheScreen();
    expect(() => fireEvent.press(directions)).not.toThrow();
  });
});

describe('🔴 CD5 · AC6 — distanceRange 가 null 이면 그 카드 위 구간행이 아예 없다 (빈 문자열 렌더 금지)', () => {
  it('null 슬롯 위엔 구간행이 없고, 값 있는 비-첫 슬롯 위엔 있다', () => {
    const t1 = slot({ poiId: 't1', distanceRange: '약 950m · 도보 추정' }); // 첫 카드
    const t2 = slot({ poiId: 't2', distanceRange: null }); // 편집 직후 순서 무효
    const t3 = slot({ poiId: 't3', distanceRange: '약 1.2km · 도보 추정' });
    renderCards([t1, t2, t3]);

    // 긍정 앵커 — 값 있는 비-첫 슬롯(t3) 위엔 구간행이 있다.
    expect(
      screen.getByTestId(connectorSub('distance', 't3'))
    ).toHaveTextContent('약 1.2km · 도보 추정');

    // ★ null 슬롯(t2) 위엔 구간행 자체가 부재(빈 문자열 렌더 금지 · AC6).
    expect(screen.queryByTestId(connectorId('t2'))).toBeNull();
    expect(screen.queryAllByTestId(connectorSub('distance', 't2'))).toEqual([]);
  });
});

describe('🔴 CD6 · INV-4 — 좌표 없는 슬롯도 목록에 두고 "지도 미표시" 배지를 단다', () => {
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
    renderCards([noCoord, pinned]);

    const badge = screen.getByTestId(slotSub('nomap', 'no-xy'));
    expect(badge).toHaveTextContent(/\S/);
    expect(screen.queryAllByTestId(slotSub('nomap', 'pinned'))).toEqual([]);

    // ★ 둘 다 목록에 남는다 — 좌표 없다고 조용히 빼면 INV-4 위반이다.
    expect(
      screen.getByTestId(`itinerary-timeline-slot-${sk('no-xy')}`)
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`itinerary-timeline-slot-${sk('pinned')}`)
    ).toBeOnTheScreen();
  });
});

describe('🔴 CD7 · Q2 — 날짜헤더가 그날 distanceRange 들을 합산한 "이동 X" 를 그린다', () => {
  it('거리들의 합을 파싱·합산해 "이동 4.1km"(950m+3.1km) 를 그리고, 전부 null 이면 거리줄이 없다', () => {
    // 첫 슬롯 distanceRange 는 null(직전 지점 없음), 이후 950m + 3.1km = 4050m → "이동 4.1km"
    // (02a §5-F 프로브 검증값 — Figma 목업 숫자 아님).
    const d1 = slot({ poiId: 'd1', distanceRange: null });
    const d2 = slot({ poiId: 'd2', distanceRange: '약 950m · 도보 추정' });
    const d3 = slot({ poiId: 'd3', distanceRange: '약 3.1km · 차량 추정' });
    renderCards([d1, d2, d3]);

    expect(
      screen.getByTestId('itinerary-timeline-dayhdr-distance')
    ).toHaveTextContent('이동 4.1km');
  });

  it('그날 거리가 전부 null 이면 이동거리 줄이 부재한다 (헤더는 "{N}곳"만)', () => {
    const e1 = slot({ poiId: 'e1', distanceRange: null });
    const e2 = slot({ poiId: 'e2', distanceRange: null });
    renderCards([e1, e2]);

    // 긍정 앵커 — 헤더 컨테이너는 있다(빈 화면에서 부재가 공짜 통과하지 않게).
    expect(screen.getByTestId('itinerary-view-timeline')).toBeOnTheScreen();
    // 거리줄 부재(legDistance null → 헤더는 곳 수만).
    expect(
      screen.queryByTestId('itinerary-timeline-dayhdr-distance')
    ).toBeNull();
  });
});
