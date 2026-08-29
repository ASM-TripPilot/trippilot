jest.mock('@/shared/api/generated/location/location');

// OS 권한 seam — expo-location 을 통째로 가짜로 바꿔 "페이지가 이걸 부르는가/몇 번/무엇으로 미러하나"
// 를 관찰한다. jest 는 팩토리 밖 변수를 `mock*` 이름일 때만 허용하므로 지연 래퍼로 참조한다
// (onboarding-location/LocationPage.test 동형).
const mockGetForeground = jest.fn();
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...args: unknown[]) =>
    mockGetForeground(...args),
}));

// 앱 설정 열기 seam — 리포 관례상 expo-linking(RN Linking 아님).
const mockOpenSettings = jest.fn();
jest.mock('expo-linking', () => ({
  openSettings: (...args: unknown[]) => mockOpenSettings(...args),
}));

// 라우터 — 헤더 back 등 배선이 있어도 죽지 않게 고정 스텁으로 둔다.
jest.mock('expo-router', () => {
  const replace = jest.fn();
  const push = jest.fn();
  const back = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ replace, push, back }),
    router: { replace, push, back },
  };
});

import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import {
  useGetMeLocationConsent,
  usePatchMeLocationConsentOsPermission,
  usePutMeLocationConsent,
} from '@/shared/api/generated/location/location';
import type { LocationConsent } from '@/shared/api/generated/schemas';

import { LocationConsentPage } from '..';

/**
 * TRIP-609 — l06 위치 동의 배선 통합테스트(딥 경로 목 seam).
 *
 * 무엇을 보장하나(AC):
 *  - AC-1(철회 게이트): 동의 ON 에서 토글 OFF → **PUT 즉시 미발화** + 다이얼로그 → [동의 철회] 뒤에만
 *    PUT 1회, payload `{legalConsent:false, gpsRecordingOptIn:false}`(consentPutBody 경유 = 둘 동시).
 *  - AC-1 짝(승낙): 동의 OFF 에서 토글 ON → PUT 1회 `{legalConsent:true, gpsRecordingOptIn:true}`, 다이얼로그 없음.
 *  - AC-3(DENIED): OS 권한 거부면 토글 **real disabled**(눌러도 PUT·다이얼로그 무변화) + [설정 이동]→openSettings.
 *  - AC-4(미러 보고): 진입 시 getForegroundPermissionsAsync 1회 → PATCH os-permission 1회, 매핑값 정확.
 *
 * 왜 페이지 층인가: 이 AC 들은 훅 응답 → 상태 → 서버 mutate 라는 **배선**의 성질이다. 화면(순수)만
 * 으로도, 순수 함수만으로도 표현 못 한다 — 생성 훅을 목으로 주입하고 실제 페이지를 렌더해 잠근다.
 *
 * ★ 목 seam 은 **딥 경로**(`@/shared/api/generated/location/location`)다 — 배럴/useLocationConsent 목이면
 *   실 배선이 안 돌아 게이트가 공허해진다(608 SettingsPage 선례). 뮤테이션 목은 **옵션 캡처형**이라
 *   mutate 가 payload 를 spy 로 찍고 onSuccess 를 동기 발화한다(02a §2 ★2).
 *
 * ★ disabled 실차단(AC-3): 토글이 accessibilityState 만인 "가짜 disabled"면 press 가 여전히 발화해
 *   PUT 가 샌다. real `disabled` prop 이라야 `fireEvent.press` 가 실차단된다(dateSheet 과거 셀 선례,
 *   02a §5-B) — "disabled + press 후 putSpy 미호출" 짝으로 잠근다.
 *
 * ⚠️ jest 사각(6-b 실기): 다이얼로그 딤이 화면을 실제로 덮나·모달이 실제 열리나 — 여기선 testID
 *   존재/부재 + mutate 시퀀스로만 잠근다(리포 Modal 선례 0, repo-traps).
 *
 * (개념) mutate 변수 shape 는 orval 계약상 `{ data: 바디 }`(생성코드 location.ts L219/302 실측, 02a §5-E).
 */

const mockUseGetConsent = useGetMeLocationConsent as jest.Mock;
const mockUsePut = usePutMeLocationConsent as jest.Mock;
const mockUsePatch = usePatchMeLocationConsentOsPermission as jest.Mock;

/** expo-location 권한 응답(LocationPermissionResponse 부분집합) — status·granted 를 함께 채워
 *  구현이 어느 필드로 매핑하든 통과하게 한다. */
const GRANTED = {
  status: 'granted',
  granted: true,
  canAskAgain: true,
} as const;
const DENIED = {
  status: 'denied',
  granted: false,
  canAskAgain: false,
} as const;

/**
 * 옵션 캡처형 뮤테이션 목(608 primeMutation 승계) — mutate 호출 시 spy 로 payload 를 찍고, error 면
 * onError, 아니면 onSuccess 를 페이지가 넘긴 콜백으로 동기 발화한다.
 */
function primeMutation(
  hook: jest.Mock,
  opts: { spy?: jest.Mock; onSuccessData?: unknown; error?: unknown } = {}
) {
  hook.mockImplementation(
    (options?: {
      mutation?: {
        onSuccess?: (data: unknown, vars: unknown, ctx: unknown) => void;
        onError?: (error: unknown, vars: unknown, ctx: unknown) => void;
      };
    }) => ({
      isPending: false,
      mutate: (vars?: unknown) => {
        opts.spy?.(vars);
        if (opts.error) {
          options?.mutation?.onError?.(opts.error, vars, undefined);
        } else {
          options?.mutation?.onSuccess?.(opts.onSuccessData, vars, undefined);
        }
      },
    })
  );
}

/** GET /me/location-consent 응답 주입. 전 필드 옵셔널이라 화면이 undefined 방어함을 전제. */
function primeConsent(data: LocationConsent) {
  mockUseGetConsent.mockReturnValue({ data });
}

let putSpy: jest.Mock;
let patchSpy: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  putSpy = jest.fn();
  patchSpy = jest.fn();
  primeConsent({ osPermissionMirror: 'GRANTED', legalConsent: true });
  primeMutation(mockUsePut, { spy: putSpy, onSuccessData: {} });
  primeMutation(mockUsePatch, { spy: patchSpy, onSuccessData: undefined });
  mockGetForeground.mockResolvedValue(GRANTED);
  mockOpenSettings.mockReset();
  mockOpenSettings.mockResolvedValue(undefined);
});

describe('TRIP-609 · 철회 게이트(AC-1)', () => {
  it('동의 ON 에서 토글 OFF → PUT 미발화 · [동의 철회] 뒤에만 둘 동시 false 로 1회', async () => {
    primeConsent({ osPermissionMirror: 'GRANTED', legalConsent: true });
    render(<LocationConsentPage />);
    // 마운트 미러 보고가 정착하도록 기다린다(뒤늦은 상태 갱신 방지).
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));

    // 실행: 토글 끄기.
    fireEvent.press(screen.getByTestId('settings-location-toggle'));

    // 급소: 다이얼로그가 먼저 뜨고 PUT 는 아직 안 나간다.
    expect(
      screen.getByTestId('settings-location-revoke-confirm')
    ).toBeOnTheScreen();
    expect(putSpy).not.toHaveBeenCalled();

    // 실행: 철회 확정.
    fireEvent.press(
      screen.getByTestId('settings-location-revoke-confirm-button')
    );

    // 단언: 정확히 1회, L2·L3 둘 다 false(consentPutBody 경유 = 분리 전송 불가).
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith({
      data: { legalConsent: false, gpsRecordingOptIn: false },
    });
  });

  it('짝(승낙): 동의 OFF 에서 토글 ON → 다이얼로그 없이 둘 동시 true 로 1회', async () => {
    primeConsent({ osPermissionMirror: 'GRANTED', legalConsent: false });
    render(<LocationConsentPage />);
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));

    fireEvent.press(screen.getByTestId('settings-location-toggle'));

    // 승낙은 재확인 게이트 없이 곧장 나간다.
    expect(screen.queryByTestId('settings-location-revoke-confirm')).toBeNull();
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith({
      data: { legalConsent: true, gpsRecordingOptIn: true },
    });
  });
});

describe('TRIP-609 · OS 권한 DENIED(AC-3)', () => {
  it('DENIED 면 토글 real disabled(눌러도 PUT·다이얼로그 무변화) + [설정 이동]→openSettings', async () => {
    primeConsent({ osPermissionMirror: 'DENIED', legalConsent: false });
    mockGetForeground.mockResolvedValue(DENIED);
    render(<LocationConsentPage />);

    // 미러 정착 후 토글이 비활성으로 그려진다.
    await waitFor(() =>
      expect(screen.getByTestId('settings-location-toggle')).toBeDisabled()
    );

    // 급소: 비활성 토글은 press 가 실차단되어 아무 부작용도 없다.
    fireEvent.press(screen.getByTestId('settings-location-toggle'));
    expect(putSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('settings-location-revoke-confirm')).toBeNull();

    // 그리고 설정 이동 배너가 앱 설정을 연다.
    fireEvent.press(screen.getByTestId('settings-location-open-settings'));
    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('짝: 허용이면 토글이 비활성이 아니다', async () => {
    primeConsent({ osPermissionMirror: 'GRANTED', legalConsent: true });
    mockGetForeground.mockResolvedValue(GRANTED);
    render(<LocationConsentPage />);
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));

    expect(screen.getByTestId('settings-location-toggle')).not.toBeDisabled();
  });
});

describe('TRIP-609 · 진입 미러 보고(AC-4)', () => {
  it('진입 시 getForegroundPermissionsAsync 1회 → GRANTED 로 PATCH 1회', async () => {
    mockGetForeground.mockResolvedValue(GRANTED);
    render(<LocationConsentPage />);

    await waitFor(() => expect(mockGetForeground).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    // 서버는 OS 권한을 알 방법이 없어 단말이 알려줘야 한다 — 매핑값이 정확해야 미러가 참이다.
    expect(patchSpy).toHaveBeenCalledWith({
      data: { osPermission: 'GRANTED' },
    });
  });

  it('device 가 denied 면 DENIED 로 미러한다(매핑)', async () => {
    primeConsent({ osPermissionMirror: 'DENIED', legalConsent: false });
    mockGetForeground.mockResolvedValue(DENIED);
    render(<LocationConsentPage />);

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith({ data: { osPermission: 'DENIED' } });
  });
});
