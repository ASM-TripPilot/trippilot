import { isWizardOrigin, wizardOriginParams } from './wizardOrigin';

/**
 * TRIP-1026 · 위저드 → d04 진입 출처 파라미터 철자의 단일 출처 (AC-6).
 *
 * 무엇을 보장하나: 보내는 쪽(1/4 '더 담기'·d02 select '더 담기'/'둘러보기')은
 * `wizardOriginParams()` 로 파라미터를 싣고, 받는 쪽(d04 페이지)은 `isWizardOrigin` 으로
 * 판정한다. 두 쪽이 리터럴을 각자 쓰면 철자가 어긋나도 양쪽 테스트가 green 이다 — 그래서 철자는
 * 여기 한 곳에서만 고정하고, 생산자·수신자 테스트는 전부 이 헬퍼 출력에 기댄다
 * (`regionPickerPurpose.test.ts` 선례).
 */

describe('🔴 1026 · wizardOriginParams — 보내는 쪽이 실을 파라미터', () => {
  it('철자는 { from: "wizard" } 하나다', () => {
    expect(wizardOriginParams()).toEqual({ from: 'wizard' });
  });
});

describe('🔴 1026 · isWizardOrigin — 받는 쪽 판정', () => {
  it('보내는 쪽이 실은 파라미터를 그대로 받으면 위저드 출처다 (왕복)', () => {
    expect(isWizardOrigin(wizardOriginParams())).toBe(true);
  });

  it('다른 파라미터와 섞여 와도 위저드 출처다 (1/4 더 담기는 region 도 싣는다)', () => {
    expect(
      isWizardOrigin({ region: ['부산광역시'], ...wizardOriginParams() })
    ).toBe(true);
  });

  it('같은 키가 배열로 와도 위저드 출처다 (expo-router 반복 키 규약)', () => {
    expect(isWizardOrigin({ from: ['wizard'] })).toBe(true);
  });

  it.each([
    ['파라미터 없음(홈·탐색 탭)', {}],
    ['region 만(d03 모두 보기·지역 피커)', { region: '부산광역시' }],
    ['region 배열만', { region: ['부산광역시', '경주시'] }],
    ['from 이 다른 값', { from: 'home' }],
  ])('%s 이면 위저드 출처가 아니다', (_name, params) => {
    expect(isWizardOrigin(params)).toBe(false);
  });
});
