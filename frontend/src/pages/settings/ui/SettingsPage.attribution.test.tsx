import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Linking from 'expo-linking';

import { useGetMe } from '@/shared/api/generated/account/account';
import { useGetMeProfile } from '@/shared/api/generated/profile/profile';

import { SettingsPage } from '..';

// 목 3개 — babel-jest 가 이 호출들을 import 보다 위로 끌어올린다(hoist), 그래서 import 가 가짜를 받는다.
jest.mock('@/shared/api/generated/account/account');
jest.mock('@/shared/api/generated/profile/profile');
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));

/**
 * TRIP-886 AC-3 · Q3 — 설정 페이지의 OSM 출처 링크 배선.
 *
 * 무엇을 보장하나:
 *  - AC-3: OSM 줄을 누르면 페이지가 `expo-linking` 의 `openURL` 을 저작권 페이지 URL(완전일치)로
 *    정확히 1회 부른다. URL 은 화면이 아니라 페이지가 쥐므로 이 층에서만 잠긴다.
 *  - Q3(01b "링크 실패는 무시"): 브라우저를 못 열어 openURL 이 reject 해도 앱이 죽지 않는다.
 *
 * ★ 판정 장치(02a ★6): 처리 안 된 reject 는 jest 가 가로채 **그 테스트를 실패로** 만든다 —
 *  `process.on('unhandledRejection')` 리스너는 이 환경에서 불리지 않는다(02a §5-C 실측). 그래서 실패 삼키기
 *  테스트는 별도 리스너 없이 `await act(...)` 로 비동기를 흘려보내기만 하면 된다.
 *
 * ★ 목(02a ★5·★11): `expo-linking` 은 팩토리 목(파일 맨 위로 hoist — 팩토리 안에서 바깥 변수를 쓰지
 *  않는다). account·profile 은 자동 목이라 조회 훅 2개만 값을 채우면 렌더가 산다. 페이지가 로그아웃용
 *  `useQueryClient()` 를 부르므로 QueryClientProvider 로 감싼다(TRIP-938).
 *
 * ⚠️ jest 사각(6-b 실기 전용): 실제로 브라우저가 열리는지는 못 본다 — openURL 인자·횟수만 관측한다.
 *
 * (개념) `mockResolvedValue(x)` = 그 async 가짜가 x 로 성공, `mockRejectedValue(e)` = e 로 실패(reject).
 * (개념) `await act(async () => …)` = 안의 동작이 일으킨 상태 변경·Promise 후속 처리를 끝까지 흘려보낸 뒤
 *  다음 줄로 간다.
 */

const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

const mockOpenURL = Linking.openURL as jest.Mock;
const mockUseGetMe = useGetMe as jest.Mock;
const mockUseGetMeProfile = useGetMeProfile as jest.Mock;

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseGetMe.mockReturnValue({
    data: { accountId: 'acc-1', status: 'ACTIVE', email: 'a@b.com' },
  });
  mockUseGetMeProfile.mockReturnValue({ data: { nickname: '여행자123' } });
});

describe('TRIP-886 · SettingsPage OSM 출처 링크 배선 (AC-3 · Q3)', () => {
  it('AC-3: OSM 줄 press → Linking.openURL("https://www.openstreetmap.org/copyright") 정확히 1회', async () => {
    // 준비: 링크 열기가 성공하는 상황.
    mockOpenURL.mockResolvedValue(true);
    renderPage();
    // 그리기만으로는 열지 않는다.
    expect(mockOpenURL).not.toHaveBeenCalled();

    // 실행: OSM 줄을 누른다.
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-osm-copyright'));
    });

    // 단언: 저작권 페이지 URL 로, 정확히 한 번.
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).toHaveBeenCalledWith(OSM_COPYRIGHT_URL);
  });

  it('Q3: openURL 이 실패(reject)해도 앱이 죽지 않고 출처 문구가 그대로 남는다', async () => {
    // 준비: 브라우저를 열 수 없는 상황(열기 실패).
    mockOpenURL.mockRejectedValue(new Error('no browser'));
    renderPage();

    // 실행: OSM 줄을 누르고 비동기 실패까지 흘려보낸다(처리 안 되면 jest 가 이 테스트를 실패시킨다).
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-osm-copyright'));
    });

    // 단언: 열기를 시도했고, 화면은 살아 있다.
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(screen.getByText('© OpenStreetMap contributors')).toBeTruthy();
  });
});
