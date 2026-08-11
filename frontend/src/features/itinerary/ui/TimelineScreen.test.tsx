import type { ReactTestInstance } from 'react-test-renderer';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type {
  ItineraryDaysItemSlotsItem,
  ItineraryStatus,
} from '@/shared/api/generated/schemas';

import type { PlanDayTab } from '../model/planState';
import { buildSlotKey } from '../model/slotKey';
import { timeBandLabel } from '../model/timeBandLabel';
import tailwindConfig from '../../../../tailwind.config.js';
import {
  type ItineraryHeaderData,
  TimelineScreen,
  type ViewSegmentValue,
} from './TimelineScreen';

/**
 * h25 완성 일정 시간표 뷰의 **렌더 계약**. 화면은 완성된 값만 받는다 — 조회도 판정도 하지 않는다.
 *
 * 무엇을 보장하나 — 이 칸의 존재 이유부터:
 *  - 🔴 **비고정 슬롯 카드도 검증 시각을 보인다**(AC2). h11 초안은 `isFixed:false` 카드에 시각을
 *    **감췄지만**, h25는 완성이라 `isFixed` 무관하게 항상 시각을 그린다(BR-U3-07). 이 한 줄이
 *    쌍둥이(h11) 복붙을 즉사시킨다(02a ★1).
 *  - 🔴 **카드는 골격만 그린다**(AC8). 서버가 장소명·사진·영업시간·category·거리를 **줘도**
 *    왼쪽 절반을 안 그린다(01b Q2). "null이면 비운다"가 아니라 "채워져도 안 그린다"이다(02a ★2).
 *  - 고정 pill(AC3)·위반 배지(AC4, 저장무관)·자정 넘김 표기(AC5)·시간대 라벨(AC2)이 각각 뜬다.
 *  - 세그먼트 전환은 UI 상태(prop)로만 일어난다(AC6 화면부) — 데이터는 건드리지 않는다.
 *
 * (TRIP-300) 이 화면 위에 `status` 축을 얹는다 — 같은 화면의 두 얼굴이다:
 *  - 🔴 **PLANNED**: 하단에 **활성** 확정 CTA(`itinerary-confirm-cta`, 스텁 개명 · AC1).
 *  - 🔴 **CONFIRMED**: 확정 배너 + appbar `확정 일정` + 하단 [일정 수정]/[공유하기]**비활성** 2버튼,
 *    확정 CTA는 **부재**(읽기전용 · AC2·3·4·7). 비활성 [공유하기]는 `toBeDisabled()` 만으론 못
 *    잡는다 — Figma 분홍을 그대로 두면 "눌릴 것 같은데 안 눌리는" 함정이라 brand색 부재를 짝으로
 *    잰다(02a ★1).
 *
 * *(개념)* **testID** — 화면 요소에 붙이는 테스트 전용 이름표. 사용자에겐 안 보이고, 테스트가
 * "그 요소"를 정확히 집어 오는 손잡이다.
 *
 * 3동작 뼈대: 준비=`header`·`days`·`slots`를 만들어 렌더 → 실행=탭한다 → 단언=보이는 것·불린 콜백.
 */

const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';

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

/** 1번 — **비고정 + POI 표면 전부 채움**. 시간대 오전. AC2 킬러(비고정도 시각) + AC8(채워도 골격만). */
const SLOT_A = slot({
  poiId: 'poi-a',
  startAt: '09:30:00',
  endAt: '11:00:00',
  nameKo: '해운대 블루라인',
  imageUrl: 'https://img.example.com/a.jpg',
  tags: ['바다'],
  category: '해변',
  openingHours: '영업중',
  distanceRange: '약 1.2km · 도보 추정',
});
/** 2번 — **고정 블록**. 시간대 저녁. AC3(고정 pill) + AC2(고정도 시각·band). */
const SLOT_B = slot({
  poiId: 'poi-b',
  startAt: '21:00:00',
  endAt: '22:00:00',
  isFixed: true,
  nameKo: '부산 신라스테이',
});
/** 3번 — **위반**. 시간대 점심. AC4(위반 배지 + 사유, 저장무관). */
const SLOT_C = slot({
  poiId: 'poi-c',
  startAt: '13:00:00',
  endAt: '14:00:00',
  hasViolation: true,
  violationReason: '영업 종료 후 도착',
});
/** 4번 — **자정 넘김**. `endAt < startAt`이 정상이다(HC4). 시간대 저녁. AC5. */
const SLOT_D = slot({
  poiId: 'poi-d',
  startAt: '22:30:00',
  endAt: '06:00:00',
  endsNextDay: true,
});

const DAY1_SLOTS = [SLOT_A, SLOT_B, SLOT_C, SLOT_D];

const HEADER: ItineraryHeaderData = {
  title: '부산 여행',
  nightsLabel: '3박 4일',
  totalPlaces: 5,
};

const DAYS: PlanDayTab[] = [
  { dayIndex: 1, date: DAY1, count: 4 },
  { dayIndex: 2, date: DAY2, count: 1 },
];

function cardId(date: string, poiId: string): string {
  return `itinerary-timeline-slot-${buildSlotKey(date, poiId)}`;
}

function subId(role: string, date: string, poiId: string): string {
  return `itinerary-timeline-slot-${role}-${buildSlotKey(date, poiId)}`;
}

function violationId(date: string, poiId: string): string {
  return `itinerary-edit-violation-${buildSlotKey(date, poiId)}`;
}

/**
 * 카드 루트만 세는 셀렉터. 카드 testID가 `itinerary-timeline-slot-{slotKey}`라 번호·시각·라벨·
 * 고정·익일 표식도 **같은 접두를 공유한다** — 제외하지 않으면 카드 4장이 훨씬 많게 잡힌다
 * (twin 02a §5-B 실측: 접두 공유 확인). 위반 배지는 다른 접두(`itinerary-edit-`)라 안 섞인다.
 *
 * ⚠️ `queryAllByTestId`를 쓴다 — `getAllByTestId`는 무매칭 시 **throw**라 "0장"을 못 잰다.
 */
const CARD_SUB_PREFIXES = ['no-', 'time-', 'band-', 'fixed-', 'endsnext-'];

function cardTestIds(): string[] {
  return screen
    .queryAllByTestId(/^itinerary-timeline-slot-/)
    .map((node) => String(node.props.testID))
    .filter((testID) => {
      const tail = testID.slice('itinerary-timeline-slot-'.length);
      return !CARD_SUB_PREFIXES.some((prefix) => tail.startsWith(prefix));
    });
}

/** 렌더된 텍스트 전부. INV-3 렌더 스캔의 모집단 — 소스가 아니라 **보이는 글자**를 훑는다. */
function renderedTexts(): string[] {
  const out: string[] = [];
  screen.root
    .findAll(() => true)
    .forEach((node) => {
      const children = node.props?.children as unknown;
      const list = Array.isArray(children) ? children : [children];
      list.forEach((child) => {
        if (typeof child === 'string') out.push(child);
      });
    });
  return out;
}

/** 소요시간 표기 탐지기(twin C7과 같은 것). 02a §5-B 실측 — 확정 얼굴 신규 문자열에도 오탐 0건이고,
 * 시각(`09:30`)·날짜(`13일`)는 걸리지 않는다(`일`/`:`이지 `분/시간/소요`가 아니다). */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/**
 * *(개념)* **className** — NativeWind 가 쓰는 스타일 이름표. 이 환경에서는 렌더된 요소의 props 에
 * 문자열 그대로 남아 있어(02a §5-A) jest 가 **색을 볼 수 있는 유일한 통로**다(`toHaveStyle` 은 못
 * 쓴다 — `style` 이 undefined). `MustVisitPickerScreen`·`StaySearchScreen` 선례와 같은 방식.
 *
 * 브랜드 주색 **계열**(`primary`·`primary-active`·`primary-pale`·`primary-text`·`on-primary`)을
 * `tailwind.config.js`(= Figma 변수 미러)에서 파생한다 — 손으로 적은 목록은 색이 늘면 늙는다.
 */
const BRAND_COLORS = Object.keys(
  (
    tailwindConfig as unknown as {
      theme: { extend: { colors: Record<string, string> } };
    }
  ).theme.extend.colors
)
  .filter((name) => name === 'on-primary' || /^primary(-|$)/.test(name))
  .sort((a, b) => b.length - a.length);

/** `bg-primary` · `text-on-primary` 처럼 **유틸리티 접두 + 브랜드 색 이름** 한 덩어리. */
const BRAND_TOKEN = new RegExp(`^[a-z]+-(?:${BRAND_COLORS.join('|')})$`);

/** className 조각 중 브랜드 주색 계열을 **전부** 돌려준다. 비활성 버튼엔 `toEqual([])`(계열 전체
 * 부재)로, 활성 CTA엔 `.not.toEqual([])`(색이 실제로 보임)로 쓴다 — ★1 시각 사각지대 봉쇄. */
function brandTokensIn(node: ReactTestInstance): string[] {
  return String(node.props.className ?? '')
    .split(/\s+/)
    .filter((token) => BRAND_TOKEN.test(token));
}

const onSelectDay = jest.fn();
const onSegmentChange = jest.fn();
const onBack = jest.fn();
const onConfirm = jest.fn();

type Overrides = {
  header?: ItineraryHeaderData;
  days?: PlanDayTab[];
  slots?: ItineraryDaysItemSlotsItem[];
  activeDayIndex?: number;
  segment?: ViewSegmentValue;
  status?: ItineraryStatus;
  confirmedSubtitle?: string;
  confirmError?: string | null;
};

function renderScreen(over: Overrides = {}) {
  return render(
    <TimelineScreen
      header={HEADER}
      days={DAYS}
      slots={DAY1_SLOTS}
      activeDayIndex={0}
      segment="timeline"
      status="PLANNED"
      onSelectDay={onSelectDay}
      onSegmentChange={onSegmentChange}
      onBack={onBack}
      onConfirm={onConfirm}
      {...over}
    />
  );
}

beforeEach(() => {
  onSelectDay.mockClear();
  onSegmentChange.mockClear();
  onBack.mockClear();
  onConfirm.mockClear();
});

describe('C1 · 탐지기 자가검사 — 이게 통과해야 아래 개수·순서 단언이 의미를 갖는다', () => {
  it('카드 세는 셀렉터가 번호·시각·라벨·고정·익일 표식을 삼키지 않는다', () => {
    renderScreen();

    // 카드만 정확히 넷. 완전 일치라 하나라도 섞이면 여기서 먼저 죽는다.
    expect(cardTestIds()).toEqual([
      cardId(DAY1, 'poi-a'),
      cardId(DAY1, 'poi-b'),
      cardId(DAY1, 'poi-c'),
      cardId(DAY1, 'poi-d'),
    ]);

    // 짝 — 제외 대상이 화면에 **실재하는데도** 위 목록에 안 섞였다.
    expect(screen.getByTestId(subId('no', DAY1, 'poi-a'))).toBeOnTheScreen();
    expect(screen.getByTestId(subId('time', DAY1, 'poi-a'))).toBeOnTheScreen();
    expect(screen.getByTestId(subId('band', DAY1, 'poi-a'))).toBeOnTheScreen();
  });
});

describe('C2 · AC1 — 헤더와 날짜탭 (US-SCHED-06)', () => {
  it('헤더에 제목·N박M일·총 N곳이 뜨고, 날짜탭이 날짜 오름차순 1..N 이다', () => {
    renderScreen();

    // 헤더는 페이지가 조립한 문자열/수를 그대로 그린다(재계산 금지). 부분 포함(정규식)으로 잰다.
    const header = screen.getByTestId('itinerary-view-header');
    expect(header).toHaveTextContent(/부산 여행 · 3박 4일/);
    expect(header).toHaveTextContent(/총 5곳/);

    // 날짜탭 2개가 순서대로. 여행 기간만큼 뜬다(01b AC1).
    expect(screen.queryAllByTestId(/^itinerary-timeline-day-/)).toHaveLength(2);
    expect(screen.getByTestId('itinerary-timeline-day-1')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-timeline-day-2')).toBeOnTheScreen();
  });

  it('날짜탭을 누르면 그 인덱스로 onSelectDay 가 불린다', () => {
    renderScreen();

    fireEvent.press(screen.getByTestId('itinerary-timeline-day-2'));
    expect(onSelectDay).toHaveBeenCalledTimes(1);
    expect(onSelectDay).toHaveBeenCalledWith(1); // dayIndex 2 = 배열 인덱스 1
  });
});

describe('🔴 C3 · AC2 — 완성이라 isFixed 무관하게 항상 검증 시각을 보인다 (BR-U3-07 · 이 칸의 핵심)', () => {
  it('비고정 슬롯도 09:30 을 보인다 — h11 초안(고정만 시각)과 정반대다', () => {
    renderScreen();

    // ★ 킬러 — 비고정 poi-a 의 시각 줄에 검증 시각이 **있다**. h11 을 복붙하면 이 줄이 사라져
    //   여기서 즉사한다(02a ★1). 시각은 startAt.slice(0,5) 다.
    expect(screen.getByTestId(subId('time', DAY1, 'poi-a'))).toHaveTextContent(
      '09:30'
    );
    // 짝 — 고정 poi-b 도 시각을 보인다(둘 다 시각 · "고정만 시각"이라는 반쪽 구현을 죽인다).
    expect(screen.getByTestId(subId('time', DAY1, 'poi-b'))).toHaveTextContent(
      '21:00'
    );
  });

  it('네 카드의 번호가 1..4 이고, 시간대 라벨이 timeBandLabel(startAt) 과 같다', () => {
    renderScreen();

    // 번호는 배열 인덱스+1 — orderIndex 는 REST 계약에 없다(01b AC2 ⚠️: 번호는 표시 규약).
    DAY1_SLOTS.forEach((entry, index) => {
      expect(
        screen.getByTestId(subId('no', DAY1, entry.poiId))
      ).toHaveTextContent(String(index + 1));
    });

    // 기대값을 **실제 함수를 불러** 만든다 — 라벨 규칙을 화면이 재구현하면 여기서 갈린다.
    // 완전 일치라 Figma 의 성격 축(`· 활동`)이 붙으면 자동 red(01b Q1: 시간대 축만).
    DAY1_SLOTS.forEach((entry) => {
      expect(
        screen.getByTestId(subId('band', DAY1, entry.poiId))
      ).toHaveTextContent(timeBandLabel(entry.startAt));
    });
    // 짝 — 네 값이 실제로 서로 같지 않다(한 라벨을 전부에 박는 구현을 죽인다).
    expect(DAY1_SLOTS.map((e) => timeBandLabel(e.startAt))).toEqual([
      '오전',
      '저녁',
      '점심',
      '저녁',
    ]);
  });
});

describe('C4 · AC3 — 고정 배지는 isFixed 슬롯에만 붙는다', () => {
  it('고정 카드에 고정 pill 이 있고 비고정 카드에는 없다', () => {
    renderScreen();

    // 긍정 — 고정 poi-b 에 고정 표식이 있다.
    expect(screen.getByTestId(subId('fixed', DAY1, 'poi-b'))).toBeOnTheScreen();

    // 부정 짝 — 나머지 셋에는 고정 표식이 0개다.
    ['poi-a', 'poi-c', 'poi-d'].forEach((poiId) => {
      expect(screen.queryAllByTestId(subId('fixed', DAY1, poiId))).toEqual([]);
    });
  });
});

describe('C5 · AC4 — 위반 배지는 저장 여부와 무관하게 지속 가시화된다 (BR-U3-13)', () => {
  it('위반 슬롯에 위반 배지와 사유가 뜨고, 정상 슬롯에는 없다', () => {
    renderScreen();

    // 긍정 — 위반 poi-c 에 배지가 있고 사유 문자열이 보인다(부분 포함).
    const badge = screen.getByTestId(violationId(DAY1, 'poi-c'));
    expect(badge).toBeOnTheScreen();
    expect(badge).toHaveTextContent(/영업 종료 후 도착/);

    // 부정 짝 — 정상 poi-a 에는 위반 배지가 0개다.
    expect(screen.queryAllByTestId(violationId(DAY1, 'poi-a'))).toEqual([]);
  });
});

describe('🔴 C6 · AC5 — 자정 넘김은 익일임이 구분되게 표기하고 endAt<startAt 을 오류로 보지 않는다 (HC4)', () => {
  it('endsNextDay 카드에 익일 표식과 종료 06:00 이 뜨고, 시작 22:30 은 그대로다', () => {
    // ★ poi-d 는 startAt 22:30 > endAt 06:00 이다 — HC4 에서 **정상**. 화면이 시각을 Date 로
    //   비교·정렬하면 렌더가 뒤집히거나 죽는다(brief 맹점 3). 문자열만 다뤄야 한다.
    renderScreen();

    // ① 화면이 예외 없이 렌더됐다(자정 넘김 슬롯이 있어도 죽지 않는다).
    expect(screen.getByTestId('itinerary-view-timeline')).toBeOnTheScreen();

    // ② 익일 표식이 있고, 종료 시각(06:00)이 보인다.
    const card = screen.getByTestId(cardId(DAY1, 'poi-d'));
    expect(
      screen.getByTestId(subId('endsnext', DAY1, 'poi-d'))
    ).toBeOnTheScreen();
    expect(card).toHaveTextContent(/06:00/);

    // ③ 시작 시각도 그대로 — 뒤집히지 않았다(시각을 뒤집는 구현을 죽인다).
    expect(card).toHaveTextContent(/22:30/);

    // 부정 짝 — 자정 안 넘긴 poi-a 에는 익일 표식이 0개다.
    expect(screen.queryAllByTestId(subId('endsnext', DAY1, 'poi-a'))).toEqual(
      []
    );
  });
});

describe('🔴 C7 · AC8 — 골격만: 서버가 표면을 줘도 왼쪽 절반을 그리지 않는다 (01b Q2)', () => {
  it('표면이 전부 채워진 슬롯도 장소명·사진·영업시간·category·거리·태그를 안 그린다', () => {
    // poi-a 는 nameKo·imageUrl·tags·category·openingHours·distanceRange 가 전부 채워져 있다.
    renderScreen();

    // 긍정 짝 — 골격(번호·시각·라벨)은 있다. 없으면 아래 부정 단언이 공허하다.
    expect(screen.getByTestId(subId('no', DAY1, 'poi-a'))).toBeOnTheScreen();
    expect(screen.getByTestId(subId('time', DAY1, 'poi-a'))).toBeOnTheScreen();
    expect(screen.getByTestId(subId('band', DAY1, 'poi-a'))).toBeOnTheScreen();

    // ★ 부정 — 채워진 표면 값이 **하나도 렌더되지 않는다**. "null이면 비운다"가 아니라
    //   "채워져도 안 그린다"가 골격만의 뜻이다(h11 복붙은 여기서 죽는다 · 02a ★2).
    const card = screen.getByTestId(cardId(DAY1, 'poi-a'));
    expect(card).not.toHaveTextContent(/해운대 블루라인/); // 장소명
    expect(card).not.toHaveTextContent(/해변/); // category
    expect(card).not.toHaveTextContent(/약 1\.2km/); // 거리
    expect(card).not.toHaveTextContent(/바다/); // 태그
    expect(card).not.toHaveTextContent(/영업중/); // 영업시간

    // 사진·장소명 요소 자체가 없다(기본 이미지·더미 텍스트 지어내기 금지).
    expect(screen.queryAllByTestId(subId('image', DAY1, 'poi-a'))).toEqual([]);
    expect(screen.queryAllByTestId(subId('name', DAY1, 'poi-a'))).toEqual([]);
  });
});

describe('C8 · AC7 — 소요시간 문자열이 렌더 결과에 한 개도 없다 (INV-3)', () => {
  it('시각·시간대·헤더는 보이는데 분·시간·소요 표기는 0건이다', () => {
    renderScreen();

    // 긍정 앵커 — 없으면 아무것도 안 그리는 화면이 아래 부정 단언을 공짜로 통과한다.
    const texts = renderedTexts();
    expect(texts.some((t) => t.includes('09:30'))).toBe(true);
    expect(texts.some((t) => t.includes('오전'))).toBe(true);

    // 부정 — **소스가 아니라 렌더 결과**를 훑는다(소스 스캔은 T5 가 stripComments 로 따로 잠근다).
    expect(texts.filter((t) => DURATION_TEXT.test(t))).toEqual([]);

    // 짝(자가검사) — 탐지기가 진짜 소요시간은 잡는다(이 심판이 우회 불가임을 증명).
    expect(DURATION_TEXT.test('이동 30분')).toBe(true);
  });
});

describe('🔴 C9 · AC6 — 세그먼트 전환은 UI 상태(prop/콜백)로만 일어난다 (US-SCHED-06 화면부)', () => {
  it('timeline 이면 시간표가, map 이면 지도 placeholder 가 뜨고 서로를 가린다', () => {
    const { rerender } = renderScreen({ segment: 'timeline' });

    // timeline — 시간표 콘텐츠가 있고 지도 placeholder 는 없다.
    expect(screen.getByTestId('itinerary-view-timeline')).toBeOnTheScreen();
    expect(screen.queryAllByTestId('itinerary-view-map')).toEqual([]);
    expect(cardTestIds().length).toBeGreaterThan(0);

    // map 으로 전환 — 지도 placeholder 가 뜨고 시간표는 사라진다.
    rerender(
      <TimelineScreen
        header={HEADER}
        days={DAYS}
        slots={DAY1_SLOTS}
        activeDayIndex={0}
        segment="map"
        onSelectDay={onSelectDay}
        onSegmentChange={onSegmentChange}
        onBack={onBack}
      />
    );
    expect(screen.getByTestId('itinerary-view-map')).toBeOnTheScreen();
    expect(screen.queryAllByTestId('itinerary-view-timeline')).toEqual([]);
  });

  it('토글 버튼을 누르면 다른 값으로 onSegmentChange 가 불린다 (재조회를 유발할 자리가 없다)', () => {
    const { rerender } = renderScreen({ segment: 'timeline' });

    // timeline 상태에서 지도 토글 → 'map'.
    fireEvent.press(screen.getByTestId('itinerary-view-segment-map'));
    expect(onSegmentChange).toHaveBeenCalledTimes(1);
    expect(onSegmentChange).toHaveBeenCalledWith('map');

    // map 상태에서 시간표 토글 → 'timeline'.
    onSegmentChange.mockClear();
    rerender(
      <TimelineScreen
        header={HEADER}
        days={DAYS}
        slots={DAY1_SLOTS}
        activeDayIndex={0}
        segment="map"
        onSelectDay={onSelectDay}
        onSegmentChange={onSegmentChange}
        onBack={onBack}
      />
    );
    fireEvent.press(screen.getByTestId('itinerary-view-segment-timeline'));
    expect(onSegmentChange).toHaveBeenCalledTimes(1);
    expect(onSegmentChange).toHaveBeenCalledWith('timeline');
  });
});

describe('🔴 C10 · AC1 — 커스텀 앱바 뒤로 + PLANNED 확정 CTA 는 활성이다 (US-SCHED-12)', () => {
  it('뒤로가 onBack 을 부르고, 확정 CTA 는 활성·brand색이며 누르면 onConfirm 이 불린다', () => {
    renderScreen({ status: 'PLANNED' });

    // Q3 — 커스텀 앱바 뒤로.
    fireEvent.press(screen.getByTestId('itinerary-view-back'));
    expect(onBack).toHaveBeenCalledTimes(1);

    // ★ 개명(02a ★4) — 스텁 `itinerary-view-confirm`(disabled) 을 `itinerary-confirm-cta` 로
    //   개명·**활성화**한다(티켓 §9). TRIP-299 의 disabled 단언은 이 칸에서 폐기된다.
    const cta = screen.getByTestId('itinerary-confirm-cta');
    expect(cta).toBeEnabled();

    // 누르면 곧장 확정 요청으로 이어진다(중간 다이얼로그 없음 · Seed 흐름 02a ★9).
    fireEvent.press(cta);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // 짝(★1 헬퍼 자가검증) — 활성 CTA 는 brand 색을 **실제로** 가진다. 이게 없으면 아래 확정
    //   얼굴의 `brandTokensIn([])` 부정 단언이 "헬퍼가 아무 색도 못 본다"로 공허해진다.
    expect(brandTokensIn(cta)).not.toEqual([]);
  });
});

describe('🔴 C11 · AC3 — appbar 제목이 status 로 갈린다 (라이브 h34)', () => {
  it('CONFIRMED 는 "확정 일정", PLANNED 는 "완성 일정" 이다', () => {
    const confirmed = renderScreen({
      status: 'CONFIRMED',
      confirmedSubtitle: '6월 10일 – 13일',
    });
    // 완전 일치가 아니라 존재로 — 앱바 텍스트 노드만 정확히 집기 어려워 화면 전체에서 찾는다.
    expect(screen.getByText('확정 일정')).toBeOnTheScreen();
    // 짝 — PLANNED 제목은 안 뜬다(둘이 동시에 뜨는 구현을 죽인다).
    expect(screen.queryByText('완성 일정')).toBeNull();

    confirmed.unmount(); // 두 트리가 겹쳐 잡히지 않게 먼저 걷는다(리포 선례 `first.unmount()`).
    renderScreen({ status: 'PLANNED' });
    expect(screen.getByText('완성 일정')).toBeOnTheScreen();
    expect(screen.queryByText('확정 일정')).toBeNull();
  });
});

describe('🔴 C12 · AC2 — 확정 배너 (BR-U3-30 · 라이브 h34)', () => {
  it('CONFIRMED 면 고정 제목과 내려준 부제를 그리고, PLANNED 면 배너가 없다', () => {
    const confirmed = renderScreen({
      status: 'CONFIRMED',
      confirmedSubtitle: '6월 10일 – 13일 · 부산 여행 · 9곳',
    });

    // 배너 = 고정 제목(뷰 상수) + 부제(페이지가 조립해 내려준 prop 그대로). 부분 포함(정규식).
    const banner = screen.getByTestId('itinerary-confirmed-banner');
    expect(banner).toHaveTextContent(/일정이 확정됐어요/);
    expect(banner).toHaveTextContent(/6월 10일 – 13일 · 부산 여행 · 9곳/);

    // 짝(부재) — PLANNED 에는 배너가 0개다(★8 · queryBy 로 부재를 잰다).
    confirmed.unmount();
    renderScreen({ status: 'PLANNED' });
    expect(screen.queryByTestId('itinerary-confirmed-banner')).toBeNull();
  });
});

describe('🔴 C13 · AC4·AC7 — 읽기전용: 확정 CTA 부재 + 하단 비활성 2버튼 (INV-U3-04 · D1·D2)', () => {
  it('CONFIRMED 는 확정 CTA 가 없고, [일정 수정]/[공유하기]가 비활성·무동작·사유 표시다', () => {
    renderScreen({
      status: 'CONFIRMED',
      confirmedSubtitle: '6월 10일 – 13일 · 부산 여행 · 9곳',
    });

    // 읽기전용 — 확정 CTA 는 0개다(★7·★8: 부정엔 긍정 짝이 있어야 공허하지 않다).
    expect(screen.queryAllByTestId('itinerary-confirm-cta')).toEqual([]);

    // 긍정 짝 — 하단 2버튼이 실재한다.
    const edit = screen.getByTestId('itinerary-confirmed-edit');
    const share = screen.getByTestId('itinerary-confirmed-share');

    // [일정 수정] — 비활성 + 사유(D1). 실제 역전이는 후속 티켓이라 여기선 비활성+사유가 끝.
    expect(edit).toBeDisabled();
    expect(edit).toHaveTextContent(/확정된 일정은 아직 수정할 수 없어요/);
    expect(() => fireEvent.press(edit)).not.toThrow();

    // [공유하기] — 비활성 + 사유(D2) + ★1 **brand색 부재**. Figma 는 이 버튼을 분홍 primary 로
    //   그리므로, 색을 그대로 두고 disabled 만 걸면 "눌릴 것 같은데 안 눌리는" 함정이 된다 —
    //   `toBeDisabled()`·press-무해를 다 통과하고도. brandTokensIn([]) 이 그걸 즉사시킨다.
    expect(share).toBeDisabled();
    expect(share).toHaveTextContent(/공유는 곧 제공돼요/);
    expect(() => fireEvent.press(share)).not.toThrow();
    expect(brandTokensIn(share)).toEqual([]);
  });
});

describe('🔴 C14 · AC5·AC8 — 확정 실패 인라인 안내(INV-4) + 확정얼굴 소요시간 0(INV-3)', () => {
  it('confirmError 가 있으면 타임라인 위에 안내를 그리고 화면을 벗어나지 않는다', () => {
    // 확정 실패는 **같은 화면**의 인라인 안내다(이탈 아님). 타임라인·CTA 가 유지돼야 재시도가 된다.
    const failed = renderScreen({
      status: 'PLANNED',
      confirmError: '이미 확정된 일정이에요',
    });

    // 침묵 아님(INV-4) — 안내가 비어 있지 않다.
    const err = screen.getByTestId('itinerary-confirm-error');
    expect(err).toHaveTextContent(/\S/);
    // 이탈 아님 — 타임라인·확정 CTA 가 그대로라 다시 누를 수 있다(편집 얼굴 유지).
    expect(screen.getByTestId('itinerary-view-timeline')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-confirm-cta')).toBeOnTheScreen();

    // 짝(부재) — 실패가 없으면 안내도 없다.
    failed.unmount();
    renderScreen({ status: 'PLANNED' });
    expect(screen.queryByTestId('itinerary-confirm-error')).toBeNull();
  });

  it('확정 얼굴 렌더 텍스트에 소요시간 표기가 0건이다 (INV-3 렌더 스캔)', () => {
    renderScreen({
      status: 'CONFIRMED',
      confirmedSubtitle: '6월 10일 – 13일 · 부산 여행 · 9곳',
    });

    // 긍정 앵커 — 배너가 실제로 그려졌다(없으면 아래 "0건"이 빈 화면에서 공짜 통과).
    const texts = renderedTexts();
    expect(texts.some((t) => t.includes('일정이 확정됐어요'))).toBe(true);

    // 부정 — 확정 얼굴 렌더 문자열에 분·시간·소요 표기가 없다(날짜 `13일` 은 안 걸린다 · 02a §5-B).
    expect(texts.filter((t) => DURATION_TEXT.test(t))).toEqual([]);

    // 짝(자가검사) — 탐지기가 진짜 소요시간은 잡는다(이 심판이 우회 불가임을 증명).
    expect(DURATION_TEXT.test('이동 30분')).toBe(true);
  });
});
