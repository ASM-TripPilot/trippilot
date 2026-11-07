import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/index.schemas';

import { buildEditItineraryRequest } from './buildEditItineraryRequest';

/**
 * TRIP-302 · h24 저장 코어(슬라이스2) — 편집 스토어 `days` → `EditItineraryRequest` **조립 순수함수**.
 *
 * 전체 교체(full-replace) PUT 은 "바뀐 것"이 아니라 "바뀐 뒤 days 전체"를 보낸다 — 배열 순서가
 * 곧 최종 슬롯 순서다(INV-U3-02). 이 조립이 조용히 어긋나면 자정 넘김 일정이 깨지거나(HC4),
 * 초 정보가 사라지거나, 서버 소유 읽기전용 필드가 요청에 새 들어간다. 서버를 안 띄우고 렌더도
 * 없이 그 규칙들을 exact 하게 잠근다(02a ★8 · AC1·AC2).
 *
 * 무엇을 보장하나:
 *  - 🔴 슬롯은 **5필드뿐**(poiId·startAt·endAt·isFixed·endsNextDay) — 읽기전용 필드는 버린다(P1).
 *  - 🔴 시각은 **전체 정밀도 `HH:mm:ss`** — 표시용 `slice(0,5)` 절단값이 아니다(P2).
 *  - 🔴 **`endsNextDay` 를 실어나른다**(HC4 자정 넘김 소실 방지) — true/false 둘 다 그대로(P3).
 *  - 🔴 **배열 순서 = 슬롯 순서**, 다일자·date 보존(P4).
 *
 * *(개념)* `Object.keys(obj)` 는 객체의 자기 소유 키 이름 배열. `.sort()` 로 정렬해 `toEqual` 하면
 * **정확한 키집합 동치** — 읽기전용 필드가 하나라도 새 들어가면 배열이 달라져 잡힌다(02a §5-B 실측).
 *
 * 3동작 뼈대: 준비=편집 스토어 형태의 days 입력 → 실행=buildEditItineraryRequest(days) → 단언=반환 봉투.
 */

/** 읽기전용 필드까지 전부 채운 스토어 슬롯(조회 응답 형태) — 조립이 무엇을 버리는지 보이려고 풍성하게. */
function richSlot(
  over: Partial<ItineraryDaysItemSlotsItem> & { poiId: string }
): ItineraryDaysItemSlotsItem {
  return {
    startAt: '09:30:45',
    endAt: '11:00:15',
    isFixed: false,
    endsNextDay: false,
    hasViolation: true,
    alternatives: [],
    violationReason: '시간이 겹쳐요',
    distanceRange: '약 1.2km · 도보 추정',
    placementReason: '바다 뷰',
    nameKo: '해운대 해수욕장',
    lat: 35.1587,
    lng: 129.1604,
    category: 'BEACH',
    openingHours: '연중무휴',
    openingHoursKnown: true,
    imageUrl: 'https://example.com/a.jpg',
    tags: ['바다', '산책'],
    ...over,
  };
}

const REQUEST_KEYS = [
  'poiId',
  'startAt',
  'endAt',
  'isFixed',
  'endsNextDay',
].sort();

describe('🔴 P1 · AC2 — 조립 슬롯은 5필드뿐(읽기전용 필드는 버린다)', () => {
  it('poiId·startAt·endAt·isFixed·endsNextDay 만 남고 나머지는 빠진다', () => {
    const days: ItineraryDaysItem[] = [
      { date: '2026-06-10', slots: [richSlot({ poiId: 'poi-a' })] },
    ];

    const out = buildEditItineraryRequest(days);
    const slot = out.days[0].slots[0];

    // 정확한 키집합 동치 — 서버 소유 읽기전용 필드가 새면 여기서 red.
    expect(Object.keys(slot).sort()).toEqual(REQUEST_KEYS);

    // 가독 짝 — 대표 읽기전용 필드는 확실히 없다.
    expect(slot).not.toHaveProperty('hasViolation');
    expect(slot).not.toHaveProperty('violationReason');
    expect(slot).not.toHaveProperty('distanceRange');
    expect(slot).not.toHaveProperty('nameKo');
    expect(slot).not.toHaveProperty('tags');

    // 남은 5필드는 값이 그대로 통과한다.
    expect(slot.poiId).toBe('poi-a');
    expect(slot.isFixed).toBe(false);
  });
});

describe('🔴 P2 · AC2 — 시각은 전체 정밀도 HH:mm:ss(표시용 절단 아님)', () => {
  it('startAt/endAt 의 초까지 원본 그대로 실린다', () => {
    const days: ItineraryDaysItem[] = [
      {
        date: '2026-06-10',
        slots: [
          richSlot({ poiId: 'poi-a', startAt: '09:30:45', endAt: '11:00:15' }),
        ],
      },
    ];

    const out = buildEditItineraryRequest(days);
    const slot = out.days[0].slots[0];

    // slice(0,5) 로 절단하면 '09:30' 이 되어 초가 사라진다 — 원본 정밀도를 잰다.
    expect(slot.startAt).toBe('09:30:45');
    expect(slot.endAt).toBe('11:00:15');
  });
});

describe('🔴 P3 · AC1 — endsNextDay 실어나르기(true/false 둘 다 보존)', () => {
  it('자정 넘김 플래그가 조회값 그대로 실린다', () => {
    const days: ItineraryDaysItem[] = [
      {
        date: '2026-06-10',
        slots: [
          richSlot({ poiId: 'poi-overnight', endsNextDay: true }),
          richSlot({ poiId: 'poi-same', endsNextDay: false }),
        ],
      },
    ];

    const out = buildEditItineraryRequest(days);

    // true 를 떨어뜨리면 자정 넘김 일정이 조용히 깨진다(HC4). false 도 present 여야 한다.
    expect(out.days[0].slots[0].endsNextDay).toBe(true);
    expect(out.days[0].slots[1].endsNextDay).toBe(false);
  });
});

describe('🔴 P4 · AC1 — 배열 순서 = 슬롯 순서 · 다일자 · date 보존', () => {
  it('두 일자와 각 일자의 슬롯 순서를 그대로 옮긴다', () => {
    const days: ItineraryDaysItem[] = [
      {
        date: '2026-06-10',
        slots: [
          richSlot({ poiId: 'a' }),
          richSlot({ poiId: 'b' }),
          richSlot({ poiId: 'c' }),
        ],
      },
      { date: '2026-06-11', slots: [richSlot({ poiId: 'd' })] },
    ];

    const out = buildEditItineraryRequest(days);

    // 배열 순서가 곧 최종 슬롯 순서(INV-U3-02) — orderIndex 필드는 안 보내고 순서로 표현.
    expect(out.days.map((d) => d.date)).toEqual(['2026-06-10', '2026-06-11']);
    expect(out.days[0].slots.map((s) => s.poiId)).toEqual(['a', 'b', 'c']);
    expect(out.days[1].slots.map((s) => s.poiId)).toEqual(['d']);
  });
});

/**
 * TRIP-1793 · 다른 날로 옮긴 슬롯의 저장 요청 (AC-2) — **선제 green 회귀 그물**.
 *
 * 옮김 표식(`movedFromDate`)은 편집 초안 안의 꼬리표라 서버로 나가면 안 된다. 요청 조립이 지금처럼 5필드만 골라 싣는 한
 * 구조적으로 안 나가는데, 누가 "슬롯을 통째로 펼쳐(`...slot`) 싣는" 식으로 바꾸면 tsc 는 구조적 타이핑이라 못 잡고
 * 표식이 서버로 샌다. 그 변경을 여기서 잡는다.
 */
describe('🔴 MV-R1 · TRIP-1793 AC-2 — 옮긴 슬롯은 대상 날에 startAt 과 함께 실리고 표식은 요청에 없다', () => {
  it('2일차에 들어간 b 는 5필드만, 1일차 요청에는 b 가 없고, 직렬화 문자열에 moved 가 없다', () => {
    // 2일차 마지막에 15:00 으로 옮겨진 b — 표식이 달려 있다.
    const moved = {
      ...richSlot({
        poiId: 'b',
        startAt: '15:00:00',
        endAt: '16:00:00',
      }),
      movedFromDate: '2026-06-10',
    } as ItineraryDaysItemSlotsItem;
    const days: ItineraryDaysItem[] = [
      { date: '2026-06-10', slots: [richSlot({ poiId: 'a' })] },
      { date: '2026-06-11', slots: [richSlot({ poiId: 'd' }), moved] },
    ];

    const out = buildEditItineraryRequest(days);

    expect(out.days[0].slots.map((s) => s.poiId)).toEqual(['a']);
    expect(out.days[1].slots.map((s) => s.poiId)).toEqual(['d', 'b']);
    const sent = out.days[1].slots[1];
    expect(sent.startAt).toBe('15:00:00');
    expect(Object.keys(sent).sort()).toEqual(REQUEST_KEYS);
    expect(JSON.stringify(out)).not.toContain('moved');
  });
});

/**
 * TRIP-1795 · AC-6·16 — 이 여행에서만 고친 이름·분류(`displayName`·`displayCategory`)를 저장 때 **다시 실어 보낸다**.
 *
 * 무엇을 보장하나: PUT 은 전체 교체라 조회 응답에서 받은 값을 안 실으면 **어느 경로로 저장하든 덮어쓰기가 조용히 사라진다**
 * (슬롯 5필드만 골라 싣던 옛 구현의 결과). 값이 있는 슬롯만 해당 키를 싣고, 없는 슬롯은 키 자체가 없어 옛 서버·옛 응답에서도
 * 요청 모양이 종전 5필드 그대로다.
 *
 * > *(개념)* `toEqual` 은 `{a:1, b:undefined}` 와 `{a:1}` 을 같다고 본다. "키가 없다"를 재려면 `Object.keys` 로 키 목록을 본다.
 *
 * 3동작 뼈대: 준비=덮어쓴/안 쓴 슬롯 섞은 days → 실행=buildEditItineraryRequest → 단언=요청 슬롯의 키 목록·값.
 */
describe('🔴 TRIP-1795 · 표시 이름·분류 보존 (AC-6·16)', () => {
  const FIVE = ['poiId', 'startAt', 'endAt', 'isFixed', 'endsNextDay'];
  const keysOf = (slot: object): string[] => Object.keys(slot).sort();

  it('B1 · 두 칸이 다 있으면 5필드 + displayName·displayCategory 가 값 그대로 실린다 (원본 nameKo·category 는 여전히 안 실린다)', () => {
    const days: ItineraryDaysItem[] = [
      {
        date: '2026-06-10',
        slots: [
          richSlot({
            poiId: 'poi-a',
            displayName: '우리 아지트',
            displayCategory: '카페',
          }),
        ],
      },
    ];

    const slot = buildEditItineraryRequest(days).days[0].slots[0];

    expect(keysOf(slot)).toEqual(
      [...FIVE, 'displayName', 'displayCategory'].sort()
    );
    expect(slot).toMatchObject({
      displayName: '우리 아지트',
      displayCategory: '카페',
    });
    expect(slot).not.toHaveProperty('nameKo');
    expect(slot).not.toHaveProperty('category');
  });

  it('B2 · 한 칸만 있으면 그 키만, null·undefined 면 키 자체가 없다 (옛 서버·옛 응답은 종전 5필드 모양)', () => {
    const days: ItineraryDaysItem[] = [
      {
        date: '2026-06-10',
        slots: [
          richSlot({ poiId: 'name-only', displayName: '이름만' }),
          richSlot({ poiId: 'cat-only', displayCategory: '야경' }),
          richSlot({
            poiId: 'nulls',
            displayName: null,
            displayCategory: null,
          }),
          richSlot({ poiId: 'absent' }),
        ],
      },
    ];

    const [nameOnly, catOnly, nulls, absent] =
      buildEditItineraryRequest(days).days[0].slots;

    expect(keysOf(nameOnly)).toEqual([...FIVE, 'displayName'].sort());
    expect(keysOf(catOnly)).toEqual([...FIVE, 'displayCategory'].sort());
    // `null` 을 명시 키로 싣지 않는다 — 서버가 키 생략 = 덮어쓰기 없음으로 읽는다(계약).
    expect(keysOf(nulls)).toEqual([...FIVE].sort());
    expect(keysOf(absent)).toEqual([...FIVE].sort());
  });

  it('B3 · 여러 날·섞인 슬롯 — 값 있는 슬롯만 키를 달고 순서·시각 미지정 제외 규칙은 그대로, 제외된 슬롯의 덮어쓰기는 어디에도 새지 않는다', () => {
    const unspecified = {
      ...richSlot({ poiId: 'gone', displayName: '시각 없는 곳' }),
      startAt: null,
    };
    const days = [
      {
        date: '2026-06-10',
        slots: [
          richSlot({ poiId: 'a', displayName: '첫째' }),
          unspecified,
          richSlot({ poiId: 'b' }),
        ],
      },
      {
        date: '2026-06-11',
        slots: [richSlot({ poiId: 'c', displayCategory: '쇼핑' })],
      },
    ];

    const out = buildEditItineraryRequest(days);

    expect(out.days.map((d) => d.slots.map((s) => s.poiId))).toEqual([
      ['a', 'b'],
      ['c'],
    ]);
    expect(keysOf(out.days[0].slots[0])).toEqual(
      [...FIVE, 'displayName'].sort()
    );
    expect(keysOf(out.days[0].slots[1])).toEqual([...FIVE].sort());
    expect(keysOf(out.days[1].slots[0])).toEqual(
      [...FIVE, 'displayCategory'].sort()
    );
    expect(JSON.stringify(out)).not.toContain('시각 없는 곳');
  });
});
