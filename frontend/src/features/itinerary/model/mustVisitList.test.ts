import type {
  MustVisit,
  Place,
  SavedPlace,
} from '@/shared/api/generated/schemas';

import {
  MUST_VISIT_NAME_PLACEHOLDER,
  buildMustVisitPins,
  joinMustVisits,
  resolveMustVisitListView,
  type MustVisitListItem,
} from './mustVisitList';

/**
 * h05 필수 방문지 목록의 **순수 판정 2종** — 조인(`joinMustVisits`)과 얼굴
 * (`resolveMustVisitListView`).
 *
 * 무엇을 보장하나:
 *  - 서버가 준 `must_visit`(등록 건)과 `saved-places`(담은 장소)를 `sourcePoiId ↔ place.poiId`로
 *    이어 이름·사진을 채운다(AC-2). **필드 이름이 서로 다르다**는 것이 이 조인의 전부다.
 *  - 이름을 못 얻은 항목을 **숨기지 않는다**(AC-3 · 사용자 동결 · INV-4 · BR-U1-55).
 *  - 이미 받아 둔 목록이 재조회 실패·재로딩에 **지워지지 않고**, 실패 사실도 함께 산다(AC-M1).
 *  - `dwellMin` 이 화면 층으로 넘어갈 통로가 자료형 단계에서 없다(AC-9 · INV-3).
 *
 * 왜 화면 밖인가: "언제 어느 얼굴인가"를 화면에 두면 조합마다 렌더해야 보이고, 화면은 조회
 * 상태를 알 수 없다(`features` 경계). 화면은 완성된 얼굴만 받는다 — `mustVisitSeed.ts` 선례.
 *
 * 3동작 뼈대: 준비=서버 응답 모양을 만든다 → 실행=순수 함수를 부른다 → 단언=돌아온 값.
 */

/** openapi `Place.required` 를 그대로 채운다(상상해서 만들지 않는다). */
function makePlace(
  poiId: string,
  nameKo: string,
  imageUrl: string | null
): Place {
  return {
    poiId,
    nameKo,
    imageUrl,
    category: '명소',
    lat: 35.1587,
    lng: 129.1604,
    region: '부산진구',
    openingHours: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
  };
}

function savedPlace(
  poiId: string,
  nameKo: string,
  imageUrl: string | null
): SavedPlace {
  return {
    savedPlaceId: `sp-${poiId}`,
    savedAt: '2026-08-01T10:00:00.000Z',
    place: makePlace(poiId, nameKo, imageUrl),
  };
}

function mustVisit(
  over: Partial<MustVisit> & { sourcePoiId: string }
): MustVisit {
  return {
    mustVisitId: `mv-${over.sourcePoiId}`,
    poiSnapshotId: `snap-${over.sourcePoiId}`,
    type: 'ANYTIME',
    ...over,
  };
}

/** 화면이 그대로 쓸 수 있는 최소 항목 하나(테스트 안에서만 쓰는 편의 생성기). */
function listItem(
  over: Partial<MustVisitListItem> & { sourcePoiId: string }
): MustVisitListItem {
  return {
    mustVisitId: `mv-${over.sourcePoiId}`,
    name: '감천문화마을',
    imageUrl: null,
    type: 'ANYTIME',
    ...over,
  };
}

describe('C1 · AC-2 — 담은 장소와 조인해 이름·사진이 채워진다', () => {
  it('세 항목이 이름·사진·두 id 를 모두 갖고, 입력 순서 그대로 나오며, 입력 배열을 흔들지 않는다', () => {
    // 준비 — 등록 건 3개와 담은 장소 3개. 조인 키는 `sourcePoiId ↔ place.poiId` 다.
    const mustVisits: MustVisit[] = [
      mustVisit({
        sourcePoiId: 'poi-a',
        type: 'FIXED',
        fixedDate: '2026-06-11',
        fixedStart: '13:00',
      }),
      mustVisit({ sourcePoiId: 'poi-b' }),
      mustVisit({ sourcePoiId: 'poi-c' }),
    ];
    const savedPlaces: SavedPlace[] = [
      savedPlace('poi-a', '부산시립미술관', 'https://img.example.com/a.jpg'),
      savedPlace('poi-b', '해운대 블루라인파크', null),
      savedPlace('poi-c', '감천문화마을', 'https://img.example.com/c.jpg'),
    ];
    const beforeMustVisits = JSON.parse(JSON.stringify(mustVisits));
    const beforeSaved = JSON.parse(JSON.stringify(savedPlaces));

    // 실행
    const items = joinMustVisits({ mustVisits, savedPlaces });

    // 단언 — 완전 일치. `toEqual` 은 값이 정의된 여분 키를 잡으므로 모양까지 잠긴다.
    expect(items).toEqual([
      {
        mustVisitId: 'mv-poi-a',
        sourcePoiId: 'poi-a',
        name: '부산시립미술관',
        imageUrl: 'https://img.example.com/a.jpg',
        type: 'FIXED',
        fixedDate: '2026-06-11',
        fixedStart: '13:00',
      },
      {
        mustVisitId: 'mv-poi-b',
        sourcePoiId: 'poi-b',
        name: '해운대 블루라인파크',
        imageUrl: null,
        type: 'ANYTIME',
      },
      {
        mustVisitId: 'mv-poi-c',
        sourcePoiId: 'poi-c',
        name: '감천문화마을',
        imageUrl: 'https://img.example.com/c.jpg',
        type: 'ANYTIME',
      },
    ]);

    // 입력 불변 — TanStack Query 캐시가 준 배열이라 제자리에서 흔들면 캐시가 오염된다.
    expect(mustVisits).toEqual(beforeMustVisits);
    expect(savedPlaces).toEqual(beforeSaved);
  });

  it('C1-b 담은 목록 순서가 달라도 조인은 등록 순서를 따른다', () => {
    // 준비 — 담은 목록만 뒤집는다. 목록의 순서 권위는 must-visits 쪽이다.
    const items = joinMustVisits({
      mustVisits: [
        mustVisit({ sourcePoiId: 'poi-a' }),
        mustVisit({ sourcePoiId: 'poi-b' }),
      ],
      savedPlaces: [
        savedPlace('poi-b', '광안리', null),
        savedPlace('poi-a', '전포', null),
      ],
    });

    expect(items.map((item) => item.sourcePoiId)).toEqual(['poi-a', 'poi-b']);
    expect(items.map((item) => item.name)).toEqual(['전포', '광안리']);
  });
});

describe('C2 · AC-3 — 조인 실패 항목을 숨기지 않는다 (사용자 동결 · INV-4)', () => {
  it('담기를 푼 항목이 목록에 그대로 남고 이름 자리가 null 로 표시된다', () => {
    // 준비 — `poi-z` 는 must_visit 에는 있는데 담은 목록에 없다. 시드는 복사본이라 원본
    // 담기를 풀어도 남는다(INV-U1-04 · BR-U1-04) → 원리적으로 생기는 갈래다.
    const items = joinMustVisits({
      mustVisits: [
        mustVisit({ sourcePoiId: 'poi-a' }),
        mustVisit({ sourcePoiId: 'poi-z' }),
      ],
      savedPlaces: [
        savedPlace('poi-a', '부산시립미술관', 'https://img.example.com/a.jpg'),
      ],
    });

    // 긍정 앵커 — 조인이 실제로 되는 항목이 하나는 있다. 없으면 "둘 다 null" 인 구현도 통과한다.
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe('부산시립미술관');

    // 핵심 — 목록에서 **빠지지 않았다**. 제외는 기각된 선택지다.
    expect(items[1].sourcePoiId).toBe('poi-z');
    expect(items[1].name).toBeNull();
    expect(items[1].imageUrl).toBeNull();
  });

  it('C2-b 플레이스홀더 상수가 사람이 읽을 문자열이다 (문구 자체는 이 칸이 정하지 않는다)', () => {
    // 문구는 어느 정본에도 없다 — 발명하지 않고 **계약만** 잠근다.
    expect(typeof MUST_VISIT_NAME_PLACEHOLDER).toBe('string');
    // 빈 문자열이면 화면에서 "이름 없는 카드"가 되어 침묵 실패와 구별되지 않는다.
    expect(MUST_VISIT_NAME_PLACEHOLDER.trim().length).toBeGreaterThanOrEqual(2);
    // 원시 id 를 그대로 노출하는 것은 설명이 아니다.
    expect(MUST_VISIT_NAME_PLACEHOLDER).not.toContain('poi-');
  });
});

describe('C3 · AC-1 · AC-8 — 항목은 두 id 를 둘 다 들고 다닌다', () => {
  it('mustVisitId(해제용)와 sourcePoiId(조인·라우팅·셀렉터용)가 서로 다른 값으로 산다', () => {
    // `MustVisit` 이 둘 다 주므로 하나만 들고 다니면 반드시 어느 한쪽이 막힌다 —
    // DELETE 는 `mustVisitId` 로만 되고, testID·라우트 파라미터는 `sourcePoiId` 다(D11).
    const items = joinMustVisits({
      mustVisits: [mustVisit({ sourcePoiId: 'poi-a' })],
      savedPlaces: [savedPlace('poi-a', '부산시립미술관', null)],
    });

    expect(items[0].mustVisitId).toBe('mv-poi-a');
    expect(items[0].sourcePoiId).toBe('poi-a');
    expect(items[0].mustVisitId).not.toBe(items[0].sourcePoiId);
  });
});

describe('C4 · D7 · INV-4 — 못 불러온 것과 정말 없는 것은 다른 얼굴이다', () => {
  it('목록이 비었을 때 loading · failed · empty 세 얼굴이 서로 갈린다', () => {
    expect(
      resolveMustVisitListView({ items: [], loading: true, failed: false })
    ).toEqual({
      kind: 'loading',
    });
    expect(
      resolveMustVisitListView({ items: [], loading: false, failed: true })
    ).toEqual({
      kind: 'failed',
    });
    expect(
      resolveMustVisitListView({ items: [], loading: false, failed: false })
    ).toEqual({
      kind: 'empty',
    });
  });
});

describe('🔴 C5 · AC-M1 — 도착한 목록이 재조회 실패·재로딩에 지워지지 않는다', () => {
  /**
   * ⚠️ 문제로그 `2026-08-04 화면 얼굴 전환이 잔존 목록을 지운다`. 이 계열 화면에서 **두 번**
   * 재발했다(TRIP-222 · TRIP-223, 서로 반대 방향으로). 이 칸은 세 번째 목록 화면이다.
   *
   * 이 함수의 계약: **items 를 가장 먼저 본다.** 실패도 로딩도 얼굴을 갈아 끼우지 못하고,
   * 실패는 `staleFailed` 라는 **별도 축**으로 같은 값 안에 실려 나간다 — 목록도 살고 실패도
   * 삼켜지지 않는다(INV-4).
   */
  const items = [
    listItem({ sourcePoiId: 'poi-a' }),
    listItem({ sourcePoiId: 'poi-b' }),
  ];

  it('items · loading · failed 가 동시에 참인 최악의 조합에서도 목록이 살아남는다', () => {
    const view = resolveMustVisitListView({
      items,
      loading: true,
      failed: true,
    });

    expect(view).toEqual({ kind: 'listed', items, staleFailed: true });
  });

  it('C5-b 재로딩만으로는 실패 표시가 켜지지 않는다 (짝)', () => {
    expect(
      resolveMustVisitListView({ items, loading: true, failed: false })
    ).toEqual({
      kind: 'listed',
      items,
      staleFailed: false,
    });
  });

  it('C5-c 정상 도착에는 실패 표시가 없다 (짝)', () => {
    expect(
      resolveMustVisitListView({ items, loading: false, failed: false })
    ).toEqual({
      kind: 'listed',
      items,
      staleFailed: false,
    });
  });
});

describe('C6 · AC-9 · INV-3 — dwellMin 이 화면 층으로 넘어갈 통로가 없다', () => {
  it('서버가 dwellMin 을 줘도 조인 결과의 키 목록에 없다', () => {
    // 준비 — 서버 응답에는 `dwellMin` 이 실제로 온다(계약에 있는 필드다).
    const items = joinMustVisits({
      mustVisits: [
        mustVisit({
          sourcePoiId: 'poi-a',
          type: 'FIXED',
          fixedDate: '2026-06-11',
          fixedStart: '13:00',
          dwellMin: 90,
        }),
      ],
      savedPlaces: [savedPlace('poi-a', '부산시립미술관', null)],
    });

    // 단언 — 키 목록 **완전 일치**. 표시 금지를 "글자 찾기"가 아니라 자료형 경계로 잠근다:
    // 화면이 받을 수 없는 값은 화면이 그릴 수 없다. `dwellMin` 은 솔버 입력이지 표시값이 아니다.
    expect(Object.keys(items[0]).sort()).toEqual([
      'fixedDate',
      'fixedStart',
      'imageUrl',
      'mustVisitId',
      'name',
      'sourcePoiId',
      'type',
    ]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * TRIP-326 추가분 — 지도 핀(AC-1 · AC-2).
 *
 * 왜 항목(`MustVisitListItem`)에 좌표를 안 싣나: 그러면 C1(`toEqual` 로 항목 전체 모양)과
 * C6(키 목록 완전 일치 = INV-3 자료형 가드) 두 승인 단언을 이 칸이 함께 열어야 한다. 좌표는
 * **핀을 만들 때만** 담은 장소에서 읽고, 조인과 핀이 갈라지지 않는 것은 C8 이 교차로 잰다
 * (02a ★13).
 * ──────────────────────────────────────────────────────────────────────────── */

/** 좌표를 갖는 담은 장소. 기존 `savedPlace()` 는 좌표가 전부 같은 값이라 "몇 번 핀이 어느
 * 장소인가" 를 구별할 수 없다 — 이 칸만 좌표를 다르게 준다. */
function savedPlaceAt(poiId: string, lat: number, lng: number): SavedPlace {
  return {
    savedPlaceId: `sp-${poiId}`,
    savedAt: '2026-08-01T10:00:00.000Z',
    place: { ...makePlace(poiId, `${poiId} 이름`, null), lat, lng },
  };
}

const PIN_MUST_VISITS: MustVisit[] = [
  mustVisit({ sourcePoiId: 'poi-a' }),
  mustVisit({ sourcePoiId: 'poi-b' }),
  mustVisit({ sourcePoiId: 'poi-c' }),
];

describe('C7 · AC-1 · AC-2 — 핀은 목록 번호를 그대로 쓰고 좌표 없는 항목만 건너뛴다', () => {
  it('꼬리가 빠지면 [1,2], 가운데가 빠지면 [1,3] — 번호를 다시 매기지 않는다', () => {
    // 준비 — 등록 3건. 담은 장소에서 하나씩 빼 가며 "좌표를 못 얻은 항목" 을 만든다.
    // 계약 실측(01 §4): `Place.lat`·`lng` 는 required 라 **담은 목록에 없다 = 좌표가 없다** 이고,
    // 다른 원인이 없다.
    const items = joinMustVisits({
      mustVisits: PIN_MUST_VISITS,
      savedPlaces: [
        savedPlaceAt('poi-a', 35.1, 129.1),
        savedPlaceAt('poi-b', 35.2, 129.2),
        savedPlaceAt('poi-c', 35.3, 129.3),
      ],
    });

    // 실행/단언 ① 전부 좌표가 있으면 1..n 연속이고 좌표가 그 장소의 것이다(완전 일치).
    expect(
      buildMustVisitPins({
        items,
        savedPlaces: [
          savedPlaceAt('poi-a', 35.1, 129.1),
          savedPlaceAt('poi-b', 35.2, 129.2),
          savedPlaceAt('poi-c', 35.3, 129.3),
        ],
      })
    ).toEqual([
      { number: 1, lat: 35.1, lng: 129.1 },
      { number: 2, lat: 35.2, lng: 129.2 },
      { number: 3, lat: 35.3, lng: 129.3 },
    ]);

    // ② 꼬리가 빠진다 — 3번이 없어지고 앞은 그대로.
    expect(
      buildMustVisitPins({
        items,
        savedPlaces: [
          savedPlaceAt('poi-a', 35.1, 129.1),
          savedPlaceAt('poi-b', 35.2, 129.2),
        ],
      }).map((pin) => pin.number)
    ).toEqual([1, 2]);

    // 🔴 ③ **가운데가 빠져도 뒤를 당기지 않는다.** 이것이 AC-2 의 급소다 — 재번호하면
    //    사용자가 지도 ② 를 누르고 카드 ② 를 기대할 때 다른 장소가 나온다(TRIP-297 AC-13 승계).
    const gap = buildMustVisitPins({
      items,
      savedPlaces: [
        savedPlaceAt('poi-a', 35.1, 129.1),
        savedPlaceAt('poi-c', 35.3, 129.3),
      ],
    });
    expect(gap.map((pin) => pin.number)).toEqual([1, 3]);
    expect(gap).toEqual([
      { number: 1, lat: 35.1, lng: 129.1 },
      { number: 3, lat: 35.3, lng: 129.3 },
    ]);
  });

  it('C7-b 담은 장소가 하나도 없으면 핀이 0개다 (지도 카드를 안 그릴 근거 · D9)', () => {
    const items = joinMustVisits({
      mustVisits: PIN_MUST_VISITS,
      savedPlaces: [],
    });
    expect(buildMustVisitPins({ items, savedPlaces: [] })).toEqual([]);
    // 짝 — 항목 자체는 살아 있다. 핀이 0개인 것과 목록이 빈 것은 다른 사실이다.
    expect(items).toHaveLength(3);
  });

  it('C7-c 입력 배열을 제자리에서 흔들지 않는다 (캐시 오염 금지)', () => {
    const savedPlaces = [savedPlaceAt('poi-a', 35.1, 129.1)];
    const items = joinMustVisits({ mustVisits: PIN_MUST_VISITS, savedPlaces });
    const beforeItems = JSON.parse(JSON.stringify(items));
    const beforeSaved = JSON.parse(JSON.stringify(savedPlaces));

    buildMustVisitPins({ items, savedPlaces });

    expect(items).toEqual(beforeItems);
    expect(savedPlaces).toEqual(beforeSaved);
  });
});

describe('C8 · 02a ★13 — 조인과 핀이 같은 입력에서 갈라지지 않는다', () => {
  it('이름을 못 얻은 항목의 번호는 핀에 없고, 이름을 얻은 항목의 번호는 전부 있다', () => {
    // 준비 — **한 벌의 입력**을 두 함수에 그대로 태운다. 조인 키 규칙이 두 함수에서 서로
    // 다르게 진화하면 이 케이스가 먼저 죽는다(좌표를 항목에 싣지 않은 대가를 여기서 치른다).
    const savedPlaces = [
      savedPlaceAt('poi-a', 35.1, 129.1),
      savedPlaceAt('poi-c', 35.3, 129.3),
    ];
    const input = { mustVisits: PIN_MUST_VISITS, savedPlaces };

    // 실행
    const items = joinMustVisits(input);
    const pins = buildMustVisitPins({ items, savedPlaces });
    const pinNumbers = pins.map((pin) => pin.number);

    // 단언 ① 두 수가 다른 것이 정상이다(AC-2 — 핀 수와 목록 수가 다를 수 있다).
    expect(items).toHaveLength(3);
    expect(pins).toHaveLength(2);

    // ② 이름이 없는 항목(= 담기를 푼 항목)의 번호는 핀에 없다.
    const unnamed = items
      .map((item, index) => ({ item, number: index + 1 }))
      .filter(({ item }) => item.name === null)
      .map(({ number }) => number);
    expect(unnamed).toEqual([2]);
    unnamed.forEach((number) => expect(pinNumbers).not.toContain(number));

    // ③ 짝 — 이름이 있는 항목의 번호는 **전부** 있다. 없으면 "핀을 아예 안 만드는" 구현이
    //    ② 를 공짜로 통과한다.
    const named = items
      .map((item, index) => ({ item, number: index + 1 }))
      .filter(({ item }) => item.name !== null)
      .map(({ number }) => number);
    expect(named).toEqual([1, 3]);
    expect(pinNumbers).toEqual(named);
  });
});
