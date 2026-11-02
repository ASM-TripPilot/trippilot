/**
 * verify-fv-consent 적합성 검사 — TLA+ 모델(ConsentFlow.tla 「CODE MIRROR」)이 실제 코드와 같은 판정을 하는지
 * fast-check 생성 입력으로 대조한다. 손으로 쓴 함수 모형이 아니라 **실제 훅·실제 함수**를 돌린다:
 *   useLocationConsent(조회 상태 → 토글 표시·누름 값·잠금·진입 미러 보고(웹 제외)) · usePersonalization(표시·누름 값·잠금)
 *   · buildSettingsSections(l05 위치 칩 — 값 → 칩. isError → 칩 숨김은 SettingsPage 몫이라 반례 재현 R4 가 실제 화면으로 본다).
 * 서버 통신은 생성 훅/손수 API 함수 자리만 갈아 끼운다(요청이 몇 번·무슨 값으로 나가는지 센다).
 *
 * 이 파일이 red 면 "코드가 모델과 달라졌다"는 뜻이다 — 앱 결함이 아니다. 모델 CODE MIRROR 와 아래 model*
 * 함수를 코드에 맞게 고친 뒤 TLC 를 다시 돌려야 속성 결과가 다시 유효하다.
 */
import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react-native';
import fc from 'fast-check';

const mockLoc = {
  query: { data: undefined as unknown, isError: false, refetch: jest.fn() },
  put: jest.fn(),
  putPending: false,
  patch: jest.fn(),
};
jest.mock('@/shared/api/generated/location/location', () => ({
  useGetMeLocationConsent: () => mockLoc.query,
  usePutMeLocationConsent: () => ({ mutate: mockLoc.put, isPending: mockLoc.putPending }),
  usePatchMeLocationConsentOsPermission: () => ({ mutate: mockLoc.patch }),
}));
const mockPermission = jest.fn();
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...a: unknown[]) => mockPermission(...a),
}));

const mockPers = { data: undefined as unknown };
jest.mock('@/shared/api/generated/reflection/reflection', () => ({
  useGetMePersonalization: () => ({ data: mockPers.data, isError: false }),
  getGetMePersonalizationQueryKey: () => ['/me/personalization'],
}));
const mockPatchConsent = jest.fn();
const mockFetchTerms = jest.fn();
jest.mock('@/shared/api', () => ({
  patchConsent: (...a: unknown[]) => mockPatchConsent(...a),
  fetchTerms: (...a: unknown[]) => mockFetchTerms(...a),
}));

import { useLocationConsent } from '@/shared/location/useLocationConsent';
import { usePersonalization } from '@/pages/settings/settings-personalization/model/usePersonalization';
import { buildSettingsSections } from '@/pages/settings/settings/model/settingsSections';

// ── 모델 식(ConsentFlow.tla CODE MIRROR 의 TS 옮김 — 둘은 같이 고친다) ─────────────────────
type Data = 'none' | 'on' | 'off';
type Shown = 'on' | 'off' | 'hidden';
const modelShownLoc = (data: Data, err: boolean): Shown => (err || data === 'none' ? 'hidden' : data);
const modelShownPers = (data: Data): Shown => (data === 'none' ? 'off' : data);
const modelChipLoc = (data: Data, err: boolean): Shown => (err || data === 'none' ? 'hidden' : data);
const modelIntent = (shown: Shown): boolean => shown !== 'on';
/** 같은 틱 연타 n 번에 서버로 나가는 동의 변경 요청 수 — 위치·개인화 모두 잠금 1(TRIP-1689 FV-CONSENT-01). */
const modelSends = (_kind: 'loc' | 'pers', _taps: number): number => 1;
/** 진입 미러 보고를 하나 — 웹은 하지 않는다(TRIP-1689 FV-CONSENT-04, 모델 Reports). */
const modelReports = (os: string): boolean => os !== 'web';
/** 진입 미러 보고 값 = 단말 권한 그대로(서버 미러 값과 무관). */
const modelReported = (status: string) =>
  status === 'granted' ? 'GRANTED' : status === 'denied' ? 'DENIED' : 'NOT_DETERMINED';

// ── 입력 생성 ────────────────────────────────────────────────────────────────
const dataArb = fc.constantFrom<Data>('none', 'on', 'off');
const mirrorArb = fc.constantFrom('GRANTED', 'DENIED', 'NOT_DETERMINED');
const statusArb = fc.constantFrom('granted', 'denied', 'undetermined');
const osArb = fc.constantFrom('ios', 'android', 'web');

const locBody = (legal: boolean, mirror: string) => ({
  legalConsent: legal,
  gpsRecordingOptIn: legal,
  osPermissionMirror: mirror,
});

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  jest.clearAllMocks();
  mockLoc.putPending = false;
  mockFetchTerms.mockResolvedValue([
    { termsType: 'PERSONALIZATION', version: 'v1', body: '', effectiveAt: '2026-01-01', reconsentRequired: false },
  ]);
  mockPatchConsent.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('위치(l06) — useLocationConsent == ShownLoc · Intent · CanTap · Reported · Reports', () => {
  it('조회 상태·연타 수·단말 권한·플랫폼 어떤 조합에서도 모델과 같다', async () => {
    await fc.assert(
      fc.asyncProperty(dataArb, fc.boolean(), mirrorArb, statusArb, fc.integer({ min: 1, max: 3 }), osArb, async (data, err, mirror, status, taps, os) => {
        jest.clearAllMocks();
        const replaced = jest.replaceProperty(Platform, 'OS', os as typeof Platform.OS);
        mockLoc.query = { data: data === 'none' ? undefined : locBody(data === 'on', mirror), isError: err, refetch: jest.fn() };
        mockPermission.mockResolvedValue({ status, granted: status === 'granted' });
        const { result, unmount } = renderHook(() => useLocationConsent(), { wrapper: wrapper() });
        await flush();

        // 진입 미러 보고: 서버 미러 값과 무관하게 단말 권한을 1회 그대로 보낸다 — 웹이면 보내지 않는다.
        expect(mockLoc.patch.mock.calls).toEqual(
          modelReports(os) ? [[{ data: { osPermission: modelReported(status) } }]] : []
        );

        const shown: Shown = result.current.status !== 'ready' ? 'hidden' : result.current.consentOn ? 'on' : 'off';
        expect(shown).toBe(modelShownLoc(data, err));

        if (shown !== 'hidden') {
          // 화면은 off → grant(), on → (다이얼로그 확정 뒤) revoke() 를 부른다. 같은 틱 연타 taps 번.
          act(() => {
            for (let i = 0; i < taps; i += 1) {
              if (shown === 'off') result.current.grant(); else result.current.revoke();
            }
          });
          const v = modelIntent(shown);
          expect(mockLoc.put.mock.calls.length).toBe(modelSends('loc', taps));
          expect(mockLoc.put.mock.calls[0][0]).toEqual({ data: { legalConsent: v, gpsRecordingOptIn: v } });
        }
        unmount();
        replaced.restore();
      }),
      { numRuns: 60 }
    );
  });
});

describe('개인화 — usePersonalization == ShownPers · Intent · CanTap(잠금)', () => {
  it('조회 상태·연타 수 어떤 조합에서도 모델과 같다', async () => {
    await fc.assert(
      fc.asyncProperty(dataArb, fc.constantFrom('APPLIED', 'NOT_ENOUGH_RECORDS'), fc.integer({ min: 1, max: 3 }), async (data, onReason, taps) => {
        jest.clearAllMocks();
        mockPers.data = data === 'none' ? undefined : { applied: false, reason: data === 'on' ? onReason : 'CONSENT_MISSING', sharedItems: [] };
        const { result, unmount } = renderHook(() => usePersonalization(), { wrapper: wrapper() });

        const shown: Shown = result.current.consentOn ? 'on' : 'off';
        expect(shown).toBe(modelShownPers(data));

        act(() => {
          for (let i = 0; i < taps; i += 1) result.current.onToggle();
        });
        await flush();
        const action = modelIntent(shown) ? 'GRANT' : 'REVOKE';
        expect(mockPatchConsent.mock.calls).toEqual(
          Array.from({ length: modelSends('pers', taps) }, () => ['PERSONALIZATION', 'v1', action])
        );
        unmount();
      }),
      { numRuns: 40 }
    );
  });
});

describe('l05 위치 칩 — buildSettingsSections == ChipLoc (값 → 칩, 오류 없음 쪽)', () => {
  it('캐시 값 어떤 것이든 모델과 같다', () => {
    fc.assert(
      fc.property(dataArb, (data) => {
        const groups = buildSettingsSections({
          nickname: 'n',
          email: null,
          locationConsent: data === 'none' ? undefined : data === 'on',
        });
        const chip = groups.flatMap((g) => g.rows).find((r) => r.key === 'location-consent')?.chip ?? null;
        const shown: Shown = chip === null ? 'hidden' : chip.label === '동의' ? 'on' : 'off';
        expect(shown).toBe(modelChipLoc(data, false));
      })
    );
  });
});
