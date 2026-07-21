import { fireEvent, render, screen } from '@testing-library/react-native';

import { LocationPreprompt } from './LocationPreprompt';

/**
 * AC D1 · D2 · D3 — 위치 프리프롬프트 **프레임** (US-ONB-04 축소분 · BR-U0-30).
 *
 * ⚠️ 이 스위트는 **US-ONB-04 를 완료시키지 않는다.** BR-U0-30 이 요구한 U0 몫(프레임 정의)만
 *    검증한다. 스토리의 정상 AC("위치가 실제 쓰이는 첫 맥락 직전")는 그 맥락 화면
 *    ('내 주변 숙소 탐색'·'여행 중 실행')이 아직 없어 준비(Arrange) 자체가 불가능하다.
 *    발화 지점 배선과 숙소 위치 폴백은 **후속 티켓**이다 — 이 파일이 green 이 돼도
 *    US-ONB-04 를 완료로 표시하지 마라.
 *
 * 무엇을 보장하나: 목적을 설명하고 두 갈래 선택지를 내주되, **OS 권한 다이얼로그를 스스로 부르지
 * 않는다**. 권한 요청 시점의 결정권을 호출자에게 남겨야 BR-U0-30("온보딩 중 발화 없음")을 지킬 수 있다.
 */

// expo-location 을 통째로 가짜로 바꿔 "컴포넌트가 이걸 직접 부르는가"를 관찰한다.
// 부르면 D2 가 빨개진다 — 프레임이 몰래 OS 다이얼로그를 띄우는 회귀를 막는 장치다.
const mockRequestForegroundPermissions = jest.fn();
const mockGetForegroundPermissions = jest.fn();
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForegroundPermissions(...args),
  getForegroundPermissionsAsync: (...args: unknown[]) =>
    mockGetForegroundPermissions(...args),
}));

const PURPOSE = '내 주변 숙소를 찾으려면 현재 위치가 필요해요';

beforeEach(() => {
  mockRequestForegroundPermissions.mockClear();
  mockGetForegroundPermissions.mockClear();
});

describe('LocationPreprompt — 기본 프레임 (AC D1)', () => {
  it('purposeContext 로 받은 목적 설명과 계속·나중에 두 액션을 렌더한다', () => {
    render(
      <LocationPreprompt
        purposeContext={PURPOSE}
        onProceed={jest.fn()}
        onDefer={jest.fn()}
      />
    );

    // 목적은 하드코딩이 아니라 **주입받은 문구**여야 발화 맥락마다 다른 설명을 쓸 수 있다.
    expect(screen.getByTestId('onboarding-location-purpose')).toHaveTextContent(
      PURPOSE
    );
    expect(screen.getByTestId('onboarding-location-allow')).toBeOnTheScreen();
    expect(screen.getByTestId('onboarding-location-later')).toBeOnTheScreen();
  });
});

describe('LocationPreprompt — 콜백만 올려보낸다 (AC D2)', () => {
  it('계속을 탭하면 onProceed 가 호출되고, 컴포넌트가 OS 권한 다이얼로그를 직접 부르지 않는다', () => {
    const onProceed = jest.fn();
    render(
      <LocationPreprompt
        purposeContext={PURPOSE}
        onProceed={onProceed}
        onDefer={jest.fn()}
      />
    );

    fireEvent.press(screen.getByTestId('onboarding-location-allow'));

    expect(onProceed).toHaveBeenCalled();
    // BR-U0-30 — 발화 여부는 호출자가 정한다. 프레임이 직접 부르면 온보딩 중 발화가 돼 버린다.
    expect(mockRequestForegroundPermissions).not.toHaveBeenCalled();
  });

  it('나중에를 탭하면 onDefer 가 호출되고 OS 다이얼로그를 부르지 않는다', () => {
    const onDefer = jest.fn();
    render(
      <LocationPreprompt
        purposeContext={PURPOSE}
        onProceed={jest.fn()}
        onDefer={onDefer}
      />
    );

    fireEvent.press(screen.getByTestId('onboarding-location-later'));

    expect(onDefer).toHaveBeenCalled();
    expect(mockRequestForegroundPermissions).not.toHaveBeenCalled();
  });
});

describe('LocationPreprompt — 권한 거부 상태 (AC D3)', () => {
  it('permission-denied 이면 설정에서 켤 수 있다는 안내와 설정 열기 수단을 보여준다', () => {
    render(
      <LocationPreprompt
        purposeContext={PURPOSE}
        state="permission-denied"
        onProceed={jest.fn()}
        onDefer={jest.fn()}
        onOpenSettings={jest.fn()}
      />
    );

    expect(
      screen.getByTestId('onboarding-location-denied-notice')
    ).toHaveTextContent('설정에서');
    expect(
      screen.getByTestId('onboarding-location-settings')
    ).toBeOnTheScreen();
  });

  it('거부 상태에서도 진행을 막지 않는다 — 계속 진행 수단이 함께 있다 (US-ONB-04 예외 AC)', () => {
    const onProceed = jest.fn();
    render(
      <LocationPreprompt
        purposeContext={PURPOSE}
        state="permission-denied"
        onProceed={onProceed}
        onDefer={jest.fn()}
        onOpenSettings={jest.fn()}
      />
    );

    fireEvent.press(screen.getByTestId('onboarding-location-continue'));

    expect(onProceed).toHaveBeenCalled();
  });
});
