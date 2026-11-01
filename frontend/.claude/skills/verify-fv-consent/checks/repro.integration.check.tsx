/**
 * 모델 반례 재현 — 실제 LocationConsentPage · PersonalizationPage(+ 실제 useLocationConsent · usePersonalization ·
 * 생성 클라이언트 · axios)를 MSW 가짜 서버 위에서 단계별로 돌린다.
 * 가짜 서버는 backend/modules/auth 규칙(S1~S3)만 흉내 낸다:
 *   S1 위치 PUT 은 값이 바뀔 때만 증적, S2 개인화 PATCH 는 매번 증적, S3 미러 PATCH 는 L1 만 덮는다.
 * 응답 유실 = 서버가 반영한 뒤 네트워크 오류로 끊는다(HttpResponse.error()).
 *
 * R1~R5 는 처음(sync f153fe2) 결함 FV-CONSENT-01~04 를 재현했고, TRIP-1689 수정 뒤 "고쳐졌다"를 단언하도록 뒤집었다.
 * R6 은 처음부터 "지켜진다". 수정이 되돌아가면 그 R 이 실패한다(SKILL.md 「결과 읽기」 4).
 */
import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { newTestQueryClient } from '@/test-support/queryRender';
import { SettingsPage } from '@/pages/settings/settings';
import { LocationConsentPage } from '@/pages/settings/settings-location';
import { PersonalizationPage } from '@/pages/settings/settings-personalization';

jest.mock('@/shared/storage', () => ({
  ...jest.requireActual('@/shared/storage'),
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));
jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    useRouter: ['push', 'replace', 'back'],
    router: ['push', 'replace', 'back'],
  })
);
const mockPermission = jest.fn();
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...a: unknown[]) => mockPermission(...a),
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted', granted: true }),
  getBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'undetermined', granted: false }),
}));
jest.mock('expo-linking', () => ({ openSettings: jest.fn() }));
// (처음 R2 는 실제 patchConsent 를 감싸 새는 거부를 셌다 — 수정 뒤 onToggle 이 거부를 잡으므로 감싸지 않는다.)

const BASE = 'http://localhost:8080/api/v1';

// ── 가짜 서버(S1~S3) ────────────────────────────────────────────────────────
type Act = 'GRANT' | 'REVOKE';
let loc: { legal: boolean; mirror: string };
let locLog: Act[];
let persLog: Act[];
let lostReply: { loc: boolean; pers: boolean };
let getFails: { loc: boolean };
let putCount: number;

const persOn = () => persLog.length > 0 && persLog[persLog.length - 1] === 'GRANT';
const locBody = () => ({
  osPermissionMirror: loc.mirror,
  legalConsent: loc.legal,
  gpsRecordingOptIn: loc.legal,
  capabilities: { serverLocationService: loc.mirror === 'GRANTED' && loc.legal, gpsTrackRetention: loc.mirror === 'GRANTED' && loc.legal },
});

const fakeServer = [
  http.get(`${BASE}/me/location-consent`, () =>
    getFails.loc ? HttpResponse.error() : HttpResponse.json(locBody())
  ),
  http.put(`${BASE}/me/location-consent`, async ({ request }) => {
    putCount += 1;
    const body = (await request.json()) as { legalConsent: boolean };
    if (body.legalConsent !== loc.legal) {
      locLog.push(body.legalConsent ? 'GRANT' : 'REVOKE'); // S1 — 바뀔 때만
      loc.legal = body.legalConsent;
    }
    return lostReply.loc ? HttpResponse.error() : HttpResponse.json(locBody());
  }),
  http.patch(`${BASE}/me/location-consent/os-permission`, async ({ request }) => {
    loc.mirror = ((await request.json()) as { osPermission: string }).osPermission; // S3
    return new HttpResponse(null, { status: 204 });
  }),
  http.get(`${BASE}/me/personalization`, () =>
    HttpResponse.json({ applied: persOn(), reason: persOn() ? 'APPLIED' : 'CONSENT_MISSING', sharedItems: [] })
  ),
  // l05 설정(SettingsPage)이 같이 읽는 조회 — R4 에서 l06 아래 스택에 깔아 둔다(가정 C1).
  http.get(`${BASE}/me`, () =>
    HttpResponse.json({ accountId: 'acc-1', status: 'ACTIVE', email: 'a@b.com', socialProviders: ['KAKAO'], onboardingCompleted: true })
  ),
  http.get(`${BASE}/me/profile`, () => HttpResponse.json({ nickname: '여행자' })),
  http.get(`${BASE}/me/preferences`, () => HttpResponse.json({})),
  http.get(`${BASE}/me/settings`, () => HttpResponse.json({ affiliateNoticeDismissed: false })),
  http.get(`${BASE}/terms`, () =>
    HttpResponse.json([{ termsType: 'PERSONALIZATION', version: 'v1', body: '', effectiveAt: '2026-01-01', reconsentRequired: false }])
  ),
  http.patch(`${BASE}/me/consents/:termsType`, async ({ request }) => {
    persLog.push(((await request.json()) as { action: Act }).action); // S2 — 매번
    return lostReply.pers ? HttpResponse.error() : new HttpResponse(null, { status: 200 });
  }),
];

let client: QueryClient;
function mount(ui: ReactNode) {
  client = newTestQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
const checked = (testID: string) => screen.getByTestId(testID).props.accessibilityState?.checked as boolean;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  loc = { legal: false, mirror: 'GRANTED' };
  locLog = [];
  persLog = [];
  lostReply = { loc: false, pers: false };
  getFails = { loc: false };
  putCount = 0;
  mockPermission.mockResolvedValue({ status: 'granted', granted: true });
  setAccessToken('a');
  server.use(...fakeServer);
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  clearAccessToken();
});
afterAll(() => server.close());

describe('개인화', () => {
  it('R1 (FV-CONSENT-01 고쳐짐) 토글을 연달아 두 번 눌러도 GRANT 증적은 한 줄', async () => {
    mount(<PersonalizationPage />);
    await waitFor(() => expect(checked('settings-personalization-toggle')).toBe(false));
    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));
    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));
    await settle();
    expect(persLog).toEqual(['GRANT']);
    await waitFor(() => expect(checked('settings-personalization-toggle')).toBe(true));
  });

  it('R2 (FV-CONSENT-02 고쳐짐) 저장 응답이 끊겨도 다시 받아 토글 = 서버(동의) + 실패 안내', async () => {
    lostReply.pers = true;
    mount(<PersonalizationPage />);
    await waitFor(() => expect(checked('settings-personalization-toggle')).toBe(false));
    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));
    await settle();
    expect(persOn()).toBe(true);
    await waitFor(() => expect(checked('settings-personalization-toggle')).toBe(true)); // 화면 = 서버
    expect(screen.getByTestId('settings-personalization-save-error')).toBeTruthy(); // 침묵하지 않는다
    expect(persLog).toEqual(['GRANT']);
  });
});

describe('위치(l06)', () => {
  it('R3 (FV-CONSENT-03 고쳐짐) 저장 응답이 끊겨도 다시 받아 토글 = 서버(동의)', async () => {
    lostReply.loc = true;
    mount(<LocationConsentPage />);
    await waitFor(() => expect(checked('settings-location-toggle')).toBe(false));
    fireEvent.press(screen.getByTestId('settings-location-toggle'));
    await settle();
    expect(loc.legal).toBe(true);
    expect(locLog).toEqual(['GRANT']);
    expect(screen.getByTestId('settings-location-save-error')).toBeTruthy();
    await waitFor(() => expect(checked('settings-location-toggle')).toBe(true));
  });

  it('R4 (FV-CONSENT-03 고쳐짐 · l05 칩) 저장 뒤 다시 받기가 실패하면 l06 은 오류 얼굴, 스택 아래 l05 칩은 숨는다', async () => {
    // 스택 아래 l05(SettingsPage) 위에 l06 이 떠 있다 — 같은 QueryClient·같은 위치 동의 쿼리(가정 C1).
    mount(
      <>
        <SettingsPage />
        <LocationConsentPage />
      </>
    );
    await waitFor(() => expect(screen.getByTestId('settings-chip-location-consent')).toBeTruthy());
    await waitFor(() => expect(checked('settings-location-toggle')).toBe(false));
    getFails.loc = true;
    fireEvent.press(screen.getByTestId('settings-location-toggle'));
    await settle();
    expect(loc.legal).toBe(true);
    await waitFor(() => expect(screen.getByTestId('settings-location-consent-error')).toBeTruthy());
    expect(screen.queryByTestId('settings-chip-location-consent')).toBeNull(); // 옛 「미동의」를 주장하지 않는다
  });

  it('R5 (FV-CONSENT-04 고쳐짐) 웹에서 들어와도 서버 미러 GRANTED 를 덮지 않는다', async () => {
    const replaced = jest.replaceProperty(Platform, 'OS', 'web');
    try {
      mockPermission.mockResolvedValue({ status: 'undetermined', granted: false });
      mount(<LocationConsentPage />);
      await settle();
      expect(mockPermission).toHaveBeenCalled();
      expect(loc.mirror).toBe('GRANTED');
      expect(locLog).toEqual([]);
    } finally {
      replaced.restore();
    }
  });

  it('R5b (짝) 앱에서 들어오면 단말 권한을 그대로 보고한다', async () => {
    mockPermission.mockResolvedValue({ status: 'undetermined', granted: false });
    mount(<LocationConsentPage />);
    await settle();
    expect(loc.mirror).toBe('NOT_DETERMINED');
  });

  it('R6 (지켜짐) 같은 틱 연타는 PUT 1회 — 증적 1줄', async () => {
    mount(<LocationConsentPage />);
    await waitFor(() => expect(checked('settings-location-toggle')).toBe(false));
    fireEvent.press(screen.getByTestId('settings-location-toggle'));
    fireEvent.press(screen.getByTestId('settings-location-toggle'));
    await settle();
    expect(putCount).toBe(1);
    expect(locLog).toEqual(['GRANT']);
    await waitFor(() => expect(checked('settings-location-toggle')).toBe(true));
  });
});
