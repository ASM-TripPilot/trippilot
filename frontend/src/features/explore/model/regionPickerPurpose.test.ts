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
