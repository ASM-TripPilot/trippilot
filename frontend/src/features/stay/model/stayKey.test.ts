import { stayKey } from './stayKey';

/**
 * AC-6 · Q1(01b Seed) — stayKey 단일 출처.
 *
 * 무엇을 보장하나: `stayKey`가 `${externalSource}:${externalId}` 형태로 문자열을 합성하고,
 * 공급자(externalSource)가 다르면 externalId가 같아도 키가 갈라진다(충돌 방지). React 리스트
 * key와 카드 testID가 이 함수 하나에서만 나온다는 단일 출처 계약은 렌더 층
 * (`StaySearchScreen.test.tsx` it 2-2가 이 함수의 반환값으로 기대 testID를 역산하는 방식)과
 * 소스 층(`staySearchStructure.test.ts` it 4-4가 화면 소스에 `externalId` 리터럴 조립이 없음을
 * 확인하는 방식)이 이어서 잠근다 — 이 파일은 그 출발점인 함수 자체만 본다.
 *
 * PBT(fast-check) 미적용 — `frontend-components.md` §7의 PBT 대상 4건(resolveCoverage·
 * nightsSum·formatPrice·seedMustVisits)에 stayKey는 없다(02a §4 파일1 실측). 콜론 결합 한 줄에
 * 속성 테스트를 얹는 것은 근거 없는 선행 투자다.
 */

describe('stayKey — 공급자:외부ID 합성 (AC-6)', () => {
  it('externalSource와 externalId를 콜론으로 잇는다', () => {
    const item = { externalSource: 'NAVER', externalId: 'stay-1' };

    const key = stayKey(item);

    expect(key).toBe('NAVER:stay-1');
  });

  it('externalId가 같아도 externalSource가 다르면 키가 갈라진다 (Q1 충돌 방지)', () => {
    const naver = { externalSource: 'NAVER', externalId: 'x' };
    const yanolja = { externalSource: 'YANOLJA', externalId: 'x' };

    const keys = [stayKey(naver), stayKey(yanolja)];

    // 값 자체(형태)와 "서로 다르다"(충돌 방지 목적)를 각각 단언한다 — 값만 보면 왜 이
    // 형태여야 하는지가 테스트에서 사라지고, 다름만 보면 임의의 유일값 반환도 통과한다.
    expect(keys).toEqual(['NAVER:x', 'YANOLJA:x']);
    expect(keys[0]).not.toBe(keys[1]);
  });
});
