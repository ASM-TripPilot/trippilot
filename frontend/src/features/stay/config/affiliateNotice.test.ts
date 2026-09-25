import { otaConfirmLabel } from './affiliateNotice';

/**
 * TRIP-781 AC-3 · 01b — 제휴 고지의 [이동] 버튼 라벨 사전.
 *
 * (TRIP-778 D2: "다시 보지 않기" 저장 키 C1 은 저장처가 서버 `/me/settings` 로 옮겨 키 자체가 사라져 삭제.
 *  부재는 `stayDetailStructure.test.ts` G6 가 잠근다.)
 *
 * 라벨 사전은 01b 가 이름으로 적은 코드만 매핑한다. 모르는 코드는 코드값(`LOCALDATA` 같은 내부 이름)을
 * 그대로 보이지 않고 "외부 사이트로 이동"으로 떨어진다. 계약에 없는 `BOOKING` 은 지어내지 않는다 —
 * 폴백으로 떨어지는 것을 잠근다.
 */

describe('C2 · 아는 코드는 표시명 라벨 (AC-3)', () => {
  it.each([
    ['NAVER', '네이버로 이동'],
    ['AGODA', '아고다로 이동'],
  ])('%s → "%s"', (source, label) => {
    expect(otaConfirmLabel(source)).toBe(label);
  });
});

describe('C3 · 모르는 코드는 "외부 사이트로 이동" (AC-3 · 01b 수정안)', () => {
  it.each(['LOCALDATA', 'STUB', 'BOOKING', ''])('%p → 폴백 라벨', (source) => {
    expect(otaConfirmLabel(source)).toBe('외부 사이트로 이동');
  });
});
