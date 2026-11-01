import { isOfflineWaiting } from './isOfflineWaiting';

/**
 * TRIP-1638 · 오프라인 콜드스타트 판독 — **"받아 본 적 없는 데이터를, 요청이 보류된 채 기다리는 중"** 인 쿼리만 true.
 *
 * 왜 이 함수에 심판이 필요한가: 화면은 `isPending` 으로 스켈레톤을 고르는데, 오프라인으로 처음 켜면 요청이 나가지도 않은 채
 * `status pending + fetchStatus paused` 가 되어 스켈레톤이 영원히 남는다. 이 함수가 그 상태만 골라내야 한다.
 * 너무 넓으면(데이터만 보면) 온라인 로딩·꺼진 쿼리까지 "오프라인"이라 거짓말하고, 너무 좁으면(데이터 있는 paused 포함)
 * 이미 받은 목록을 오프라인 안내로 덮는다.
 *
 * *(개념 — fetchStatus)* `fetching` 요청이 나가는 중 · `paused` 나가야 하는데 인터넷이 없어 보류 · `idle` 요청이 없다
 * (꺼진 쿼리 포함). status(데이터를 받아 봤나)와는 별개 축이다.
 *
 * 3동작 뼈대: 준비=쿼리 결과 모양 객체 → 실행=판독 → 단언=참/거짓. 형태는 `isNotFound.test.ts` 선례.
 */

type Query = Parameters<typeof isOfflineWaiting>[0];

describe('받아 본 데이터가 없고 요청이 보류됐을 때만 true (AC-0)', () => {
  it('U1 data 없음 + paused 는 true 다 (긍정 앵커)', () => {
    expect(isOfflineWaiting({ data: undefined, fetchStatus: 'paused' })).toBe(
      true
    );
  });

  // 같은 모양 5칸: 진리표의 나머지. "하나라도 true 면 안 된다"를 각각 이름으로 읽히게 한다.
  it.each<[string, Query]>([
    [
      'data 없음 + fetching(온라인 로딩 — 스켈레톤이 정상)',
      { data: undefined, fetchStatus: 'fetching' },
    ],
    [
      'data 없음 + idle(꺼진 쿼리 — 기존 비활성 판정을 건드리지 않는다)',
      { data: undefined, fetchStatus: 'idle' },
    ],
    [
      'data 있음 + paused(받아 둔 목록은 오프라인이어도 그대로 보인다)',
      { data: [{ id: 1 }], fetchStatus: 'paused' },
    ],
    ['data 있음 + fetching', { data: [{ id: 1 }], fetchStatus: 'fetching' }],
    ['data 있음 + idle', { data: [{ id: 1 }], fetchStatus: 'idle' }],
  ])('U2 %s → false', (_label, query) => {
    expect(isOfflineWaiting(query)).toBe(false);
  });

  // *(개념)* `=== undefined` 는 "값이 없다"만 잡는다. 서버가 준 빈 목록·null·0 은 **받아 본 값**이다 —
  // `!data` 로 쓰면 빈 여행 목록(`[]`)이 "아직 못 받음"으로 오판돼 "아직 만든 여행이 없어요"가 오프라인 안내로 덮인다.
  it.each<[string, unknown]>([
    ['빈 배열', []],
    ['null', null],
    ['0', 0],
    ['빈 문자열', ''],
    ['false', false],
  ])('U3 받아 본 값이 %s 이면 paused 여도 false 다', (_label, data) => {
    expect(isOfflineWaiting({ data, fetchStatus: 'paused' })).toBe(false);
  });

  it('U4 fetchStatus 가 아예 없는 입력(옛 훅 목 모양)은 false 다 — 기존 목 기반 테스트가 오프라인으로 오판되지 않는다', () => {
    expect(isOfflineWaiting({ data: undefined } as Query)).toBe(false);
  });
});
