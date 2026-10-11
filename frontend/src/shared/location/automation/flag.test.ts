/**
 * TRIP-1337 · JS 쪽 플래그 판독 — app.config extra.locationAutomation 한 곳에서만 읽는다(G-U10-6).
 * `=== true` 만 켠다 — 문자열 'true'·누락·undefined 는 전부 OFF(플래그 OFF 빌드의 코드 경로 0, BR-U10-07).
 */
let mockExtra: Record<string, unknown> | undefined;
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockExtra === undefined ? null : { extra: mockExtra };
    },
  },
}));

import { isLocationAutomationEnabled } from './flag';

describe('isLocationAutomationEnabled', () => {
  it('FL1 extra.locationAutomation === true 일 때만 켠다', () => {
    mockExtra = { locationAutomation: true };
    expect(isLocationAutomationEnabled()).toBe(true);
  });

  it.each([
    ['누락', {}],
    ['문자열 true', { locationAutomation: 'true' }],
    ['false', { locationAutomation: false }],
    ['expoConfig null', undefined],
  ])('FL2 %s 이면 OFF', (_, extra) => {
    mockExtra = extra as Record<string, unknown> | undefined;
    expect(isLocationAutomationEnabled()).toBe(false);
  });
});
