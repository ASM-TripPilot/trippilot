import { Text } from 'react-native';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

import type { DraftDayTab, DraftPin, DraftView } from '../model/draftView';
import { buildSlotKey } from '../model/slotKey';
import { timeBandLabel } from '../model/timeBandLabel';
import { DraftScreen } from './DraftScreen';

/**
 * h11 초안 화면의 **렌더 계약**. 화면은 완성된 값만 받는다 — 조회도 판정도 하지 않는다.
 *
 * 무엇을 보장하나 — 이 칸의 존재 이유부터:
 *  - 🔴 **비고정 슬롯 카드 안에 시각이 한 개도 없다**(AC-1 · INV-U3-07). 응답에 `startAt` 이
 *    있어도 표시하지 않는다. 같은 화면의 **고정 블록에는 `21:00` 이 정당하게 보이므로**, 이
 *    부재 단언의 사정거리를 `isFixed:false` 카드 서브트리로 잘랐다 — 안 자르면 AC-1 과 AC-3 이
 *    서로를 부정해 **어떤 구현으로도 통과할 수 없는 심판**이 된다(02a ★1 · 01b D5).
 *  - 시간대 라벨이 `timeBandLabel(startAt)` 과 같고 성격 축(`· 활동`)이 붙지 않는다(AC-2 · D4).
 *  - 카드 번호는 1..n 연속이고 순서는 **응답 배열 그대로**다 — 클라가 정렬하지 않는다(AC-5).
 *  - 지도 핀은 좌표 없는 슬롯을 건너뛰되 **번호를 다시 매기지 않는다**(AC-13). 카드는 연속,
 *    핀은 ①③④ — 이 비대칭이 요점이다.
 *  - 서버가 안 준 것을 지어내지 않는다(AC-7 · TRIP-219).
 *
 * *(개념)* **testID** — 화면 요소에 붙이는 테스트 전용 이름표. 사용자에게는 안 보이고, 테스트가
 * "그 요소"를 정확히 집어 오는 손잡이다.
 *
 * 3동작 뼈대: 준비=`view`·`tabs`·`pins` 를 만들어 렌더 → 실행=누른다 → 단언=보이는 것·불린 콜백.
 */

// 지도를 관찰 마커로 바꾼다. 실물 `KakaoMapView` 는 JS 키가 없는 jest 환경에서 무조건
// `map-failure` 로 떨어져 `pins` 가 어디로도 흐르지 않는다(그 컴포넌트 머리말). 목은 남는 props 를
// 그대로 통과시키므로 `map-root` 의 props 에서 읽는다.
// ⚠️ 구현이 `@/shared/map/KakaoMapView` 로 딥 임포트하면 이 목이 안 붙는다 —
//    `itineraryDraftStructure.test.ts` G5 가 배럴 경유를 따로 잠근다(02a ★9).
// 인라인 팩토리로 두면 NativeWind babel 의 `_ReactNativeCSSInterop` 참조가 jest 호이스트 규칙을
// 위반한다 — 그래서 모듈 스코프 파일을 require 한다(리포 선례와 동형).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';
const DAY3 = '2026-06-12';

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

/** 1번 — 표면 필드가 전부 채워진 평범한 슬롯. 시간대는 **오전**. */
const SLOT_A = slot({
  poiId: 'poi-a',
  startAt: '09:30:00',
  endAt: '11:00:00',
  nameKo: '성산일출봉',
  imageUrl: 'https://img.example.com/a.jpg',
  tags: ['바다', '포토'],
  distanceRange: '약 1.2km · 도보 추정',
  lat: 33.458,
  lng: 126.942,
});
/** 2번 — 서버가 **아무것도 안 준** 슬롯(이름·사진·태그·좌표 전부 null). 시간대는 **점심**. */
const SLOT_B = slot({
  poiId: 'poi-b',
  startAt: '12:30:00',
  endAt: '13:30:00',
  nameKo: null,
  imageUrl: null,
  tags: [],
  lat: null,
  lng: null,
});
/** 3번 — 시간대 **오후**. */
const SLOT_C = slot({
  poiId: 'poi-c',
  startAt: '15:00:00',
  endAt: '16:30:00',
  nameKo: '카페 그레이',
  imageUrl: 'https://img.example.com/c.jpg',
  tags: ['카페'],
  lat: 33.489,
  lng: 126.498,
});
/** 4번 — **고정 블록**(숙소). 초안에서도 시각을 보이는 유일한 예외다(BR-U3-07). */
const SLOT_D = slot({
  poiId: 'poi-d',
  startAt: '21:00:00',
  endAt: '22:00:00',
  isFixed: true,
  nameKo: '제주 신라스테이',
  imageUrl: null,
  tags: [],
  lat: 33.487,
  lng: 126.499,
});

const DAY1_SLOTS = [SLOT_A, SLOT_B, SLOT_C, SLOT_D];

/** 2일차에 **같은 poiId** 를 다시 둔다 — 키의 조립 축이 (날짜, poiId) 둘임을 드러내기 위해서다. */
const SLOT_A_DAY2 = slot({
  poiId: 'poi-a',
  startAt: '10:00:00',
  endAt: '11:30:00',
  nameKo: '성산일출봉',
  lat: 33.458,
  lng: 126.942,
});

const DAYS: ItineraryDaysItem[] = [
  { date: DAY1, slots: DAY1_SLOTS },
  { date: DAY2, slots: [SLOT_A_DAY2] },
];

const TABS: DraftDayTab[] = [
  { date: DAY1, dayNumber: 1, hasData: true },
  { date: DAY2, dayNumber: 2, hasData: false },
  { date: DAY3, dayNumber: 3, hasData: false },
];

/** 1·3·4번 슬롯만 좌표가 있다 — 번호는 **카드 번호 그대로**(2번을 건너뛴다). */
const PINS_DAY1: DraftPin[] = [
  { number: 1, lat: 33.458, lng: 126.942 },
  { number: 3, lat: 33.489, lng: 126.498 },
  { number: 4, lat: 33.487, lng: 126.499 },
];
const PINS_DAY2: DraftPin[] = [{ number: 1, lat: 33.458, lng: 126.942 }];

function listed(
  days: ItineraryDaysItem[] = DAYS,
  staleFailed = false
): DraftView {
  return { kind: 'listed', days, staleFailed };
}

function cardId(date: string, poiId: string): string {
  return `itinerary-draft-slot-${buildSlotKey(date, poiId)}`;
}

function subId(role: string, date: string, poiId: string): string {
  return `itinerary-draft-slot-${role}-${buildSlotKey(date, poiId)}`;
}

/**
 * 카드 루트만 세는 셀렉터. 카드 testID 가 `itinerary-draft-slot-{slotKey}` 라 번호·라벨·배지·
 * 사진도 **같은 접두를 공유한다** — 제외하지 않으면 카드 4장이 실측 기준 열몇 장으로 잡힌다
 * (02a §5-B: 카드 2장짜리 표본에서 원본 7개 → 제외 후 2개). 이 제외기가 실제로 카드만 세는지는
 * 아래 C1 이 먼저 잠근다.
 *
 * ⚠️ `queryAllByTestId` 를 쓴다 — `getAllByTestId` 는 무매칭 시 **throw** 라 "0장"을 잴 수 없다.
 */
const CARD_SUB_PREFIXES = [
  'no-',
  'band-',
  'badge-',
  'fixed-',
  'image-',
  'tags-',
  'name-',
];

function cardTestIds(): string[] {
  return screen
    .queryAllByTestId(/^itinerary-draft-slot-/)
    .map((node) => String(node.props.testID))
    .filter((testID) => {
      const tail = testID.slice('itinerary-draft-slot-'.length);
      return !CARD_SUB_PREFIXES.some((prefix) => tail.startsWith(prefix));
    });
}

/** 렌더된 텍스트 전부. 부정 스캔(INV-3)의 모집단이다 — 소스가 아니라 **보이는 글자**를 훑는다. */
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

/** 시각 표기 탐지기. 02a §5-C 실측 — 이 화면이 그리는 문자열 13종 중 걸리는 것은 고정 블록의
 * `21:00 도착 · 변경 불가` 하나뿐이다(오탐 0). 자손을 이어 붙여 비교하므로 `09`·`:`·`30` 으로
 * 쪼개 그려도 잡힌다(§5-A6 실행 확인). */
const HHMM = /\d{1,2}:\d{2}/;
/** 시각 **범위** 표기(`21:00–22:00`). `endAt` 을 함께 그리면 뺄셈으로 소요시간을 읽을 수 있어
 * INV-3 의 다른 이름이 된다. */
const TIME_RANGE = /\d{1,2}:\d{2}\s*[–~-]\s*\d{1,2}:\d{2}/;
/** 소요시간 표기 탐지기(TRIP-296 과 같은 것). 02a §5-C 실측 — 이 화면의 문자열에 오탐 0건. */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

const onSelectDay = jest.fn();
const onRetry = jest.fn();
const onBack = jest.fn();
// TRIP-454 — h11→h25 완성 CTA 콜백. 아직 `DraftScreenProps` 에 없어(구현 전) tsc 는 이 prop 을
// 거부하지만 jest 는 babel 이 타입을 벗겨 실행한다 — 완성 CTA testID 부재로 red 가 난다(구현용
// 프롭 선언은 implementer 몫, 02a §6). 화면은 여분 prop 을 무시하므로 기존 케이스는 무영향이다.
const onComplete = jest.fn();

type ScreenOverrides = {
  view?: DraftView;
  tabs?: DraftDayTab[];
  selectedDate?: string;
  pins?: DraftPin[];
  dayHeader?: string;
  canRetry?: boolean;
  onComplete?: () => void;
};

function renderScreen(over: ScreenOverrides = {}) {
  return render(
    <DraftScreen
      view={listed()}
      tabs={TABS}
      selectedDate={DAY1}
      pins={PINS_DAY1}
      dayHeader="6월 10일 · 수"
      canRetry
      onSelectDay={onSelectDay}
      onRetry={onRetry}
      onBack={onBack}
      onComplete={onComplete}
      {...over}
    />
  );
}

beforeEach(() => {
  onSelectDay.mockClear();
  onRetry.mockClear();
  onBack.mockClear();
  onComplete.mockClear();
});

describe('C1 · 탐지기 자가검사 — 이게 통과해야 아래 개수·순서 단언이 의미를 갖는다', () => {
  it('카드 세는 셀렉터가 번호·라벨·배지·사진을 삼키지 않는다', () => {
    renderScreen();

    // 카드만 정확히 넷. 완전 일치라 하나라도 섞이면 여기서 먼저 죽는다.
    expect(cardTestIds()).toEqual([
      cardId(DAY1, 'poi-a'),
      cardId(DAY1, 'poi-b'),
      cardId(DAY1, 'poi-c'),
      cardId(DAY1, 'poi-d'),
    ]);

    // 짝 — 제외 대상이 화면에 **실재하는데도** 위 목록에 안 섞였다. 실재하지 않으면 제외기가
    // 옳은지 아무것도 증명하지 못한다.
    expect(screen.getByTestId(subId('no', DAY1, 'poi-a'))).toBeOnTheScreen();
    expect(screen.getByTestId(subId('band', DAY1, 'poi-a'))).toBeOnTheScreen();
    expect(screen.getByTestId(subId('badge', DAY1, 'poi-a'))).toBeOnTheScreen();
    expect(screen.getByTestId(subId('image', DAY1, 'poi-a'))).toBeOnTheScreen();
  });

  it('시각 탐지기가 쪼개 그린 09:30 도 잡는다 — AC-1 이 우회 가능한 심판이 아니다', () => {
    // ★ 조합 검증 — `toHaveTextContent` 는 자손 텍스트를 **구분자 없이 이어 붙여** 비교한다.
    //   이 사실이 없으면 AC-1 은 "한 Text 안에 통으로 적지만 마라"는 약한 심판이 된다.
    render(
      <Text testID="split-probe">
        <Text>09</Text>
        <Text>:</Text>
        <Text>30</Text>
      </Text>
    );

    expect(screen.getByTestId('split-probe')).toHaveTextContent(HHMM);
  });
});

describe('🔴 C2 · AC-1 — 비고정 슬롯 카드 안에 시각이 없다 (INV-U3-07 · 이 칸의 핵심 심판)', () => {
  it('고정 카드에만 21:00 이 있고 비고정 카드 3장에는 HH:mm 이 0건이다', () => {
    renderScreen();

    const fixedCard = screen.getByTestId(cardId(DAY1, 'poi-d'));

    // ① 긍정 앵커 먼저 — 없으면 **아무것도 안 그리는 화면**이 아래 부정 단언을 공짜로 통과한다.
    expect(fixedCard).toHaveTextContent(/21:00/);
    expect(screen.getByTestId(cardId(DAY1, 'poi-a'))).toHaveTextContent(
      /성산일출봉/
    );
    expect(screen.getByTestId(subId('band', DAY1, 'poi-a'))).toBeOnTheScreen();

    // ② 부정 — 비고정 3장 **각각**. `startAt` 이 응답에 있어도 표시하지 않는다(DEC-U3-3:
    //   초안 시각은 슬롯 교체마다 흔들려 신뢰를 깎는다).
    ['poi-a', 'poi-b', 'poi-c'].forEach((poiId) => {
      expect(screen.getByTestId(cardId(DAY1, poiId))).not.toHaveTextContent(
        HHMM
      );
    });

    // ③ 고정 카드도 **범위**를 그리지 않는다 — `endAt`(22:00)은 어느 카드에도 안 나온다.
    expect(fixedCard).not.toHaveTextContent(TIME_RANGE);
    expect(fixedCard).not.toHaveTextContent(/22:00/);
  });
});

describe('C3 · AC-2 — 시간대 라벨이 timeBandLabel(startAt) 과 같다 (BR-U3-07 · PBT-U3-2)', () => {
  it('세 카드가 각각 오전·점심·오후를 내고 성격 축이 붙지 않는다', () => {
    renderScreen();

    // 기대값을 **실제 함수를 불러** 만든다 — 라벨 규칙을 화면이 재구현하면 여기서 갈린다.
    [SLOT_A, SLOT_B, SLOT_C, SLOT_D].forEach((entry) => {
      expect(
        screen.getByTestId(subId('band', DAY1, entry.poiId))
      ).toHaveTextContent(timeBandLabel(entry.startAt));
    });

    // 짝 — 네 값이 실제로 서로 다르다. 한 라벨을 전부에 박는 구현을 죽인다.
    expect(DAY1_SLOTS.map((entry) => timeBandLabel(entry.startAt))).toEqual([
      '오전',
      '점심',
      '오후',
      '저녁',
    ]);

    // ⚠️ `toHaveTextContent(문자열)` 은 **완전 일치**다(02a §5-A5 실행 확인). 그래서 위 네 줄이
    //    Figma 의 `오전 · 활동`(성격 축)을 자동으로 red 로 만든다 — 성격 축 매핑은 어느 정본에도
    //    없어 01b D4 가 범위 밖으로 동결했다. 발명하지 않는다.
  });
});

describe('C4 · AC-3 — 고정 블록만 시각을 예외로 표기한다 (BR-U3-07)', () => {
  it('고정 카드에 "21:00 도착 · 변경 불가" 가 뜨고 비고정 카드에는 그 요소가 없다', () => {
    renderScreen();

    // 완전 일치 — 이 한 줄이 문구 전체를 잠근다. `startAt` 은 `"21:00:00"` 이므로 앞 5자만
    // 쓴다(01b D5 — 절삭 규칙이 정본에 없어 이 사이클이 정했다).
    expect(screen.getByTestId(subId('fixed', DAY1, 'poi-d'))).toHaveTextContent(
      '21:00 도착 · 변경 불가'
    );

    // 부정 짝 — 모든 카드에 시각 줄을 그리는 구현을 죽인다(그러면 AC-1 이 무너진다).
    ['poi-a', 'poi-b', 'poi-c'].forEach((poiId) => {
      expect(screen.queryAllByTestId(subId('fixed', DAY1, poiId))).toEqual([]);
    });
  });
});

describe('C5 · AC-5 — 번호는 1..n 연속이고 순서는 응답 배열 그대로다 (INV-U3-02)', () => {
  it('네 카드의 번호가 1·2·3·4 다', () => {
    renderScreen();

    // `orderIndex` 는 REST 계약에 **없다** — 배열 순서가 곧 순서이고 번호는 인덱스+1 이다.
    DAY1_SLOTS.forEach((entry, index) => {
      expect(
        screen.getByTestId(subId('no', DAY1, entry.poiId))
      ).toHaveTextContent(String(index + 1));
    });
  });

  it('🔴 시각 역순으로 온 배열을 클라가 다시 정렬하지 않는다', () => {
    // 준비 — 15:00 슬롯이 09:30 슬롯보다 **앞에** 온다. 서버가 순서의 권위다(INV-U3-02 는
    // 서버가 지킨다). 클라가 `startAt` 으로 정렬하면 아래 두 단언이 동시에 뒤집힌다.
    renderScreen({
      view: listed([{ date: DAY1, slots: [SLOT_C, SLOT_A] }]),
      pins: [],
    });

    expect(cardTestIds()).toEqual([
      cardId(DAY1, 'poi-c'),
      cardId(DAY1, 'poi-a'),
    ]);
    expect(screen.getByTestId(subId('no', DAY1, 'poi-c'))).toHaveTextContent(
      '1'
    );
    expect(screen.getByTestId(subId('no', DAY1, 'poi-a'))).toHaveTextContent(
      '2'
    );
  });
});

describe('C6 · AC-8 — 카드 testID 가 buildSlotKey(date, poiId) 와 같다 (BR-U2-04)', () => {
  it('네 카드의 키가 buildSlotKey 산출과 완전히 일치한다', () => {
    renderScreen();

    // 직접 문자열 조립(구분자를 `-` 로 쓰거나 poiId 만 쓰는 구현)은 여기서 죽는다.
    // 한 문자열이 React `key` 이자 testID 접미사라, 두 경로가 갈리면 렌더 층에서야 드러난다.
    expect(cardTestIds()).toEqual(
      DAY1_SLOTS.map(
        (entry) => `itinerary-draft-slot-${buildSlotKey(DAY1, entry.poiId)}`
      )
    );
  });

  it('날짜를 바꾸면 같은 poiId 라도 키가 달라지고, 그날 카드·핀만 남는다', () => {
    // 준비 — 2일차에도 `poi-a` 가 있다. 키가 poiId 하나로 만들어졌다면 두 날의 키가 겹친다.
    renderScreen({ selectedDate: DAY2, pins: PINS_DAY2 });

    expect(cardTestIds()).toEqual([cardId(DAY2, 'poi-a')]);
    // 짝 — 1일차 카드가 남아 있지 않다(모든 날을 한꺼번에 그리는 구현을 죽인다).
    expect(screen.queryAllByTestId(cardId(DAY1, 'poi-a'))).toEqual([]);
    expect(screen.getByTestId('map-root').props.pins).toEqual(PINS_DAY2);
  });
});

describe('C7 · AC-6 — 소요시간 문자열이 한 개도 안 보인다 (INV-3)', () => {
  it('이름·시각·거리는 보이는데 분·시간·소요 표기는 0건이다', () => {
    renderScreen();

    // 긍정 앵커 먼저 — 없으면 아무것도 안 그리는 화면이 아래 부정 단언을 공짜로 통과한다.
    const texts = renderedTexts();
    expect(texts).toContain('성산일출봉');
    expect(texts.some((text) => text.includes('21:00'))).toBe(true);

    // 부정 — **소스가 아니라 렌더 결과**를 훑는다. 소스 전수 스캔은 `// duration 표시 금지` 같은
    // 수호 주석 자체가 걸려 통과 불가능한 심판이 된다(문제로그 2026-08-08 · 02a ★5).
    // 거리(`약 1.2km · 도보 추정`)는 남고 소요시간만 없어야 한다 — BR-U2-08 이 정한 표기다.
    expect(texts.filter((text) => DURATION_TEXT.test(text))).toEqual([]);
  });
});

describe('C8 · AC-7 — 서버가 안 준 것을 지어내지 않는다 (INV-1 · TRIP-219)', () => {
  it('imageUrl·tags·nameKo 가 없는 슬롯은 그 자리를 아예 비운다', () => {
    renderScreen();

    // 긍정 짝 — 값이 있는 슬롯에는 셋 다 실재한다. 없으면 아래 "0건"이 공허하다.
    expect(screen.getByTestId(subId('image', DAY1, 'poi-a'))).toBeOnTheScreen();
    expect(screen.getByTestId(subId('tags', DAY1, 'poi-a'))).toBeOnTheScreen();
    expect(screen.getByTestId(subId('name', DAY1, 'poi-a'))).toBeOnTheScreen();

    // 부정 — 기본 이미지·빈 칩 줄·플레이스홀더 문구를 지어내지 않는다. 요소 자체가 없다.
    expect(screen.queryAllByTestId(subId('image', DAY1, 'poi-b'))).toEqual([]);
    expect(screen.queryAllByTestId(subId('tags', DAY1, 'poi-b'))).toEqual([]);
    expect(screen.queryAllByTestId(subId('name', DAY1, 'poi-b'))).toEqual([]);

    // 원시 id 를 문구로 흘리는 것도 설명이 아니다(testID 는 텍스트가 아니라 안 걸린다).
    expect(screen.getByTestId(cardId(DAY1, 'poi-b'))).not.toHaveTextContent(
      /poi-b/
    );
  });
});

describe('C9 · AC-12 — AI 추천 배지는 비고정 슬롯에만 붙는다', () => {
  it('비고정 3장에 배지가 하나씩 있고 고정 카드에는 0개다', () => {
    renderScreen();

    ['poi-a', 'poi-b', 'poi-c'].forEach((poiId) => {
      expect(
        within(screen.getByTestId(cardId(DAY1, poiId))).queryAllByTestId(
          /^itinerary-draft-slot-badge-/
        )
      ).toHaveLength(1);
    });

    // ★ 근거는 `isFixed` 지 표면 필드가 아니다 — `poi-b` 는 이름·사진·태그가 전부 비었는데도
    //   배지가 **있다**. `placementReason != null` 로 판정하는 구현은 위 줄에서 죽는다(01b AC-12).
    expect(
      within(screen.getByTestId(cardId(DAY1, 'poi-d'))).queryAllByTestId(
        /^itinerary-draft-slot-badge-/
      )
    ).toHaveLength(0);
  });
});

describe('C10 · AC-4 — 탭은 여행 기간만큼이고 데이터 없는 날은 눌리지 않는다', () => {
  it('탭 3개가 뜨고 비활성 탭은 눌러도 선택이 안 바뀐다', () => {
    renderScreen();

    expect(screen.queryAllByTestId(/^itinerary-draft-day-/)).toHaveLength(3);
    expect(screen.getByTestId('itinerary-draft-day-1')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-draft-day-3')).toBeOnTheScreen();

    // ★ `toBeDisabled()` 하나로는 못 잰다 — 회색으로 칠하기만 하고 실제로는 눌리는 구현이
    //   그 매처를 **통과한다**(TRIP-296 02a §5-2 실측: accessibilityState 만 준 Pressable 은
    //   press 가 1회 불린다). 그래서 press 0회를 짝으로 붙인다.
    const inactive = screen.getByTestId('itinerary-draft-day-2');
    expect(inactive).toBeDisabled();
    fireEvent.press(inactive);
    expect(onSelectDay).not.toHaveBeenCalled();

    // 짝 — 활성 탭은 실제로 눌린다(전부 비활성인 구현을 죽인다).
    fireEvent.press(screen.getByTestId('itinerary-draft-day-1'));
    expect(onSelectDay).toHaveBeenCalledTimes(1);
    expect(onSelectDay).toHaveBeenCalledWith(DAY1);
  });
});

describe('🔴 C11 · AC-13 — 핀은 건너뛰고 카드는 연속이다 (좌표 nullable)', () => {
  it('지도에 핀 3개가 1·3·4 번으로 가고, 같은 화면의 카드 번호는 1..4 다', () => {
    renderScreen();

    // 화면은 model 산출을 그대로 흘린다 — 여기서 다시 걸러내면 재판정이다.
    expect(screen.getByTestId('map-root').props.pins).toEqual(PINS_DAY1);

    // ★ 짝 — **같은 화면에서** 카드 번호는 건너뛰지 않는다. 이 비대칭이 AC-13 의 요점이다:
    //   지도 핀을 1 부터 다시 매기면 사용자가 지도 ② 를 누르고 카드 ② 를 기대하는데 어긋난다.
    DAY1_SLOTS.forEach((entry, index) => {
      expect(
        screen.getByTestId(subId('no', DAY1, entry.poiId))
      ).toHaveTextContent(String(index + 1));
    });
  });
});

describe('🔴 C12 · AC-10 — 부분 실패가 도착한 일자를 덮지 않는다 (INV-4)', () => {
  it('상단 배너 한 줄이 뜨고 카드 4장이 그대로 남는다', () => {
    renderScreen({ view: listed(DAYS, true) });

    // ① 실패가 삼켜지지 않았다(BR-U1-55 침묵 실패 금지). 문구는 정본에 없어 존재만 잠근다.
    expect(
      screen.getByTestId('itinerary-draft-stale-failed')
    ).toBeOnTheScreen();

    // ② 목록이 지워지지 않았다 — openapi: "FAILED=2차 실패(1차분은 유효)".
    expect(cardTestIds()).toHaveLength(4);
    expect(screen.getByTestId(cardId(DAY1, 'poi-a'))).toHaveTextContent(
      /성산일출봉/
    );

    // ③ 전면 실패·로딩 얼굴로 **갈아 끼우지** 않았다. 이 계열 화면에서 두 방향으로 재발한 실패다.
    expect(screen.queryAllByTestId('itinerary-draft-failed')).toEqual([]);
    expect(screen.queryAllByTestId('itinerary-draft-loading')).toEqual([]);
  });
});

describe('🔴 C13 · AC-11 — 확정된 일정에서는 다시 시도가 눌리지 않는다 (01b D8)', () => {
  it('canRetry=false 면 비활성이고 눌러도 콜백이 0회다', () => {
    /**
     * ⚠️ 여기가 이 칸에서 **가장 비싼 단일 실패**다. openapi POST 원문: *"확정 일정에 호출하면
     * 확정이 풀리고 PLANNED 새 일정으로 대체되며, 동결됐던 poi_snapshot 참조는 사라진다."*
     * 즉 회색으로 칠하기만 하고 실제로 눌리면 **사용자 데이터가 소실된다** — `toBeDisabled()`
     * 단독으로는 그 구현을 통과시킨다(02a ★8).
     */
    renderScreen({ canRetry: false });

    const retry = screen.getByTestId('itinerary-draft-retry');
    expect(retry).toBeDisabled();
    fireEvent.press(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('canRetry=true 면 눌린다 — 중단된 생성에서 벗어나는 탈출구다', () => {
    // 짝 — 항상 비활성인 구현을 죽인다. PARTIAL 에 갇힌 사용자의 유일한 출구다.
    renderScreen({ canRetry: true });

    fireEvent.press(screen.getByTestId('itinerary-draft-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('C14 · 진행 표시 — 평범한 것 하나뿐이다 (티켓 스코프 · BR-U3-04·05 는 보류 칸)', () => {
  it('진행 표시가 뜨고 카드는 0장이며 단계·진행률·백그라운드·취소는 없다', () => {
    renderScreen({ view: { kind: 'loading' } });

    // 긍정 — 진행 표시가 실재한다.
    expect(screen.getByTestId('itinerary-draft-loading')).toBeOnTheScreen();
    // 짝 — 아직 그릴 슬롯이 없다.
    expect(cardTestIds()).toEqual([]);

    // 부정 — h09/h10 이 요구하는 4가지는 `GenerationSession` 부재로 보류 칸 소관이다. 이 칸이
    // 미리 만들면 데이터 없는 껍데기가 생기고, 나중에 그 칸이 붙을 자리가 어긋난다.
    const texts = renderedTexts().join(' ');
    ['백그라운드', '취소', '%'].forEach((forbidden) => {
      expect(texts).not.toContain(forbidden);
    });
  });
});

/* ───────────────────────── TRIP-454 · h11→h25 완성 CTA ─────────────────────────
 * h11(추천안 초안)의 `listed` 얼굴 하단에 h25(완성 일정)로 가는 완성 버튼을 신설한다. 화면은
 * 목적지를 모르고 `onComplete` 콜백만 부른다(배선은 `DraftPage` 몫 · AC-5). 라벨 `이 일정으로
 * 완성` 은 발명값이다 — Figma h11(1870:1083)에 하단 CTA 가 없다(02a §6, scribe 소급 대상).
 *
 * 🔴 지금은 red 다: `itinerary-draft-complete` testID·`onComplete` prop 이 리포에 0건이다.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('🔴 C15 · AC-4 — listed 얼굴에 완성 CTA 가 있고 누르면 onComplete 가 불린다', () => {
  it('완성 버튼과 라벨이 뜨고, 눌러 onComplete 가 정확히 한 번 불린다', () => {
    renderScreen();

    // 긍정 앵커 — 버튼이 실재하고 라벨이 발명값 그대로다. `getByText(문자열)` 은 exact 텍스트노드
    // 매치라 문안이 드리프트하면 red 다(`toHaveTextContent` 완전일치 함정은 피한다, 02a ★9·★10).
    expect(screen.getByTestId('itinerary-draft-complete')).toBeOnTheScreen();
    expect(screen.getByText('이 일정으로 완성')).toBeOnTheScreen();

    // ★ 활성 증명은 press→콜백이다 — `toBeDisabled()` 단독은 "회색인데 눌리는" 구현을
    //   통과시킨다(02a ★5). 눌러서 실제로 한 번 불리는 것으로 활성을 잰다.
    fireEvent.press(screen.getByTestId('itinerary-draft-complete'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 C16 · AC-4 — 생성 중(PARTIAL) listed 에서도 완성 CTA 가 활성이다', () => {
  it('generating=true 여도 완성 버튼이 뜨고 눌러 onComplete 가 불린다 (잠금 없음)', () => {
    // 오케 결정: h25 가 자체적으로 상태를 처리하므로 완성 CTA 는 PARTIAL 에서도 잠그지 않는다
    // (`isConfirmLocked` 류 잠금 추가 금지 · 02a ★8). `listed.generating` 은 h10 "만드는 중"
    // 얼굴을 얹는 축이다(model DraftView.listed.generating).
    renderScreen({
      view: {
        kind: 'listed',
        days: DAYS,
        staleFailed: false,
        generating: true,
      },
    });

    expect(screen.getByTestId('itinerary-draft-complete')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('itinerary-draft-complete'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('C17 · AC-4 — 완성 CTA 는 비-listed 얼굴에는 없다 (선제 green · 짝 트립와이어)', () => {
  // DraftScreen 의 비-listed 얼굴은 loading·failed·empty 3종이다(zero 는 DraftPage 가 가로채는
  // 별도 `ZeroCandidateScreen` 이라 이 화면 계약 밖 · 02a ★6). CTA 가 아직 없어 지금은 전부
  // green 이고, 구현 후에도 green 이면 "CTA 가 listed 에만 산다"는 트립와이어다 — 구현자가
  // CTA 를 얼굴 무관 위치(ScrollView 최상위)에 두면 여기서 red 로 전환된다(02a ★7).
  it.each([
    { name: 'loading', view: { kind: 'loading' } as DraftView },
    { name: 'failed', view: { kind: 'failed' } as DraftView },
    { name: 'empty', view: { kind: 'empty' } as DraftView },
  ])('$name 얼굴에는 완성 CTA 가 없다', ({ view }) => {
    renderScreen({ view });

    expect(screen.queryByTestId('itinerary-draft-complete')).toBeNull();
  });
});
