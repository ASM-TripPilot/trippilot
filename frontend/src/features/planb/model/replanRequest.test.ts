import { buildStartReplanRequest } from './replanRequest';

/**
 * TRIP-439 · AC-1·AC-3·D6 — i10 폼 값을 서버 `StartReplanRequest` 봉투로 조립하는 순수 빌더.
 *
 * 무엇을 보장하나 (이 사이클의 헤드라인 = 드리프트⑤):
 *  - 🔴 위치 입력이 없어도 `originKind: null` 을 **생략이 아니라 명시**로 싣는다
 *    (codegen `required:[scope, originKind]`, 값은 nullable). "생략"이면 tsc·계약 위반.
 *  - 🔴 `triggerId:null`(수동 진입)·`excludedPoiIds:[]`('건너뛰기'가 채우는 필드, i10 아님)를 항상 싣는다.
 *  - 🔴 사유·방향을 하나도 안 골라도 **제출된다**(빈 배열이 막지 않음, BR-U4-12).
 *
 * 3동작: 준비 = 폼 값 → 실행 = `buildStartReplanRequest` → 단언 = 나온 봉투.
 *
 * ★9 `toEqual` 은 `{}` vs `{originKind:null}` 을 **불일치**로 본다(받은 undefined ≠ 기대 null) —
 * 그래서 빌더가 originKind 를 빠뜨리면 red 다. 여기에 키 집합 완전일치를 더해 "키 존재 + 여분 0"
 * 을 이중으로 못 박는다.
 */

/** 반환 봉투의 정확한 키 7종(정렬본) — 여분 키 0·필수 키 존재를 함께 잠근다. */
const EXPECTED_KEYS = [
  'directives',
  'excludedPoiIds',
  'freeText',
  'originKind',
  'reasons',
  'scope',
  'triggerId',
];

describe('🔴 M1 · AC-1 — 선택값을 담아 조립한다 (originKind:null 명시 · D6)', () => {
  it('사유·방향·자유텍스트를 그대로 싣고 originKind/triggerId/excludedPoiIds 를 채운다', () => {
    // 준비 — 범위 기본(지금 이후) + 사유 2 + 방향 1 + 자유텍스트.
    const form = {
      scope: 'PARTIAL_SLOTS' as const,
      reasons: ['WEATHER', 'SLOW_MOVE'],
      directives: ['RELAX'],
      freeText: '광안리 야경',
    };

    // 실행
    const result = buildStartReplanRequest(form);

    // 단언 — 완전일치(여분 키가 있으면 red).
    expect(result).toEqual({
      scope: 'PARTIAL_SLOTS',
      originKind: null,
      reasons: ['WEATHER', 'SLOW_MOVE'],
      directives: ['RELAX'],
      freeText: '광안리 야경',
      excludedPoiIds: [],
      triggerId: null,
    });

    // originKind 가 "생략"이 아니라 "null" 임을 못 박는다(드리프트⑤ 헤드라인).
    expect(Object.keys(result).sort()).toEqual(EXPECTED_KEYS);
    expect(result.originKind).toBeNull();
  });
});

describe('🔴 M2 · AC-3 — 아무것도 안 골라도 제출된다 (BR-U4-12)', () => {
  it('빈 배열 + 빈 자유텍스트도 유효한 봉투가 된다(freeText 는 null)', () => {
    // 준비 — 칩·자유텍스트 미선택, 범위만 기본값.
    const form = {
      scope: 'PARTIAL_SLOTS' as const,
      reasons: [],
      directives: [],
      freeText: '',
    };

    // 실행 + 단언 — 빈 선택이 제출을 막지 않고, 빈 자유텍스트는 null 로 접힌다.
    expect(buildStartReplanRequest(form)).toEqual({
      scope: 'PARTIAL_SLOTS',
      originKind: null,
      reasons: [],
      directives: [],
      freeText: null,
      excludedPoiIds: [],
      triggerId: null,
    });
  });
});

describe('🔴 M3 · freeText 매핑 짝 앵커', () => {
  it('빈 문자열은 null 로, 내용이 있으면 그대로 싣는다', () => {
    const base = {
      scope: 'FULL_DAY' as const,
      reasons: [],
      directives: [],
    };
    // 빈 → null
    expect(
      buildStartReplanRequest({ ...base, freeText: '' }).freeText
    ).toBeNull();
    // 내용 → 그대로(트림 안 함 — 과잉 명세 회피)
    expect(
      buildStartReplanRequest({ ...base, freeText: '실내로' }).freeText
    ).toBe('실내로');
  });
});
