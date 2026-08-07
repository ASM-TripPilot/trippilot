import fc from 'fast-check';

import type { Place, SavedPlace } from '@/shared/api/generated/schemas';

import {
  MUST_VISIT_THUMBNAIL_LIMIT,
  mergeMustVisitSeeds,
  mustVisitFailureNotice,
  resolveMustVisitSection,
  seedMustVisits,
  type MustVisitSeedItem,
} from './mustVisitSeed';

/**
 * TRIP-209 AC-1~AC-4 · AC-11 · 01b D5·D9 — '꼭 갈 곳' 섹션의 **순수 판정 3종**.
 *
 * 무엇을 보장하나:
 *  - `seedMustVisits` 가 담은 장소를 **복사본**으로 옮기되 같은 장소를 두 번 담지 않고,
 *    원본 배열을 손대지 않는다(BR-U1-37 · frontend-components.md §7 PBT 대상).
 *  - `resolveMustVisitSection` 이 네 얼굴(로딩 · 시드됨 · 0곳 · 조회실패)을 가르되,
 *    **조회 실패 얼굴과 0곳 얼굴이 반드시 다르고**(01b D5), 실패·로딩이 **이미 받아 둔 시드를
 *    덮지 않는다**(미해결 문제로그 `2026-08-04 화면 얼굴 전환이 잔존 목록을 지운다`).
 *  - 등록 실패 배너 문구가 시도·실패 **건수를 둘 다** 말하고, 여행 생성 실패 어휘를 쓰지 않는다.
 *
 * 왜 순수 함수인가: 이 판정들이 화면 안에 있으면 "3건일 때"·"실패일 때"를 보려고 매번 화면을
 * 그려야 하고, 조합을 다 태우지 못한다. 화면은 **결과 얼굴만** 받는다(01b §5-3 화면 경계).
 *
 * 개념 두 가지.
 *  - **PBT(속성 기반 테스트)**: 예제를 손으로 적는 대신 "어떤 입력에도 참인 성질"을 적으면
 *    fast-check 가 임의 입력 수백 개로 반례를 찾는다. 리포 CI 의 **차단 게이트**다.
 *  - **가짜 통과 방지 짝**: `() => []` 는 "중복 없음"도 "원본 불변"도 만족한다. 그래서 성질마다
 *    "결과가 실제로 채워진다"는 긍정 짝을 같은 it 안에 함께 건다.
 *
 * ⚠️ poiId 를 `fc.uuid()` 로 뽑으면 **500회에서 중복이 한 번도 안 나온다**(02a §5-2 실측).
 * 그러면 "중복 sourcePoiId 없음" 성질은 dedup 를 안 하는 구현도 통과시키는 공허한 문장이 된다.
 * 아래는 **4개짜리 작은 풀**에서 뽑고, "생성된 입력에 중복이 실제로 있었다"를 메타 단언으로 남긴다.
 *
 * 3동작 뼈대: 준비=담은 장소 배열/판정 입력 → 실행=함수 호출 → 단언=결과 값.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** 복사본 성질(BR-U1-37)과 얼굴 구분(INV-4)은 이 섹션이 사는 한 유효하고,
 * 모집단이 임의 입력이라 항목이 늘어도 갱신이 필요 없다.
 * **B. 이행 체크포인트 — 한시적.** 썸네일 상한 3(01b D9)은 **가정**이고 배너·실패 문구는 발명이다.
 * **B 카운터 = 0.** 정당한 문구·상한 변경이 2회 red 를 내면 N1-6·N1-7 의 숫자 단언과 N1-10 의
 * 리터럴을 "두 숫자를 포함한다"·"상한을 넘지 않는다"만 남기고 뗀다.
 */

/** 계약 `Place.required` 를 그대로 채운 최소 Place — 상상해서 만들지 않는다. */
function makePlace(poiId: string, overrides: Partial<Place> = {}): Place {
  return {
    poiId,
    nameKo: `장소-${poiId}`,
    category: '명소',
    lat: 35.1587,
    lng: 129.1604,
    region: '수영구',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
    ...overrides,
  };
}

function savedPlace(
  savedPlaceId: string,
  poiId: string,
  placeOverrides: Partial<Place> = {}
): SavedPlace {
  return {
    savedPlaceId,
    savedAt: '2026-08-01T10:00:00.000Z',
    place: makePlace(poiId, placeOverrides),
  };
}

function seedItem(sourcePoiId: string, name = `장소-${sourcePoiId}`) {
  return { sourcePoiId, name, imageUrl: null };
}

/** 값 스냅숏 — 호출 전후 비교용(참조가 아니라 **값**이 그대로인지 본다). */
function snapshot(value: unknown): string {
  return JSON.stringify(value);
}

describe('N1 · seedMustVisits — 예제 (AC-1 · AC-3 · BR-U1-37)', () => {
  it('N1-1 담은 장소를 시드 항목으로 옮기고, 사진이 없으면 null 을 그대로 둔다', () => {
    // 준비 — 사진이 있는 것과 없는 것을 섞는다. 프로덕션 데이터는 현재 전부 null 이라
    // (exploreFixtures 주석) null 쪽이 늘 타는 경로다.
    const given: SavedPlace[] = [
      savedPlace('sp-1', 'poi-1', {
        nameKo: '감천마을',
        imageUrl: 'https://cdn.example.com/a.jpg',
      }),
      savedPlace('sp-2', 'poi-2', { nameKo: '광안리', imageUrl: null }),
      savedPlace('sp-3', 'poi-3', { nameKo: '전포' }),
    ];

    // 실행
    const seeds = seedMustVisits(given);

    // 단언 — 이름은 `nameKo`, 식별자는 `poiId`(등록 요청의 poiId 이자 testID 꼬리),
    // 사진은 있으면 그 값 없으면 null. **기본 이미지를 지어내지 않는다**(계약 주석 명시).
    expect(seeds).toEqual([
      {
        sourcePoiId: 'poi-1',
        name: '감천마을',
        imageUrl: 'https://cdn.example.com/a.jpg',
      },
      { sourcePoiId: 'poi-2', name: '광안리', imageUrl: null },
      { sourcePoiId: 'poi-3', name: '전포', imageUrl: null },
    ]);
  });

  it('N1-2 같은 장소가 두 행으로 와도 한 번만 담고 첫 등장 순서를 지킨다', () => {
    // 준비 — `savedPlaceId` 는 다른데 `poiId` 가 같은 두 행(다른 기기에서 담은 것이 겹치는 등).
    const given: SavedPlace[] = [
      savedPlace('sp-a', 'poi-1', { nameKo: '감천마을' }),
      savedPlace('sp-b', 'poi-2', { nameKo: '광안리' }),
      savedPlace('sp-c', 'poi-1', { nameKo: '감천마을' }),
    ];

    const seeds = seedMustVisits(given);

    // 같은 여행에 같은 장소를 두 번 넣을 수 없다(BR-U1-50 · INV-U1-18) — 서버가 409 로
    // 막기 전에 클라가 애초에 두 번 보내지 않는다.
    expect(seeds.map((seed) => seed.sourcePoiId)).toEqual(['poi-1', 'poi-2']);
  });

  it('N1-3 빈 목록은 빈 시드다 (0곳 얼굴의 입력)', () => {
    expect(seedMustVisits([])).toEqual([]);
  });
});

describe('N1 · seedMustVisits — 성질 (PBT · AC-11 · 차단 게이트)', () => {
  /** ⚠️ **작은 풀**이라야 중복이 실제로 생성된다(02a §5-2 · ★8). */
  const poiIdArb = fc.constantFrom('poi-1', 'poi-2', 'poi-3', 'poi-4');
  const savedPlaceArb = fc
    .record({ savedPlaceId: fc.uuid(), poiId: poiIdArb })
    .map(({ savedPlaceId, poiId }) => savedPlace(savedPlaceId, poiId));
  const listArb = fc.array(savedPlaceArb, { maxLength: 10 });

  it('N1-4 중복 없이 옮기고, 없던 장소를 지어내지도 흘리지도 않는다', () => {
    // 메타 관찰 — 이 PBT 가 **중복을 실제로 태웠는가**. 없으면 성질이 공허하다.
    let sawDuplicateInput = false;
    let sawNonEmptyResult = false;

    fc.assert(
      fc.property(listArb, (given) => {
        const inputIds = given.map((entry) => entry.place.poiId);
        if (new Set(inputIds).size !== inputIds.length) {
          sawDuplicateInput = true;
        }

        const seeds = seedMustVisits(given);
        const seedIds = seeds.map((seed) => seed.sourcePoiId);
        if (seeds.length > 0) sawNonEmptyResult = true;

        // ① 중복 없음 — frontend-components.md §7 의 성질 그대로.
        expect(new Set(seedIds).size).toBe(seedIds.length);
        // ② 긍정 짝 — **개수가 맞는다.** 이게 없으면 `() => []` 가 ①을 공짜로 통과한다.
        expect(seedIds.length).toBe(new Set(inputIds).size);
        // ③ 지어내지 않는다 — 결과의 모든 id 가 입력에 있던 것이다(INV-1 계열 규율).
        seedIds.forEach((id) => expect(inputIds).toContain(id));
      }),
      { numRuns: 500 }
    );

    expect({ sawDuplicateInput, sawNonEmptyResult }).toEqual({
      sawDuplicateInput: true,
      sawNonEmptyResult: true,
    });
  });

  it('N1-5 원본 배열을 변형하지 않는다 (시드는 복사다 · BR-U1-37)', () => {
    fc.assert(
      fc.property(listArb, (given) => {
        const before = snapshot(given);

        const seeds = seedMustVisits(given);

        // TanStack Query 캐시가 준 배열을 제자리에서 흔들면 참조가 그대로라 리렌더 통지가
        // 새고, 화면이 옛 목록으로 남는다(`orderSavedPlaces` 가 세운 리포 관례).
        expect(snapshot(given)).toBe(before);
        // 긍정 짝 — 그렇다고 아무 일도 안 한 것은 아니다.
        expect(seeds.length).toBe(
          new Set(given.map((e) => e.place.poiId)).size
        );
      }),
      { numRuns: 500 }
    );
  });
});

describe('N1 · resolveMustVisitSection — 얼굴 판정 (01b D5 · D9)', () => {
  const twoSeeds: MustVisitSeedItem[] = [seedItem('poi-1'), seedItem('poi-2')];

  it('N1-6 시드가 있으면 썸네일과 접힌 개수를 함께 준다 (D9 — 상한 3)', () => {
    // 준비 — 5건. Figma 가 보여준 유일한 형태가 "썸네일 3 + `+2`" 다.
    const seeds = [1, 2, 3, 4, 5].map((n) => seedItem(`poi-${n}`));

    const view = resolveMustVisitSection({
      seeds,
      loading: false,
      failed: false,
    });

    expect(view).toEqual({
      kind: 'seeded',
      thumbnails: seeds.slice(0, 3),
      overflowCount: 2,
    });
    // 상한이 상수로 노출돼 있다 — 뒤집히면 여기 한 줄과 N1-7 만 바뀐다(02a ★13).
    expect(MUST_VISIT_THUMBNAIL_LIMIT).toBe(3);
  });

  it('N1-7 경계 — 3건은 접지 않고, 4건이면 3장 + 1개를 접는다 (D9 가정)', () => {
    const three = [1, 2, 3].map((n) => seedItem(`poi-${n}`));
    const four = [1, 2, 3, 4].map((n) => seedItem(`poi-${n}`));

    const viewThree = resolveMustVisitSection({
      seeds: three,
      loading: false,
      failed: false,
    });
    const viewFour = resolveMustVisitSection({
      seeds: four,
      loading: false,
      failed: false,
    });

    expect(viewThree).toEqual({
      kind: 'seeded',
      thumbnails: three,
      overflowCount: 0,
    });
    expect(viewFour).toEqual({
      kind: 'seeded',
      thumbnails: four.slice(0, 3),
      overflowCount: 1,
    });
  });

  it('🔴 N1-8 조회가 실패해도, 로딩 중이어도 이미 받아 둔 시드를 덮지 않는다', () => {
    // ⚠️ 미해결 문제로그 `2026-08-04 화면 얼굴 전환이 잔존 목록을 지운다`(TRIP-222·223 에서
    // 2회 반복)의 재발 방지 심판이다. 첫 손이 자연스럽게 쓰는 `if (failed) return 실패얼굴`
    // 한 줄이 이미 보여주던 썸네일을 지운다 — **성공 경로만 태우는 테스트는 원리적으로 못 본다.**
    const whenFailed = resolveMustVisitSection({
      seeds: twoSeeds,
      loading: false,
      failed: true,
    });
    const whenLoading = resolveMustVisitSection({
      seeds: twoSeeds,
      loading: true,
      failed: false,
    });

    expect(whenFailed).toEqual({
      kind: 'seeded',
      thumbnails: twoSeeds,
      overflowCount: 0,
    });
    expect(whenLoading).toEqual({
      kind: 'seeded',
      thumbnails: twoSeeds,
      overflowCount: 0,
    });
  });

  it('🔴 N1-9 시드가 없을 때 로딩·조회실패·0곳이 서로 다른 얼굴로 갈린다 (D5 · INV-4)', () => {
    const loading = resolveMustVisitSection({
      seeds: [],
      loading: true,
      failed: false,
    });
    const failed = resolveMustVisitSection({
      seeds: [],
      loading: false,
      failed: true,
    });
    const empty = resolveMustVisitSection({
      seeds: [],
      loading: false,
      failed: false,
    });

    expect(loading).toEqual({ kind: 'loading' });
    expect(failed).toEqual({ kind: 'failed' });
    expect(empty).toEqual({ kind: 'empty' });

    // ★ 이 한 줄이 D5 의 전부다 — 조회 실패를 0곳으로 떨어뜨리면 담아 둔 게 있는 사용자에게
    // "담은 게 없다"는 **거짓말**을 하게 된다(실제로는 못 불러온 것이다).
    expect(failed).not.toEqual(empty);
  });
});

/**
 * ─── TRIP-288 추가분 (N1-11 ~ N1-14) ───────────────────────────────────────────
 *
 * `mergeMustVisitSeeds` — 시드의 **재시드 규칙**. 담은 목록이 늘어난 채 화면이 다시 그려질 때
 * 무엇을 더하고 무엇을 안 더하는가를 이 함수 하나가 정한다(01b D2 · D7 · D8 · D11).
 *
 * 네 성질을 동시에 진다:
 *  ① `current` 를 **접두사로** 그대로 보존한다 — 담은 목록 순서로 재정렬하지 않는다(D11).
 *  ② `current` 에도 `excluded` 에도 없는 것만 **뒤에** 이어 붙인다(D2 · D7).
 *  ③ `incoming` 에서 사라진 항목을 **빼지 않는다** — 시드는 복사본이다(D8 · 동결 N4-6).
 *  ④ 더할 게 없으면 **`current` 와 같은 배열 참조**를 그대로 돌려준다(01b 제약 11).
 *
 * 🔴 왜 ④가 급소인가 — 재시드는 `TripNewStep1Page` 의 `mustVisitsInitialized` 가드를 **푼다**.
 * 그 순간 `savedPlaces.savedPlaces` 가 게스트·미도착에서 **매 렌더 새 빈 배열**을 내는 성질이
 * 살아나, 내용이 같아도 새 배열을 돌려주면 렌더 → 효과 → 상태 교체 → 렌더의 무한 루프가 된다.
 * 실측(02a §5 P3): 그 구현은 `render()` 자체가 `Maximum update depth exceeded` 로 던진다.
 * 순수 층(N1-13) · 스토어 층(N2-9) · 화면 층(N4-12) 세 군데에 심판을 나눠 박는다 —
 * 이 함수가 참조를 지켜도 스토어가 `[...next]` 로 감싸면 루프가 그대로 살기 때문이다.
 *
 * ── 졸업 조건 ── **A. 영구 규칙 — 유지한다.** 재정렬 금지·빼기 금지·참조 안정은 시드가 사는 한
 * 유효하고, 항목이 늘어도 갱신이 필요 없다.
 */
describe('N1 · mergeMustVisitSeeds — 재시드 규칙 (TRIP-288 AC-2 · AC-3 · AC-4)', () => {
  it('🔴 N1-11 새 것은 맨 뒤에 붙고, 기존 순서는 안 흔들리고, 사라진 것은 남는다', () => {
    // 준비 — `current` 를 담은 목록과 **일부러 다른 순서**로 둔다(재정렬하는 구현을 잡는다).
    // `incoming` 에는 `poi-2` 가 없다 — 사용자가 탐색에서 그 담기를 풀었다는 뜻이다.
    const current = [seedItem('poi-2'), seedItem('poi-1')];
    const incoming = [seedItem('poi-1'), seedItem('poi-3')];

    const merged = mergeMustVisitSeeds({ current, incoming, excluded: [] });

    // ① 재정렬 없음 ② 새 것(`poi-3`)은 맨 뒤 ③ `incoming` 에서 빠진 `poi-2` 는 **남는다**
    expect(merged.map((seed) => seed.sourcePoiId)).toEqual([
      'poi-2',
      'poi-1',
      'poi-3',
    ]);
    // 기존 항목을 새로 만들어 갈아 끼우지 않는다 — 같은 객체 그대로다.
    expect(merged[0]).toBe(current[0]);
  });

  it('🔴 N1-12 뺀 곳은 다시 안 들어오고, 같이 온 새 곳은 들어온다', () => {
    // 준비 — 사용자가 x 로 뺀 `poi-2` 는 **여전히 담은 목록에 있다**(담기와 시드는 독립이다).
    const current = [seedItem('poi-1')];
    const incoming = [seedItem('poi-1'), seedItem('poi-2'), seedItem('poi-3')];

    const merged = mergeMustVisitSeeds({
      current,
      incoming,
      excluded: ['poi-2'],
    });

    // 부정(`poi-2` 없음)과 긍정(`poi-3` 들어옴)이 한 단언 안에 있다 — 뒤가 없으면
    // "아무것도 안 더하는" 구현이 통과한다.
    expect(merged.map((seed) => seed.sourcePoiId)).toEqual(['poi-1', 'poi-3']);
  });

  it('🔴 N1-13 더할 게 없으면 같은 배열을 그대로 돌려준다 (렌더 루프 차단)', () => {
    const current = [seedItem('poi-1'), seedItem('poi-2')];

    // ① 같은 목록이 다시 왔다(재조회·리렌더가 늘 이 모양이다).
    expect(
      mergeMustVisitSeeds({ current, incoming: [...current], excluded: [] })
    ).toBe(current);

    // ② 비회원·빈 목록 — 여기가 루프가 가장 잘 나는 자리다.
    const empty: MustVisitSeedItem[] = [];
    expect(
      mergeMustVisitSeeds({ current: empty, incoming: [], excluded: [] })
    ).toBe(empty);

    // ③ 짝(긍정) — 더할 게 있으면 **다른** 배열이 나온다. 없으면 "항상 current 를 돌려주는"
    //    구현이 ①②를 공짜로 통과한다.
    const grown = mergeMustVisitSeeds({
      current,
      incoming: [...current, seedItem('poi-3')],
      excluded: [],
    });
    expect(grown).not.toBe(current);
    expect(grown).toHaveLength(3);
  });

  it('🔴 N1-14 임의 입력에서도 네 성질이 동시에 선다 (PBT)', () => {
    // ⚠️ **작은 풀**이라야 current·incoming·excluded 가 실제로 겹친다(02a ★5).
    const poiIdArb = fc.constantFrom('poi-1', 'poi-2', 'poi-3', 'poi-4');
    const uniqueSeedsArb = fc
      .array(poiIdArb, { maxLength: 6 })
      .map((ids): MustVisitSeedItem[] =>
        [...new Set<string>(ids)].map((id) => seedItem(id))
      );
    // ⚠️ `fc.constantFrom` 은 **리터럴 유니온**을 준다 — `string[]` 으로 넓히지 않으면
    // `excluded.includes(id)` 가 "string 을 유니온 자리에 넣었다"로 tsc 에서 죽는다.
    const excludedArb = fc
      .array(poiIdArb, { maxLength: 3 })
      .map((ids): string[] => [...new Set<string>(ids)]);

    // 메타 관찰 — 이 PBT 가 **더하기와 제외를 실제로 태웠는가**. 없으면 성질이 공허하다.
    let sawAppended = false;
    let sawExclusionBlock = false;

    fc.assert(
      fc.property(
        uniqueSeedsArb,
        uniqueSeedsArb,
        excludedArb,
        (current, incoming, excluded) => {
          const merged = mergeMustVisitSeeds({ current, incoming, excluded });
          const currentIds = current.map((seed) => seed.sourcePoiId);
          const incomingIds = incoming.map((seed) => seed.sourcePoiId);
          const mergedIds = merged.map((seed) => seed.sourcePoiId);
          const appendedIds = mergedIds.slice(current.length);

          if (appendedIds.length > 0) sawAppended = true;
          if (
            incomingIds.some(
              (id) => excluded.includes(id) && !currentIds.includes(id)
            )
          ) {
            sawExclusionBlock = true;
          }

          // ① 기존 시드가 앞에 그대로 있다(순서·내용 보존 · 빼기 금지).
          expect(mergedIds.slice(0, current.length)).toEqual(currentIds);
          // ② 같은 장소가 두 번 들어가지 않는다(BR-U1-50 — 서버 409 전에 클라가 막는다).
          expect(new Set(mergedIds).size).toBe(mergedIds.length);
          // ③ 새로 붙은 부분에 제외된 곳이 하나도 없다.
          appendedIds.forEach((id) => expect(excluded).not.toContain(id));
          // ④ 없던 장소를 지어내지 않는다.
          mergedIds.forEach((id) =>
            expect([...currentIds, ...incomingIds]).toContain(id)
          );
          // ⑤ 멱등 — 결과를 같은 입력으로 다시 태우면 **같은 참조**가 나온다(루프 차단의 성질판).
          expect(
            mergeMustVisitSeeds({ current: merged, incoming, excluded })
          ).toBe(merged);
        }
      ),
      { numRuns: 500 }
    );

    expect({ sawAppended, sawExclusionBlock }).toEqual({
      sawAppended: true,
      sawExclusionBlock: true,
    });
  });
});

describe('N1 · mustVisitFailureNotice — 등록 실패 배너 본문 (01b D4 · INV-4)', () => {
  it('N1-10 시도·실패 건수를 둘 다 말하고, 여행 생성 실패 어휘를 쓰지 않는다', () => {
    const notice = mustVisitFailureNotice(3, 1);

    // 긍정 — 문구가 실제로 채워져 있고 두 숫자가 다 보인다(D4: "건수를 센다").
    // ⚠️ `toContain` 은 부분 포함이다 — `toHaveTextContent('…')` 의 완전 일치와 다르다(02a ★9).
    expect(notice.length).toBeGreaterThan(0);
    expect(notice).toContain('3');
    expect(notice).toContain('1');

    // 부정 — **여행 생성 실패로 읽히면 안 된다.** 사용자가 "여행이 안 만들어졌다"고 믿고
    // 다시 시도하면 여행이 하나 더 생긴다(되돌릴 수 없다 · 02a ★3 · 01b D2).
    expect(notice).not.toMatch(/여행을 만들지|여행 만들기 실패|다시 만들/);

    // 짝 — 숫자가 바뀌면 문구도 따라 바뀐다(고정 문자열을 돌려주는 구현 차단).
    expect(mustVisitFailureNotice(5, 2)).not.toBe(notice);
  });
});
