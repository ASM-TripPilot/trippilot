import {
  kakaoLoginSpy,
  naverInitializeSpy,
  naverLoginSpy,
} from '@/test-support/nativeSocialSdkMock';

import * as kakaoWeb from './kakaoAuthorize.web';
import * as naverWeb from './naverAuthorize.web';

/**
 * TRIP-1649 · 웹 SDK 어댑터 스텁(`kakaoAuthorize.web.ts`·`naverAuthorize.web.ts`) — 시크릿이 웹 번들에 실리지 않게 하는 자리.
 *
 * 무엇을 보장하나:
 *  - 웹 빌드는 번들러가 `X.web.ts` 를 `X.ts` 보다 먼저 집는다. 스텁은 네이티브 SDK 를 읽어 들이지 않고(아래 목은 읽는 순간 터진다),
 *    불리면 조용히 넘어가지 않고 거절된 Promise 로 실패를 알린다(INV-4) — SDK 는 한 번도 안 불린다.
 *  - 이름이 네이티브본과 같다(`kakaoAuthorize`·`naverAuthorize`) — `makeAuthorize` 의 동적 import 가 웹에서도 같은 이름을 꺼낸다.
 *
 * 커버하지 않는 것: 웹 번들에 시크릿이 0건인지(AC-W3-13, `expo export` 후 grep — 오케 [검증]), 웹 네이버 갈래(W4 가 이 스텁을 대체·확장).
 *   Metro 가 웹에서 `.web.ts` 를 실제로 고르는지는 jest 가 못 본다(이 파일이 `.web` 을 이름으로 직접 부르는 이유).
 *
 * (개념) 아래 `jest.mock(…, () => { throw … })` = "이 모듈을 require 하는 순간 에러" — 스텁이 SDK 를 정적 import 하면
 *   이 파일의 import 단계에서 바로 빨개진다. 호출 때만 보는 단언보다 먼저, 더 확실하게 잡는다.
 * 3동작: 준비(SDK 폭발 목) → 실행(스텁 호출) → 단언(거절·SDK 스파이 0회).
 */

jest.mock(
  '@react-native-seoul/kakao-login',
  () => {
    throw new Error('kakao SDK must not be loaded on web');
  },
  { virtual: true }
);
jest.mock(
  '@react-native-seoul/naver-login',
  () => {
    throw new Error('naver SDK must not be loaded on web');
  },
  { virtual: true }
);

describe('웹 SDK 스텁 — 호출하면 실패를 알리고 SDK 는 건드리지 않는다', () => {
  it('카카오 스텁: kakaoAuthorize 하나만 내보내고, 불리면 거절하며 SDK 로그인은 호출되지 않는다', async () => {
    expect(Object.keys(kakaoWeb)).toEqual(['kakaoAuthorize']);

    // async 래퍼 = 스텁이 동기 throw 로 짜였어도 "거절"로 같게 본다(호출 방식이 아니라 실패 여부를 잰다).
    await expect((async () => kakaoWeb.kakaoAuthorize())()).rejects.toThrow();

    expect(kakaoLoginSpy).not.toHaveBeenCalled();
  });

  it('네이버 스텁: naverAuthorize 하나만 내보내고, 불리면 거절하며 SDK 초기화·로그인은 호출되지 않는다', async () => {
    expect(Object.keys(naverWeb)).toEqual(['naverAuthorize']);

    await expect((async () => naverWeb.naverAuthorize())()).rejects.toThrow();

    expect(naverInitializeSpy).not.toHaveBeenCalled();
    expect(naverLoginSpy).not.toHaveBeenCalled();
  });
});
