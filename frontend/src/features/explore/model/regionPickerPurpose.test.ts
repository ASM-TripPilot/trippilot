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
 * TRIP-1105 · 진입 탭 신호(TRIP-1015 E) 폐기. 탐색 결과가 진짜 탭바를 쓰는 탐색 탭 d01 로 가므로 탭바는
 * 늘 '탐색'이다 — 지역 선택 URL 에 진입 탭을 실을 이유가 없다. 헬퍼는 purpose 하나만 받는다.
 *
 * ⚠️ 이중 심판(02a ★13): 두 번째 인자는 `pnpm tsc` 가 거부해야 하고(`@ts-expect-error` 가 쓰이지 않으면
 * TS2578), 런타임에도 무시돼 기본 URL 이 나와야 한다(jest).
 */
describe('🔴 1105 · regionPickerHref — 두 번째 인자(tab)는 없다', () => {
  it("('explore', { tab: 'home' }) 를 넘겨도 타입이 거부하고, 결과는 tab 없는 기본 URL 이다", () => {
    const href = regionPickerHref(
      'explore',
      // @ts-expect-error 진입 탭 인자는 TRIP-1105 로 폐기됐다 — 호출자가 다시 싣지 못하게 컴파일에서 막는다
      { tab: 'home' }
    );

    expect(href).toBe('/explore/region?purpose=explore');
  });
});
