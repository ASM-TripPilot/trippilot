/**
 * @jest-environment node
 */

/**
 * TRIP-1648 · B1 — 웹에서는 위치 자동 기록이 **빌드 값과 무관하게** 꺼져 있다(`flag.web.ts`).
 *
 * 무엇을 보장하나:
 *  - 웹 번들에 `extra.locationAutomation` 이 실려 와 `true` 여도 `isLocationAutomationEnabled()` 는 `false` 다.
 *    태스크 정의·권한 요청·설명 화면·`expo-file-system` 저장소는 전부 이 함수 하나로 게이트돼 있어(BR-U10-07),
 *    이 한 줄이 웹에서 그 전부를 한 줄도 안 돌게 한다.
 *  - 짝 대조: 같은 목을 실 `flag.ts` 에 주면 `true` — 목이 정말 "켜진 빌드"를 흉내 낸다는 증거(없으면 "원래 꺼져서 false"를 못 가른다).
 *  - 두 파일이 같은 이름만 내보낸다(`tsc` 가 `.web.ts` 를 안 봐서 어긋나도 웹에서만 터진다).
 *
 * 3동작: 준비(expo-constants 목: 켜짐) → 실행(실·웹 판독) → 단언(true/false·export 이름).
 */

import { isLocationAutomationEnabled as isEnabledNative } from './flag';
import { isLocationAutomationEnabled as isEnabledWeb } from './flag.web';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { locationAutomation: true } } },
}));

describe('위치 자동 기록 플래그 — 웹은 항상 OFF', () => {
  it('(대조) 빌드 값이 켜져 있으면 네이티브 판독은 true 다', () => {
    expect(isEnabledNative()).toBe(true);
  });

  it('같은 빌드 값에서도 웹 판독은 false 다', () => {
    expect(isEnabledWeb()).toBe(false);
  });

  it('네이티브·웹 파일은 같은 이름만 내보낸다', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require('./flag') as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const web = require('./flag.web') as Record<string, unknown>;

    expect(Object.keys(web).sort()).toEqual(Object.keys(native).sort());
  });
});
