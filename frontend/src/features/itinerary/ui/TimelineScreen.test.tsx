import type { ReactTestInstance } from 'react-test-renderer';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type {
  ItineraryDaysItemSlotsItem,
  ItineraryStatus,
} from '@/shared/api/generated/schemas';

import type { PlanDayTab } from '../model/planState';
import { buildSlotKey } from '../model/slotKey';
import { timeBandLabel } from '../model/timeBandLabel';
import tailwindConfig from '../../../../tailwind.config.js';
import { type ItineraryHeaderData, TimelineScreen } from './TimelineScreen';

/**
 * h25/h34 완성·확정 일정 화면의 **프레임 + 카드 배지 계약**. 화면은 완성된 값만 받는다 — 조회도
 * 판정도 하지 않는다. **재작성 사이클(TRIP-354)**: 시간표/지도 세그먼트 토글이 사라지고(결정 D),
 * 지도가 상시 인라인으로 깔린다. 카드는 이 칸에서 풀카드로 자라지만, **표면·구간행·휴관칩·이동합계는
 * `TimelineScreen.card.test.tsx` 가 맡고** 여기서는 배지·시각·INV-3·확정얼굴 프레임을 지킨다.
 *
 * 무엇을 보장하나 — 계승된 두 핵심:
 *  - 🔴 **비고정 슬롯도 검증 시각을 보인다**(C3). h11 초안은 `isFixed:false` 카드에 시각을 **감췄지만**,
 *    완성이라 `isFixed` 무관하게 항상 그린다(BR-U3-07 · 02a ★5).
 *  - 🔴 **"24시간 개방" 함정**(C8): 영업시간 서버값이 시계 문자열을 담아도(24시간 개방) INV-3 렌더
 *    스캔이 오탐하지 않는다 — `-hours-` leaf 를 스캔에서 빼되, 그 밖의 보이는 소요시간은 잡는다(★3·★4).
 *  - 고정 pill(C5)·위반 배지(C6, 저장무관)·자정 넘김(C7)·시간대 라벨(C4)이 각각 뜬다.
 *
 * `status` 축은 같은 화면의 두 얼굴이다:
 *  - 🔴 **PLANNED**: 하단에 **활성** 확정 CTA + appbar 공유 아이콘 **부재**(C9·C14).
 *  - 🔴 **CONFIRMED**: 확정 배너 + appbar `확정 일정` + **공유 아이콘** + 하단 [일정 수정]/[공유하기]
 *    **비활성** 2버튼, 확정 CTA 부재(C10~C14).
 *
 * *(개념)* **testID** — 화면 요소에 붙이는 테스트 전용 이름표. 사용자에겐 안 보이고, 테스트가 그
 * 요소를 정확히 집어 오는 손잡이다. **얇은 가짜 지도**(`@/shared/map` 목) — 상시 인라인 지도가
 * 이제 이 화면에도 뜨므로 관찰 마커(`map-root`)로 바꿔 렌더 노이즈를 없앤다.
 *
 * 3동작 뼈대: 준비=`header`·`days`·`slots` 를 만들어 렌더 → 실행=탭한다 → 단언=보이는 것·불린 콜백.
 */
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

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

/** 1번 — **비고정 + 표면 전부 채움**. 시간대 오전. C3(비고정도 시각) + C8(영업시간 '24시간 개방'
 * 이 렌더돼도 INV-3 렌더 스캔이 오탐 안 함). */
const SLOT_A = slot({
  poiId: 'poi-a',
  startAt: '09:30:00',
  endAt: '11:00:00',
  nameKo: '해운대 블루라인',
  imageUrl: 'https://img.example.com/a.jpg',
  tags: ['바다'],
  category: '해변',
  openingHours: '24시간 개방', // ★ 렌더 스캔 함정(24시간)을 실제로 태운다(02a ★4)
  distanceRange: '약 1.2km · 도보 추정',
});
/** 2번 — **고정 블록**. 시간대 저녁. C5(고정 pill) + C3(고정도 시각). */
const SLOT_B = slot({
  poiId: 'poi-b',
  startAt: '21:00:00',
  endAt: '22:00:00',
  isFixed: true,
  nameKo: '부산 신라스테이',
});
/** 3번 — **위반**. 시간대 점심. C6(위반 배지 + 사유, 저장무관). */
const SLOT_C = slot({
  poiId: 'poi-c',
  startAt: '13:00:00',
  endAt: '14:00:00',
  hasViolation: true,
  violationReason: '영업 종료 후 도착',
});
/** 4번 — **자정 넘김**. `endAt < startAt` 이 정상이다(HC4). 시간대 저녁. C7. */
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
 * 카드 루트만 세는 셀렉터. 카드 testID `itinerary-timeline-slot-{slotKey}` 와 하위 요소들이
 * **같은 접두를 공유한다** — 제외하지 않으면 카드가 훨씬 많게 잡힌다(02a §5-B).
 *
 * ⚠️ **재작성으로 하위 6접두가 늘었다**(풀카드): `image/name/hours/tag/warnchip/nomap`. 이 목록에
 * 새 접두를 안 넣으면 풀카드가 자라는 순간 개수·순서 단언이 조용히 어긋난다(02a ★2). 위반 배지는
 * 다른 접두(`itinerary-edit-`), 구간행은 `itinerary-timeline-connector-` 라 안 섞인다.
 */
const CARD_SUB_PREFIXES = [
  'no-',
  'time-',
  'band-',
  'fixed-',
  'endsnext-',
  'image-',
  'name-',
  'hours-',
  'tag-',
  'warnchip-',
  'nomap-',
];

function cardTestIds(): string[] {
  return screen
    .queryAllByTestId(/^itinerary-timeline-slot-/)
    .map((node) => String(node.props.testID))
    .filter((testID) => {
      const tail = testID.slice('itinerary-timeline-slot-'.length);
      return !CARD_SUB_PREFIXES.some((prefix) => tail.startsWith(prefix));
    });
}

/**
 * 렌더된 텍스트 전부(INV-3 렌더 스캔 모집단) — 단, **`-hours-` leaf 는 뺀다.** 영업시간은 시계
 * 문자열("24시간 개방"·"09:00–18:00")을 정당하게 담아 소요시간 탐지기에 오탐된다 — 그건 소요시간이
 * 아니다(02a ★3). 제외 뒤에도 그 밖의 **보이는** 소요시간(예: 잘못 박힌 "이동 30분")은 잡히고,
 * prop 문자열(`accessibilityLabel="이동 30분"`)은 소스가드 G2 가 잡아 두 축이 유지된다(02a ★5).
 */
function renderedTexts(): string[] {
  const out: string[] = [];
  screen.root
    .findAll(() => true)
    .forEach((node) => {
      const testID = String(node.props?.testID ?? '');
      if (/-hours-/.test(testID)) return; // 영업시간 leaf 제외
      const children = node.props?.children as unknown;
      const list = Array.isArray(children) ? children : [children];
      list.forEach((child) => {
        if (typeof child === 'string') out.push(child);
      });
    });
  return out;
}

/** 소요시간 표기 탐지기(G2·직전 C7 과 같은 것). 시각(`09:30`)·날짜(`13일`)·거리(`4.1km`)는 걸리지
 * 않는다(`분/시간/소요` 앞에 숫자가 붙어야 한다). */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/**
 * *(개념)* **className** — NativeWind 가 쓰는 스타일 이름표. 이 환경에서 렌더된 요소의 props 에
 * 문자열 그대로 남아 jest 가 **색을 볼 수 있는 유일한 통로**다(`toHaveStyle` 은 style 이 undefined 라
 * 못 쓴다). 브랜드 주색 계열을 `tailwind.config.js`(= Figma 변수 미러)에서 파생한다.
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

const BRAND_TOKEN = new RegExp(`^[a-z]+-(?:${BRAND_COLORS.join('|')})$`);

/** className 조각 중 브랜드 주색 계열 전부. 비활성 버튼엔 `toEqual([])`, 활성 CTA엔 `.not.toEqual([])`. */
function brandTokensIn(node: ReactTestInstance): string[] {
  return String(node.props.className ?? '')
    .split(/\s+/)
    .filter((token) => BRAND_TOKEN.test(token));
}

const onSelectDay = jest.fn();
const onBack = jest.fn();
const onConfirm = jest.fn();

type Overrides = {
  header?: ItineraryHeaderData;
  days?: PlanDayTab[];
  slots?: ItineraryDaysItemSlotsItem[];
  activeDayIndex?: number;
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
      status="PLANNED"
      onSelectDay={onSelectDay}
      onBack={onBack}
      onConfirm={onConfirm}
      {...over}
    />
  );
}

beforeEach(() => {
  onSelectDay.mockClear();
  onBack.mockClear();
  onConfirm.mockClear();
});

describe('C1 · 탐지기 자가검사 — 이게 통과해야 아래 개수·순서 단언이 의미를 갖는다', () => {
  it('카드 세는 셀렉터가 하위 요소(번호·시각·라벨·고정·익일 + 신규 6접두)를 삼키지 않는다', () => {
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

    const header = screen.getByTestId('itinerary-view-header');
    expect(header).toHaveTextContent(/부산 여행 · 3박 4일/);
    expect(header).toHaveTextContent(/총 5곳/);

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

describe('🔴 C3 · AC2 — 완성이라 isFixed 무관하게 항상 검증 시각을 보인다 (BR-U3-07)', () => {
  it('비고정 슬롯도 09:30 을 보인다 — h11 초안(고정만 시각)과 정반대다', () => {
    renderScreen();

    // ★ 킬러 — 비고정 poi-a 의 시각 줄에 검증 시각이 **있다**(02a ★5). 시각은 startAt.slice(0,5).
    expect(screen.getByTestId(subId('time', DAY1, 'poi-a'))).toHaveTextContent(
      '09:30'
    );
    // 짝 — 고정 poi-b 도 시각을 보인다("고정만 시각"이라는 반쪽 구현을 죽인다).
    expect(screen.getByTestId(subId('time', DAY1, 'poi-b'))).toHaveTextContent(
      '21:00'
    );
  });

  it('네 카드의 번호가 1..4 이고, 시간대 라벨이 timeBandLabel(startAt) 과 같다', () => {
    renderScreen();

    DAY1_SLOTS.forEach((entry, index) => {
      expect(
        screen.getByTestId(subId('no', DAY1, entry.poiId))
      ).toHaveTextContent(String(index + 1));
    });

    // 기대값을 **실제 함수를 불러** 만든다 — 완전 일치라 Figma 성격 축(`· 활동`)이 붙으면 자동 red
    // (01b Q1: 시간대 축만).
    DAY1_SLOTS.forEach((entry) => {
      expect(
        screen.getByTestId(subId('band', DAY1, entry.poiId))
      ).toHaveTextContent(timeBandLabel(entry.startAt));
    });
    // 짝 — 네 값이 서로 다르다(한 라벨을 전부에 박는 구현을 죽인다).
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

    expect(screen.getByTestId(subId('fixed', DAY1, 'poi-b'))).toBeOnTheScreen();

    ['poi-a', 'poi-c', 'poi-d'].forEach((poiId) => {
      expect(screen.queryAllByTestId(subId('fixed', DAY1, poiId))).toEqual([]);
    });
  });
});

describe('C5 · AC3 — 위반 배지는 저장 여부와 무관하게 지속 가시화된다 (BR-U3-13)', () => {
  it('위반 슬롯에 위반 배지와 사유가 뜨고, 정상 슬롯에는 없다', () => {
    renderScreen();

    const badge = screen.getByTestId(violationId(DAY1, 'poi-c'));
    expect(badge).toBeOnTheScreen();
    expect(badge).toHaveTextContent(/영업 종료 후 도착/);

    expect(screen.queryAllByTestId(violationId(DAY1, 'poi-a'))).toEqual([]);
  });
});

describe('🔴 C7 · AC4 — 자정 넘김은 익일임이 구분되게 표기하고 endAt<startAt 을 오류로 보지 않는다 (HC4)', () => {
  it('endsNextDay 카드에 익일 표식과 종료 06:00 이 뜨고, 시작 22:30 은 그대로다', () => {
    // ★ poi-d 는 startAt 22:30 > endAt 06:00 — HC4 에서 **정상**. Date 비교·정렬하면 렌더가
    //   뒤집히거나 죽는다(02a ★5). 문자열만 다뤄야 한다.
    renderScreen();

    expect(screen.getByTestId('itinerary-view-timeline')).toBeOnTheScreen();

    const card = screen.getByTestId(cardId(DAY1, 'poi-d'));
    expect(
      screen.getByTestId(subId('endsnext', DAY1, 'poi-d'))
    ).toBeOnTheScreen();
    expect(card).toHaveTextContent(/06:00/);
    expect(card).toHaveTextContent(/22:30/);

    expect(screen.queryAllByTestId(subId('endsnext', DAY1, 'poi-a'))).toEqual(
      []
    );
  });
});

describe('🔴 C8 · AC9 — "24시간 개방" 함정: 영업시간이 시계 문자열이어도 INV-3 렌더 스캔이 오탐하지 않는다', () => {
  it('영업시간 leaf 는 "24시간 개방" 을 그리는데, 소요시간 표기는 렌더 결과에 0건이다 (INV-3)', () => {
    // poi-a.openingHours = '24시간 개방'. 골격 카드엔 hours leaf 가 없어 아래 첫 단언이 red 다.
    renderScreen();

    // ★ 골격 킬러 — 영업시간 leaf 가 실제로 '24시간 개방' 을 담는다(풀카드 미완이면 여기서 죽는다).
    expect(screen.getByTestId(subId('hours', DAY1, 'poi-a'))).toHaveTextContent(
      '24시간 개방'
    );

    // 긍정 앵커 — 시각·시간대는 보인다(없으면 아래 "0건"이 빈 화면에서 공짜 통과).
    const texts = renderedTexts();
    expect(texts.some((t) => t.includes('09:30'))).toBe(true);
    expect(texts.some((t) => t.includes('오전'))).toBe(true);

    // ★ 부정 — `-hours-` leaf 를 뺀 렌더 결과에 분·시간·소요 표기가 0건이다. '24시간 개방' 은
    //   hours leaf 라 제외돼 오탐하지 않는다(02a ★3·★4).
    expect(texts.filter((t) => DURATION_TEXT.test(t))).toEqual([]);

    // 짝(자가검사) — 탐지기가 진짜 소요시간은 잡고, '24시간 개방' 은 그대로 두면 잡힌다(제외의 필요성).
    expect(DURATION_TEXT.test('이동 30분')).toBe(true);
    expect(DURATION_TEXT.test('24시간 개방')).toBe(true);
  });
});

describe('🔴 C9 · AC1 — 커스텀 앱바 뒤로 + PLANNED 확정 CTA 는 활성이다 (US-SCHED-12)', () => {
  it('뒤로가 onBack 을 부르고, 확정 CTA 는 활성·brand색이며 누르면 onConfirm 이 불린다', () => {
    renderScreen({ status: 'PLANNED' });

    fireEvent.press(screen.getByTestId('itinerary-view-back'));
    expect(onBack).toHaveBeenCalledTimes(1);

    const cta = screen.getByTestId('itinerary-confirm-cta');
    expect(cta).toBeEnabled();

    fireEvent.press(cta);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // 짝(★1 헬퍼 자가검증) — 활성 CTA 는 brand 색을 **실제로** 가진다(아래 확정얼굴의 부재 단언이
    //   "헬퍼가 아무 색도 못 본다"로 공허해지는 것을 막는다).
    expect(brandTokensIn(cta)).not.toEqual([]);
  });
});

describe('🔴 C10 · AC3 — appbar 제목이 status 로 갈린다 (라이브 h34)', () => {
  it('CONFIRMED 는 "확정 일정", PLANNED 는 "완성 일정" 이다', () => {
    const confirmed = renderScreen({
      status: 'CONFIRMED',
      confirmedSubtitle: '6월 10일 – 13일',
    });
    expect(screen.getByText('확정 일정')).toBeOnTheScreen();
    expect(screen.queryByText('완성 일정')).toBeNull();

    confirmed.unmount();
    renderScreen({ status: 'PLANNED' });
    expect(screen.getByText('완성 일정')).toBeOnTheScreen();
    expect(screen.queryByText('확정 일정')).toBeNull();
  });
});

describe('🔴 C11 · AC2 — 확정 배너 (BR-U3-30 · 라이브 h34)', () => {
  it('CONFIRMED 면 고정 제목과 내려준 부제를 그리고, PLANNED 면 배너가 없다', () => {
    const confirmed = renderScreen({
      status: 'CONFIRMED',
      confirmedSubtitle: '6월 10일 – 13일 · 부산 여행 · 9곳',
    });

    const banner = screen.getByTestId('itinerary-confirmed-banner');
    expect(banner).toHaveTextContent(/일정이 확정됐어요/);
    expect(banner).toHaveTextContent(/6월 10일 – 13일 · 부산 여행 · 9곳/);

    confirmed.unmount();
    renderScreen({ status: 'PLANNED' });
    expect(screen.queryByTestId('itinerary-confirmed-banner')).toBeNull();
  });
});

describe('🔴 C12 · AC4·AC7 — 읽기전용: 확정 CTA 부재 + 하단 비활성 2버튼 (INV-U3-04 · D1·D2)', () => {
  it('CONFIRMED 는 확정 CTA 가 없고, [일정 수정]/[공유하기]가 비활성·무동작·사유 표시다', () => {
    renderScreen({
      status: 'CONFIRMED',
      confirmedSubtitle: '6월 10일 – 13일 · 부산 여행 · 9곳',
    });

    expect(screen.queryAllByTestId('itinerary-confirm-cta')).toEqual([]);

    const edit = screen.getByTestId('itinerary-confirmed-edit');
    const share = screen.getByTestId('itinerary-confirmed-share');

    expect(edit).toBeDisabled();
    expect(edit).toHaveTextContent(/확정된 일정은 아직 수정할 수 없어요/);
    expect(() => fireEvent.press(edit)).not.toThrow();

    // [공유하기] — 비활성 + 사유 + ★1 **brand색 부재**. Figma 는 이 버튼을 분홍 primary 로 그리므로,
    //   색을 그대로 두고 disabled 만 걸면 "눌릴 것 같은데 안 눌리는" 함정이 된다. brandTokensIn([]) 이
    //   그걸 즉사시킨다.
    expect(share).toBeDisabled();
    expect(share).toHaveTextContent(/공유는 곧 제공돼요/);
    expect(() => fireEvent.press(share)).not.toThrow();
    expect(brandTokensIn(share)).toEqual([]);
  });
});

describe('🔴 C13 · AC5·AC9 — 확정 실패 인라인 안내(INV-4) + 확정얼굴 소요시간 0(INV-3)', () => {
  it('confirmError 가 있으면 타임라인 위에 안내를 그리고 화면을 벗어나지 않는다', () => {
    const failed = renderScreen({
      status: 'PLANNED',
      confirmError: '이미 확정된 일정이에요',
    });

    const err = screen.getByTestId('itinerary-confirm-error');
    expect(err).toHaveTextContent(/\S/);
    expect(screen.getByTestId('itinerary-view-timeline')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-confirm-cta')).toBeOnTheScreen();

    failed.unmount();
    renderScreen({ status: 'PLANNED' });
    expect(screen.queryByTestId('itinerary-confirm-error')).toBeNull();
  });

  it('확정 얼굴 렌더 텍스트에 소요시간 표기가 0건이다 (INV-3 렌더 스캔)', () => {
    renderScreen({
      status: 'CONFIRMED',
      confirmedSubtitle: '6월 10일 – 13일 · 부산 여행 · 9곳',
    });

    const texts = renderedTexts();
    expect(texts.some((t) => t.includes('일정이 확정됐어요'))).toBe(true);

    // 날짜 `13일`·`4일` 은 안 걸린다(`일` 이지 `분/시간/소요` 가 아니다 · 02a §5-D).
    expect(texts.filter((t) => DURATION_TEXT.test(t))).toEqual([]);
    expect(DURATION_TEXT.test('이동 30분')).toBe(true);
  });
});

describe('🔴 C14 · Q3 — appbar 공유 아이콘은 CONFIRMED 에서만 뜨고 정적(스텁)이다 (라이브 h34)', () => {
  it('CONFIRMED 는 공유 아이콘이 있고 눌러도 무해하며, PLANNED 에는 없다', () => {
    const confirmed = renderScreen({
      status: 'CONFIRMED',
      confirmedSubtitle: '6월 10일 – 13일 · 부산 여행 · 9곳',
    });

    // 긍정 — 공유 아이콘이 뜬다. 실동작은 후속(TRIP-300)이라 눌러도 예외가 없다(죽은 스텁 · 02a ★11).
    const share = screen.getByTestId('itinerary-view-share');
    expect(share).toBeOnTheScreen();
    expect(() => fireEvent.press(share)).not.toThrow();

    // 짝(부재) — PLANNED 에는 공유 아이콘이 없다(하단 [공유하기]와 같은 상태축).
    confirmed.unmount();
    renderScreen({ status: 'PLANNED' });
    expect(screen.queryByTestId('itinerary-view-share')).toBeNull();
  });
});
