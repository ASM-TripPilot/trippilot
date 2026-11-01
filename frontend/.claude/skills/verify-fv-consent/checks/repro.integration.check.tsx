/**
 * 모델 반례 재현 — 실제 LocationConsentPage · PersonalizationPage(+ 실제 useLocationConsent · usePersonalization ·
 * 생성 클라이언트 · axios)를 MSW 가짜 서버 위에서 단계별로 돌린다.
 * 가짜 서버는 backend/modules/auth 규칙(S1~S3)만 흉내 낸다:
 *   S1 위치 PUT 은 값이 바뀔 때만 증적, S2 개인화 PATCH 는 매번 증적, S3 미러 PATCH 는 L1 만 덮는다.
 * 응답 유실 = 서버가 반영한 뒤 네트워크 오류로 끊는다(HttpResponse.error()).
 *
 * R1~R5 는 "결함이 아직 일어난다"를, R6 은 "지켜진다"를 단언한다. 결함이 고쳐지면 그 R 이 실패한다
 * (SKILL.md 「결과 읽기」 3).
 */
import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { newTestQueryClient } from '@/test-support/queryRender';
import { buildSettingsSections } from '@/pages/settings/settings/model/settingsSections';
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
// 실제 patchConsent 를 그대로 부르되, 실패하면 거부를 세고 "끝나지 않는 약속"으로 바꾼다. usePersonalization.onToggle 은
// `void (async () => …)()` 라 실패 거부가 아무 데서도 잡히지 않고 jest 가 그것을 테스트 실패로 올린다 — 실패 뒤 코드가
// 멈춘다(무효화 없음)는 관측 결과는 같고, 거부가 샜다는 사실은 mockSwallowed 로 센다.
const mockSwallowed: unknown[] = [];
jest.mock('@/shared/api', () => {
  const actual = jest.requireActual('@/shared/api');
  return {
    ...actual,
    patchConsent: (...a: unknown[]) =>
      actual.patchConsent(...a).catch((e: unknown) => {
        mockSwallowed.push(e);
        return new Promise(() => {});
      }),
  };
});

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
  mockSwallowed.length = 0;
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
  it('R1 (NoDuplicateRecordPers) 토글을 연달아 두 번 누르면 GRANT 증적이 두 줄 쌓인다', async () => {
    mount(<PersonalizationPage />);
    await waitFor(() => expect(checked('settings-personalization-toggle')).toBe(false));
    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));
    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));
    await settle();
    expect(persLog).toEqual(['GRANT', 'GRANT']);
    await waitFor(() => expect(checked('settings-personalization-toggle')).toBe(true));
  });

  it('R2 (ShownMatchesServerPers) 저장 응답이 끊기면 토글은 꺼짐, 서버는 동의 — 다시 누르면 GRANT 두 번째 줄', async () => {
    lostReply.pers = true;
    mount(<PersonalizationPage />);
    await waitFor(() => expect(checked('settings-personalization-toggle')).toBe(false));
    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));
    await settle();
    expect(persOn()).toBe(true);
    expect(checked('settings-personalization-toggle')).toBe(false); // 화면 ≠ 서버, 안내도 없음
    lostReply.pers = false;
    fireEvent.press(screen.getByTestId('settings-personalization-toggle'));
    await settle();
    expect(persLog).toEqual(['GRANT', 'GRANT']);
    expect(mockSwallowed.length).toBe(1); // 첫 누름의 실패 — 실제 코드에선 잡히지 않은 거부로 샌다(안내 없음)
  });
});

describe('위치(l06)', () => {
  it('R3 (ShownMatchesServerLoc) 저장 응답이 끊기면 토글은 꺼짐 + 「저장하지 못했어요」, 서버는 동의', async () => {
    lostReply.loc = true;
    mount(<LocationConsentPage />);
    await waitFor(() => expect(checked('settings-location-toggle')).toBe(false));
    fireEvent.press(screen.getByTestId('settings-location-toggle'));
    await settle();
    expect(loc.legal).toBe(true);
    expect(locLog).toEqual(['GRANT']);
    expect(screen.getByTestId('settings-location-save-error')).toBeTruthy();
    expect(checked('settings-location-toggle')).toBe(false);
  });

  it('R4 (ShownMatchesServerLoc · l05 칩) 저장 뒤 다시 받기가 실패하면 l06 은 오류 얼굴, l05 칩은 옛 값 「미동의」', async () => {
    mount(<LocationConsentPage />);
    await waitFor(() => expect(checked('settings-location-toggle')).toBe(false));
    getFails.loc = true;
    fireEvent.press(screen.getByTestId('settings-location-toggle'));
    await settle();
    expect(loc.legal).toBe(true);
    await waitFor(() => expect(screen.getByTestId('settings-location-consent-error')).toBeTruthy());
    const cached = client.getQueryData<{ gpsRecordingOptIn: boolean }>(['/me/location-consent']);
    const chip = buildSettingsSections({ nickname: 'n', email: null, locationConsent: cached?.gpsRecordingOptIn })
      .flatMap((g) => g.rows)
      .find((r) => r.key === 'location-consent')?.chip;
    expect(chip?.label).toBe('미동의');
  });

  it('R5 (MirrorFollowsApp) 단말 권한이 NOT_DETERMINED 인 기기(웹)가 들어오면 서버 미러 GRANTED 를 덮는다', async () => {
    mockPermission.mockResolvedValue({ status: 'undetermined', granted: false });
    mount(<LocationConsentPage />);
    await settle();
    expect(loc.mirror).toBe('NOT_DETERMINED');
    expect(locLog).toEqual([]); // 법적 증적은 건드리지 않는다(S3)
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
