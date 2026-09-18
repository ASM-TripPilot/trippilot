import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

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
