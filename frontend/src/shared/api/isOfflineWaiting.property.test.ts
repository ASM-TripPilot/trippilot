import fc from 'fast-check';

import { isOfflineWaiting } from './isOfflineWaiting';

/**
 * TRIP-1638 · `isOfflineWaiting` — 어떤 입력에서도 지키는 성질.
 *
 * *(개념)* 속성 테스트 = 예시 몇 개가 아니라 무작위 입력 수백 개에 같은 규칙이 맞는지 보는 테스트.
 * 기대식은 구현(`data === undefined && fetchStatus === 'paused'`)을 베끼지 않고 다른 모양으로 적는다.
 *
 * 무엇을 보장하나: P1 받아 본 값이 있으면 항상 false · P2 paused 가 아니면 항상 false(임의 문자열 포함) ·
 * P3 data 가 없을 때 결과는 정확히 "paused 인가"와 같다.
 */

const received = fc.anything().filter((value) => value !== undefined);
const knownStatus = fc.constantFrom(
  ...(['fetching', 'paused', 'idle'] as const)
);

describe('isOfflineWaiting — 성질', () => {
  it('P1 data 가 undefined 가 아니면 어떤 fetchStatus 에서도 false 다', () => {
    fc.assert(
      fc.property(received, knownStatus, (data, fetchStatus) => {
        expect(isOfflineWaiting({ data, fetchStatus })).toBe(false);
      })
    );
  });

  it('P2 fetchStatus 가 paused 가 아니면 어떤 data 에서도 false 다 (알 수 없는 문자열 포함)', () => {
    fc.assert(
      fc.property(
        fc.anything(),
        fc.string().filter((s) => s !== 'paused'),
        (data, fetchStatus) => {
          expect(
            isOfflineWaiting({
              data,
              fetchStatus: fetchStatus as 'fetching',
            })
          ).toBe(false);
        }
      )
    );
  });

  it('P3 data 가 없으면 결과는 정확히 "paused 인가"이다', () => {
    fc.assert(
      fc.property(knownStatus, (fetchStatus) => {
        const expected = ['paused'].includes(fetchStatus);
        expect(isOfflineWaiting({ data: undefined, fetchStatus })).toBe(
          expected
        );
      })
    );
  });
});
