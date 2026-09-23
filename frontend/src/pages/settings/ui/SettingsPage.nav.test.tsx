jest.mock('@/shared/api/generated/account/account');
jest.mock('@/shared/api/generated/profile/profile');

import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { useGetMe } from '@/shared/api/generated/account/account';
import { useGetMeProfile } from '@/shared/api/generated/profile/profile';

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
 * TRIP-939 AC-1: 준비중 행(ready:false)은 페이지가 `filterReadySettingsSections` 로 걸러 운영 화면에
 *  아예 그리지 않는다(구 "눌러도 push 0" 앵커를 "그룹째 부재"로 뒤집음 — 누를 것이 없어야 심사 2.1 통과).
 *
 * TRIP-937 AC-3: 앱 정보 그룹의 약관 3행을 누르면 열람 라우트 `/terms/{termsType}` 로 push 한다(심사
 *  가이드라인 5.1.1(i) — 개인정보처리방침 앱 내 접근). 라우트 문자열은 페이지가 쥐므로 여기서 잠근다.
 */

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: mockPush, back: jest.fn() },
}));

const mockUseGetMe = useGetMe as jest.Mock;
const mockUseGetMeProfile = useGetMeProfile as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // 렌더가 역참조하는 것은 account.data?.status/email·profile.data?.nickname 뿐(02a §5-D).
  mockUseGetMe.mockReturnValue({
    data: { accountId: 'acc-1', status: 'ACTIVE', email: 'a@b.com' },
  });
  mockUseGetMeProfile.mockReturnValue({ data: { nickname: '여행자123' } });
});

describe('TRIP-618 · SettingsPage 진입 배선', () => {
  it('AC-2: 위치 네비 행 press → router.push("/settings/location") 정확히 1회', () => {
    render(<SettingsPage />);

    // 실행: 위치정보 네비 행을 누른다.
    fireEvent.press(screen.getByTestId('settings-nav-location-consent'));

    // 단언: l06 위치동의 라우트로, 정확히 한 번(중복 push·오배선 차단).
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/settings/location');
  });

  it('AC-3: 알림 네비 행 press → router.push("/settings/notifications") 정확히 1회', () => {
    render(<SettingsPage />);

    fireEvent.press(screen.getByTestId('settings-nav-notifications'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/settings/notifications');
  });

  it('TRIP-939 AC-1: 준비중 행은 운영 화면에 없다 — 여행 취향·제휴 안내 그룹째 빠지고 5그룹만 남는다(TRIP-937 앱 정보 포함)', () => {
    // 준비·실행: 실 페이지를 그린다(페이지가 ready 필터를 거쳐 화면에 넘긴다).
    render(<SettingsPage />);

    // 단언: 계정·위치정보·알림·앱 정보·위험 영역 5그룹뿐이고, 준비중 그룹과 "준비 중" 문구는 없다.
    // TRIP-937: 약관 3행이 ready:true 라 앱 정보 그룹이 필터를 통과한다(01 Q7 — 의도적 갱신).
    const groups = screen.getAllByTestId('settings-group');
    expect(groups).toHaveLength(5);
    expect(
      groups.map((g) =>
        ['계정', '위치정보', '알림', '앱 정보', '위험 영역'].find(
          (label) => within(g).queryByText(label) !== null
        )
      )
    ).toEqual(['계정', '위치정보', '알림', '앱 정보', '위험 영역']);
    expect(screen.queryByText('여행 취향')).toBeNull();
    expect(screen.queryByText('제휴 안내')).toBeNull();
    expect(screen.queryByText(/준비 중/)).toBeNull();
    // 짝 앵커: 개통된 네비 행은 그대로 남아 누를 수 있다(화면이 통째로 빈 것이 아니다).
    fireEvent.press(screen.getByTestId('settings-nav-notifications'));
    expect(mockPush).toHaveBeenCalledWith('/settings/notifications');
  });

  it.each([['TERMS_OF_SERVICE'], ['PRIVACY_POLICY'], ['LOCATION_TERMS']])(
    'TRIP-937 AC-3: 약관 행(%s) press → router.push("/terms/<termsType>") 정확히 1회',
    (termsType) => {
      // 준비: 실 페이지(필터 통과한 운영 목록).
      render(<SettingsPage />);

      // 실행: 앱 정보 그룹의 약관 행을 누른다.
      fireEvent.press(screen.getByTestId(`settings-nav-terms-${termsType}`));

      // 단언: 열람 라우트(동적 세그먼트)로, 문자열 그대로 정확히 한 번.
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(`/terms/${termsType}`);
    }
  );
});
