/**
 * @jest-environment node
 *
 * TRIP-689 · AC-2 주 심판 — 저장목록을 여행 지역으로 거르는 순수함수.
 *
 * 무엇을 보장하나:
 *  - `regions`가 비면 저장목록을 **그대로** 돌려준다(무필터).
 *  - place의 지역이 어떤 여행 지역과 **양방향 접두사**로 겹치면 표시, 아니면 숨김.
 *  - **fail-open**: place 지역이 null·빈값이거나 확신 매칭이 안 되는 애매값은 **숨기지 않는다**
 *    (담아둔 장소를 잘못 감추는 것이 최악이라는 제품 결정, 01b OQ-2·OQ-4).
 *
 * 준비(Arrange)→실행(Act)→단언(Assert) 3동작으로 쓴다. 순수함수라 렌더·네트워크가 없다.
 *
 * ★ 급소(C8): 빈 여행 지역(`''`)은 매칭 근거가 **못 된다**. `'경주시'.startsWith('')`는 true라,
 *   빈 지역을 매칭에 태우면 필터가 통째 no-op이 된다 — 함수는 `t === ''`를 걸러야 한다(02a ★3).
 * ★ 양방향(C3): place가 여행 지역보다 **짧아도** 매칭된다(place '부산' ⊂ trip '부산광역시', 02a ★2).
 */
import fs from 'fs';
import path from 'path';

import type { Place, SavedPlace } from '@/shared/api/generated/schemas';

import { filterSavedPlacesByTripRegions } from './filterSavedPlacesByTripRegions';

/** region 하나만 바꿔 SavedPlace를 만든다 — 필터는 `place.region`만 본다. */
function saved(poiId: string, region: string | null): SavedPlace {
  const place: Place = {
    poiId,
    nameKo: poiId,
    category: '명소',
    lat: 35.1587,
    lng: 129.1604,
    region,
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
  };
  return {
    savedPlaceId: `sp-${poiId}`,
    savedAt: '2026-08-01T00:00:00.000Z',
    place,
  };
}

/** 반환된 목록의 poiId만 뽑아 순서까지 한 번에 비교한다. */
function poiIds(list: SavedPlace[]): string[] {
  return list.map((one) => one.place.poiId);
}

describe('filterSavedPlacesByTripRegions · AC-2 지역 필터(양방향 접두사 + fail-open)', () => {
  it('C1 · regions가 비면 저장목록을 그대로 돌려준다(무필터)', () => {
    const list = [
      saved('a', '부산광역시'),
      saved('b', '경주시'),
      saved('c', null),
    ];

    const result = filterSavedPlacesByTripRegions(list, []);

    expect(result).toEqual(list);
  });

  it('C2 · place 지역이 여행 지역으로 시작하면 표시한다(place가 더 김·접두사)', () => {
    // trip "부산광역시" ⊂ place "부산광역시 해운대구" → 같은 지역으로 본다.
    const result = filterSavedPlacesByTripRegions(
      [saved('a', '부산광역시 해운대구')],
      ['부산광역시']
    );

    expect(poiIds(result)).toEqual(['a']);
  });

  it('C3 · 양방향 — 여행 지역이 place 지역으로 시작해도 표시한다(place가 더 짧음)', () => {
    // place "부산" ⊂ trip "부산광역시" → 매칭. 한 방향만 보면 놓친다(02a ★2).
    const result = filterSavedPlacesByTripRegions(
      [saved('a', '부산')],
      ['부산광역시']
    );

    expect(poiIds(result)).toEqual(['a']);
  });

  it('C4 · 지역 밖 place는 숨긴다', () => {
    const result = filterSavedPlacesByTripRegions(
      [saved('a', '경주시')],
      ['부산광역시']
    );

    expect(result).toHaveLength(0);
  });

  it('C5 · fail-open — place 지역이 null이면 표시한다(잘못 감추지 않음)', () => {
    const result = filterSavedPlacesByTripRegions(
      [saved('a', null)],
      ['부산광역시']
    );

    expect(poiIds(result)).toEqual(['a']);
  });

  it('C6 · fail-open — place 지역이 빈/공백 문자열이면 표시한다(trim 후 빈값)', () => {
    const result = filterSavedPlacesByTripRegions(
      [saved('a', '   ')],
      ['부산광역시']
    );

    expect(poiIds(result)).toEqual(['a']);
  });

  it('C7 · 양쪽 공백을 trim한 뒤 매칭한다', () => {
    const result = filterSavedPlacesByTripRegions(
      [saved('a', ' 부산광역시 해운대구 ')],
      [' 부산광역시 ']
    );

    expect(poiIds(result)).toEqual(['a']);
  });

  it('C8 · 급소 — 빈 여행 지역("")은 매칭 근거가 못 된다(실지역 place는 숨김)', () => {
    // `'경주시'.startsWith('')`는 true라, 빈 지역을 걸러내지 않으면 모든 place가 통과해 필터가 죽는다.
    const result = filterSavedPlacesByTripRegions([saved('a', '경주시')], ['']);

    expect(result).toHaveLength(0);
  });

  it('C9 · 혼합 목록에서 지역 안·fail-open만 남기고 원래 순서를 지킨다', () => {
    const list = [
      saved('in', '부산광역시 해운대구'), // 접두사 매칭 → 표시
      saved('out', '경주시'), //            지역 밖 → 숨김
      saved('nul', null), //                fail-open → 표시
      saved('in2', '부산광역시 수영구'), //  접두사 매칭 → 표시
    ];

    const result = filterSavedPlacesByTripRegions(list, ['부산광역시']);

    expect(poiIds(result)).toEqual(['in', 'nul', 'in2']);
  });
});

/**
 * 페이지 인라인 금지 계약(02a ★5) — 주 심판은 이 순수함수다. 페이지가 필터를 인라인 복제하면
 * 이 파일이 죽은 코드를 검증하게 되므로, 파일이 정본 경로에 실재하고 `SavedPlacesPage`가 그것을
 * 참조하는지를 소스로 확인한다. 행동 증명(페이지가 실제로 필터함)은 통합 테스트가 별도로 잠근다.
 */
describe('구조 앵커 · 순수함수는 정본 경로에 있고 페이지가 그것을 참조한다', () => {
  const ROOT = path.resolve(__dirname, '../../../..'); // → frontend/
  const FN_PATH = path.join(
    ROOT,
    'src/features/explore/model/filterSavedPlacesByTripRegions.ts'
  );
  const PAGE_PATH = path.join(
    ROOT,
    'src/pages/saved-places/ui/SavedPlacesPage.tsx'
  );

  it('순수함수 파일이 정본 경로에 존재한다', () => {
    expect(fs.existsSync(FN_PATH)).toBe(true);
  });

  it('SavedPlacesPage가 filterSavedPlacesByTripRegions를 참조한다(인라인 아님)', () => {
    const source = fs.readFileSync(PAGE_PATH, 'utf8');
    expect(source).toContain('filterSavedPlacesByTripRegions');
  });
});
