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
 *  글자 그대로 잠근다(02a §5-A). `fireEvent.press`는 onPress 핸들러가 있어야 발화하고, 준비중 행은
 *  핸들러가 없어 깨끗한 no-op 이다(02a §5-B).
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

  it('AC-4(선제green): 제휴 준비중 행을 눌러도 push 0(무배선 유지, 회귀 앵커)', () => {
    render(<SettingsPage />);

    // 제휴 안내 그룹의 준비중 행(onPress 없음)을 누른다.
    const groups = screen.getAllByTestId('settings-group');
    const affiliate = groups.find(
      (g) => within(g).queryByText('제휴 안내') !== null
    )!;
    fireEvent.press(within(affiliate).getByTestId('settings-row'));

    // 단언: 목적지 라우트가 없는 행은 아무 데도 가지 않는다(INV-4).
    expect(mockPush).not.toHaveBeenCalled();
  });
});
