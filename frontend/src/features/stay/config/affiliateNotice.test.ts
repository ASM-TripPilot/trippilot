import {
  AFFILIATE_NOTICE_DISMISSED_KEY,
  otaConfirmLabel,
} from './affiliateNotice';

/**
 * TRIP-781 AC-3 · 01b — 제휴 고지의 저장 키와 [이동] 버튼 라벨 사전.
 *
 * 라벨 사전은 01b 가 이름으로 적은 코드만 매핑한다. 모르는 코드는 코드값(`LOCALDATA` 같은 내부 이름)을
 * 그대로 보이지 않고 "외부 사이트로 이동"으로 떨어진다. 계약에 없는 `BOOKING` 은 지어내지 않는다 —
 * 폴백으로 떨어지는 것을 잠근다.
 */

describe('C1 · 저장 키 (01b)', () => {
  it('"다시 보지 않기" 키 이름은 stay.affiliateNotice.dismissed 다', () => {
    expect(AFFILIATE_NOTICE_DISMISSED_KEY).toBe(
      'stay.affiliateNotice.dismissed'
    );
  });
});

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
