import { regionPickerHref } from './regionPickerPurpose';

/**
 * TRIP-985 · 지역 선택 purpose 철자의 단일 출처.
 *
 * 호출자(탐색 랜딩·홈·목적지 결과·d04·위저드)와 피커가 purpose 문자열을 각자 리터럴로 쓰면
 * 서로 다른 철자로도 양쪽 테스트가 green 이다(피커는 모르는 값을 stay 로 떨어뜨린다). 그래서
 * 철자는 이 헬퍼 한 곳에서만 리터럴로 고정하고, 호출자·피커 테스트는 전부 이 헬퍼 출력에 기댄다.
 *
 * ⚠️ 아래 `@ts-expect-error` 의 심판은 jest 가 아니라 `pnpm tsc` 다 — 인자 타입이 `string` 으로
 * 넓어지면 에러가 안 나서 `TS2578 Unused '@ts-expect-error' directive` 로 실패한다.
 */

describe('regionPickerHref — purpose 별 지역 선택 URL', () => {
  it.each([
    ['explore', '/explore/region?purpose=explore'],
    ['places', '/explore/region?purpose=places'],
    ['trip', '/explore/region?purpose=trip'],
    ['stay', '/explore/region?purpose=stay'],
  ] as const)('%s → %s', (purpose, href) => {
    expect(regionPickerHref(purpose)).toBe(href);
  });

  it('모르는 철자는 타입이 거부한다 (tsc 심판)', () => {
    const typo = () =>
      // @ts-expect-error 'explorer' 는 purpose 유니온에 없다 — 호출자 오타를 컴파일에서 막는다
      regionPickerHref('explorer');

    expect(typeof typo).toBe('function');
  });
});

/**
 * TRIP-1015 E · 진입 탭 신호(결정 4 · Seed Q4). 홈 검색으로 들어온 여행지 결과 화면은 탭바가 "홈"을
 * 가리켜야 한다. 결과 화면은 `(tabs)` 밖이라 어느 탭에서 왔는지 모르므로, 지역 선택 URL 에 진입 탭을
 * 싣고 피커가 결과 화면으로 되실어 보낸다. 철자는 이 헬퍼 한 곳에서만 정한다(TRIP-985 규약).
 */
describe('🔴 1015-E · regionPickerHref — 진입 탭(tab) 선택 인자', () => {
  it("('explore', { tab: 'home' }) → purpose 뒤에 &tab=home 이 붙는다", () => {
    expect(regionPickerHref('explore', { tab: 'home' })).toBe(
      '/explore/region?purpose=explore&tab=home'
    );
  });

  it('두 번째 인자가 없으면 지금 URL 그대로다(탐색 랜딩·결과 화면 기본 — 무회귀)', () => {
    expect(regionPickerHref('explore')).toBe('/explore/region?purpose=explore');
  });
});
