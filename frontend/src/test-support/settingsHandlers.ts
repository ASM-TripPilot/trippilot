import { http, HttpResponse, type RequestHandler } from 'msw';
import type { SetupServer } from 'msw/node';
import { act, waitFor } from '@testing-library/react-native';

/**
 * 설정·마이 계열 통합 테스트 공용 MSW 조각(TRIP-1350) — `/me` 계열 조회 6핸들러와 "시작한 요청이 모두 끝날 때까지" 기다리는
 * 네트워크 추적기. 41개 통합 파일이 같은 6핸들러(`/me`·`/me/profile`·`/me/preferences`·`/me/location-consent`·
 * `/me/personalization`·`/me/settings`)와 `started`/`ended` 카운터·`settleNetwork` 를 복사해 쓰던 것이다.
 *
 * 모듈 스코프 파일이라 NativeWind babel 호이스트 함정(`_ReactNativeCSSInterop`)에 걸리지 않는다.
 */

export const API_BASE = `${
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080'
}/api/v1`;

type BodyFactory = () => unknown;

/** 핸들러별 응답 본문 — 상태형(PATCH 가 바꾼 값을 읽는 GET)은 호출 시점에 읽는 함수로 준다. */
export interface SettingsBodies {
  me?: BodyFactory;
  profile?: BodyFactory;
  preferences?: BodyFactory;
  locationConsent?: BodyFactory;
  personalization?: BodyFactory;
  settings?: BodyFactory;
}

/** `/me` 계열 GET 6핸들러. `bodies` 로 바꾼 것만 덮고 나머지는 가장 작은 정상 모양이다. */
export function settingsHandlers(
  bodies: SettingsBodies = {}
): RequestHandler[] {
  const body = (key: keyof SettingsBodies, fallback: unknown) => () =>
    HttpResponse.json((bodies[key] ?? (() => fallback))() as never);
  return [
    http.get(
      `${API_BASE}/me`,
      body('me', {
        accountId: 'acc-1',
        status: 'ACTIVE',
        email: 'a@b.com',
        socialProviders: ['KAKAO'],
        onboardingCompleted: true,
      })
    ),
    http.get(
      `${API_BASE}/me/profile`,
      body('profile', { nickname: '여행자123' })
    ),
    http.get(`${API_BASE}/me/preferences`, body('preferences', {})),
    http.get(
      `${API_BASE}/me/location-consent`,
      body('locationConsent', {
        osPermissionMirror: 'GRANTED',
        legalConsent: true,
      })
    ),
    http.get(
      `${API_BASE}/me/personalization`,
      body('personalization', {
        applied: true,
        reason: 'APPLIED',
        sharedItems: [],
      })
    ),
    http.get(
      `${API_BASE}/me/settings`,
      body('settings', { affiliateNoticeDismissed: false })
    ),
  ];
}

/**
 * 시작/끝난 요청 수를 세는 추적기. `beforeAll` 에서 `server.listen` 뒤에 `attach()`, `beforeEach` 에서 `reset()`,
 * 단언 직전에 `await settleNetwork()` — 재조회 경주(PATCH 뒤 GET 재요청)가 끝나고 결과가 화면에 반영될 때까지 흘린다.
 */
export function createNetworkTracker(server: SetupServer) {
  let started = 0;
  let ended = 0;
  return {
    attach(): void {
      server.events.on('request:start', () => {
        started += 1;
      });
      server.events.on('request:end', () => {
        ended += 1;
      });
    },
    reset(): void {
      started = 0;
      ended = 0;
    },
    async settleNetwork(): Promise<void> {
      await waitFor(() => expect(ended).toBe(started));
      await act(async () => {});
    },
  };
}
