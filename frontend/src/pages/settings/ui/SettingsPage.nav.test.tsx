jest.mock('@/shared/api/generated/account/account');
// TRIP-778: profile 은 팩토리 목 — codegen(D1) 전엔 `useGetMeSettings`·`usePatchMeSettings` 가 생성물에
// 없어 자동 목이 이름을 모른다. 기존 export 는 자동 목 그대로 두고 두 이름만 목 함수로 채운다(02a ★2).
jest.mock('@/shared/api/generated/profile/profile', () => ({
  ...jest.createMockFromModule<Record<string, unknown>>(
    '@/shared/api/generated/profile/profile'
  ),
  useGetMeSettings: jest.fn(),
  usePatchMeSettings: jest.fn(),
}));
// TRIP-778: 페이지가 새로 읽는 조회 3종(취향·위치 동의·개인화) — 실 훅이 네트워크로 나가지 않게 자동 목.
jest.mock('@/shared/api/generated/preferences/preferences');
jest.mock('@/shared/api/generated/location/location');
jest.mock('@/shared/api/generated/reflection/reflection');

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { useGetMe } from '@/shared/api/generated/account/account';
import { useGetMeLocationConsent } from '@/shared/api/generated/location/location';
import { useGetMePreferences } from '@/shared/api/generated/preferences/preferences';
import {
  useGetMeProfile,
  useGetMeSettings,
  usePatchMeSettings,
} from '@/shared/api/generated/profile/profile';
import { useGetMePersonalization } from '@/shared/api/generated/reflection/reflection';

import { SettingsPage } from '..';

/**
 * TRIP-618 — l05 설정 진입 배선 승인 테스트(AC-2 · AC-3 · AC-4).
 *
 * 무엇을 보장하나: 위치정보·알림 네비 행을 누르면 `SettingsPage`가 주입한 `router.push`가 **정확한
 * 라우트로 1회** 나간다. 라우트 문자열(/settings/location vs /settings/notifications)은 화면이 아니라
 * 페이지가 쥐므로, 이 문자열을 잠그는 유일한 층이 여기다(SettingsScreen.test.tsx 는 네비 행 렌더만
 * 봤다). "네비 행은 떴지만 onPress 미배선/오배선" 뮤턴트는 여기 `toHaveBeenCalledWith`가 잡는다.
 *
 * ★ expo-router 목 형태(02a ★3): `SettingsPage`는 `useRouter()` 정적 import 를 안 쓴다(node 버킷
 *   ESM 크래시 회피 — 지연-require `require('expo-router').router` 싱글턴, `goBack` 선례). 그래서
 *   목도 `{ router: { push, back } }` 싱글턴 형태다 — `useRouter`는 일부러 안 넣는다(넣으면 잘못된
 *   패턴을 통과시킨다).
 *
 * ★ 목 seam(02a ★4): account·profile 을 **자동 목**해 실 훅이 안 돌아 QueryClient 불필요. GET 2훅만
 *   프라임하면 렌더가 산다 — 뮤테이션 훅은 렌더 시 클로저에만 담겨 역참조 0(02a §5-D).
 *
 * ⚠️ jest 사각(6-b 실기 전용): 실제 화면 전환(마이→설정→위치동의 3-hop)은 못 본다 — 여기선
 *   push 인자·횟수만 관측한다(02a ★8).
 *
 * (개념) 문자열 인자 매처는 완전일치 — `toHaveBeenCalledWith('/settings/location')`는 라우트를
 *  글자 그대로 잠근다(02a §5-A).
 *
 * TRIP-939 AC-1 · TRIP-778 AC-3(재작성): 페이지는 여전히 `filterReadySettingsSections` 로 준비중 행을
 *  거르지만, 취향 7·제휴·개인화가 ready:true 로 열려 운영 화면에 7그룹이 모두 보이고 "준비 중"은 없다
 *  (구 "여행 취향·제휴 그룹째 부재"는 01b 사용자 결정으로 뒤집혔다).
 *
 * TRIP-778 AC-8: 취향 7행은 모두 `/settings/preferences`(전체 편집 화면 하나 — 축 인자 없음)로, 개인화
 *  행은 `/settings/personalization` 으로 push 한다. 라우트 문자열은 페이지가 쥐므로 여기서 잠근다.
 *
 * TRIP-937 AC-3: 앱 정보 그룹의 약관 3행을 누르면 열람 라우트 `/terms/{termsType}` 로 push 한다(심사
 *  가이드라인 5.1.1(i) — 개인정보처리방침 앱 내 접근). 라우트 문자열은 페이지가 쥐므로 여기서 잠근다.
 */

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: mockPush, back: jest.fn() },
}));

/**
 * TRIP-938 준비 단계 — 페이지가 로그아웃 때 캐시를 비우려고 `useQueryClient()` 를 부르므로
 * QueryClientProvider 안에서 그린다(없으면 "No QueryClient set" 으로 렌더가 죽는다, 02a ★5).
 * 조회 훅은 위에서 목하므로 이 클라이언트는 실제로 아무것도 가져오지 않는다.
 */
function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

const mockUseGetMe = useGetMe as jest.Mock;
const mockUseGetMeProfile = useGetMeProfile as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // 렌더가 역참조하는 것은 account.data?.status/email·profile.data?.nickname 뿐(02a §5-D).
  mockUseGetMe.mockReturnValue({
    data: { accountId: 'acc-1', status: 'ACTIVE', email: 'a@b.com' },
  });
  mockUseGetMeProfile.mockReturnValue({ data: { nickname: '여행자123' } });
  // TRIP-778 새 조회·변경 훅 — 응답 전 모양. 이 파일은 라우트만 본다(값·토글은 l05parity.integration).
  (useGetMePreferences as jest.Mock).mockReturnValue({ data: undefined });
  (useGetMeLocationConsent as jest.Mock).mockReturnValue({ data: undefined });
  (useGetMePersonalization as jest.Mock).mockReturnValue({ data: undefined });
  (useGetMeSettings as jest.Mock).mockReturnValue({ data: undefined });
  (usePatchMeSettings as jest.Mock).mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
  });
});

describe('TRIP-618 · SettingsPage 진입 배선', () => {
  it('AC-2: 위치 네비 행 press → router.push("/settings/location") 정확히 1회', () => {
    renderPage();

    // 실행: 위치정보 네비 행을 누른다.
    fireEvent.press(screen.getByTestId('settings-nav-location-consent'));

    // 단언: l06 위치동의 라우트로, 정확히 한 번(중복 push·오배선 차단).
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/settings/location');
  });

  it('AC-3: 알림 네비 행 press → router.push("/settings/notifications") 정확히 1회', () => {
    renderPage();

    fireEvent.press(screen.getByTestId('settings-nav-notifications'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/settings/notifications');
  });

  it('TRIP-939 AC-1 · TRIP-778 AC-3(재작성): 운영 화면에 7그룹이 모두 보이고 "준비 중"은 없다', () => {
    // 준비·실행: 실 페이지를 그린다(페이지가 ready 필터를 거쳐 화면에 넘긴다).
    renderPage();

    const labels = [
      '계정',
      '여행 취향',
      '위치정보',
      '알림',
      '제휴 안내',
      '앱 정보',
      '위험 영역',
    ];
    // 단언: 7그룹이 정본 순서로 있다(i번째 그룹 안에 i번째 라벨, 완전일치).
    const groups = screen.getAllByTestId('settings-group');
    expect(groups).toHaveLength(7);
    labels.forEach((label, i) => {
      expect(within(groups[i]).getByText(label)).toBeOnTheScreen();
    });
    // 단언(부분포함): 준비 중 표기는 어디에도 없다(TRIP-939 — 심사 2.1).
    expect(screen.queryByText(/준비 중/)).toBeNull();
  });

  it.each([
    ['style'],
    ['budget'],
    ['companions'],
    ['activities'],
    ['transport'],
    ['food'],
    ['pace'],
  ])(
    'TRIP-778 AC-8: 취향 행(%s) press → router.push("/settings/preferences") 정확히 1회',
    (key) => {
      renderPage();

      // 실행
      fireEvent.press(screen.getByTestId(`settings-nav-${key}`));

      // 단언: 전체 편집 화면 하나로(축을 URL 에 싣지 않는다), 정확히 한 번.
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('/settings/preferences');
    }
  );

  it('TRIP-778 AC-8: 개인화 행 press → router.push("/settings/personalization") 정확히 1회', () => {
    renderPage();

    fireEvent.press(screen.getByTestId('settings-nav-personalization'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/settings/personalization');
  });

  it.each([['TERMS_OF_SERVICE'], ['PRIVACY_POLICY'], ['LOCATION_TERMS']])(
    'TRIP-937 AC-3: 약관 행(%s) press → router.push("/terms/<termsType>") 정확히 1회',
    (termsType) => {
      // 준비: 실 페이지(필터 통과한 운영 목록).
      renderPage();

      // 실행: 앱 정보 그룹의 약관 행을 누른다.
      fireEvent.press(screen.getByTestId(`settings-nav-terms-${termsType}`));

      // 단언: 열람 라우트(동적 세그먼트)로, 문자열 그대로 정확히 한 번.
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(`/terms/${termsType}`);
    }
  );
});
