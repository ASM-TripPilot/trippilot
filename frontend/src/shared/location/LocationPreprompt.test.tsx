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
  it('purposeContext 로 받은 목적 설명과 계속 액션을 렌더한다', () => {
    render(
      <LocationPreprompt purposeContext={PURPOSE} onProceed={jest.fn()} />
    );

    // 목적은 하드코딩이 아니라 **주입받은 문구**여야 발화 맥락마다 다른 설명을 쓸 수 있다.
    expect(screen.getByTestId('onboarding-location-purpose')).toHaveTextContent(
      PURPOSE
    );
    expect(screen.getByTestId('onboarding-location-allow')).toBeOnTheScreen();
  });
});

describe('LocationPreprompt — 콜백만 올려보낸다 (AC D2)', () => {
  it('계속을 탭하면 onProceed 가 호출되고, 컴포넌트가 OS 권한 다이얼로그를 직접 부르지 않는다', () => {
    const onProceed = jest.fn();
    render(
      <LocationPreprompt purposeContext={PURPOSE} onProceed={onProceed} />
    );

    fireEvent.press(screen.getByTestId('onboarding-location-allow'));

    expect(onProceed).toHaveBeenCalled();
    // BR-U0-30 — 발화 여부는 호출자가 정한다. 프레임이 직접 부르면 온보딩 중 발화가 돼 버린다.
    expect(mockRequestForegroundPermissions).not.toHaveBeenCalled();
  });

  // 5.1.1(iv): 안내 화면에는 건너뛰기가 없다 — OS 창을 피할 출구 자체를 잠근다.
  it('default 에는 건너뛰기("나중에") 버튼이 없다', () => {
    render(
      <LocationPreprompt purposeContext={PURPOSE} onProceed={jest.fn()} />
    );

    expect(screen.queryByTestId('onboarding-location-later')).toBeNull();
    expect(screen.queryByText(/나중에/)).toBeNull();
  });
});

describe('LocationPreprompt — 권한 거부 상태 (AC D3)', () => {
  it('permission-denied 이면 설정에서 켤 수 있다는 안내와 설정 열기 수단을 보여준다', () => {
    render(
      <LocationPreprompt
        purposeContext={PURPOSE}
        state="permission-denied"
        onProceed={jest.fn()}
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
        onOpenSettings={jest.fn()}
      />
    );

    fireEvent.press(screen.getByTestId('onboarding-location-continue'));

    expect(onProceed).toHaveBeenCalled();
  });
});

/**
 * 비주얼 구조 가드 — 옛 LocationPreprompt.visual.test.tsx (c08-location 전체화면 4975:3306 / 4973:3306 ·
 * Seed 확정 1·5 · TRIP-162·717·935).
 *
 * 문구 일반 규칙: testID 만 단언돼 온 지점(allow·later 버튼)은 Figma 문구를 채택하되 TRIP-935 AC-7(R8)로
 * 주 버튼만 "계속"이다(권한 창 앞 안내 버튼이 "허용"이면 심사 5.1.1(iv) 반려, 정본 BR-U0-30 도
 * "목적 설명 + 계속/나중에"). 거부 안내 '설정에서' 앵커는 위 AC D3 가 잠근다.
 * 전체화면 레이아웃 자체와 denied 버튼 라벨은 [검증] 스크린샷 대조 몫.
 */
describe('비주얼 구조', () => {
  function renderDefault() {
    render(
      <LocationPreprompt purposeContext={PURPOSE} onProceed={jest.fn()} />
    );
  }

  describe('LocationPreprompt — 버튼 문구 (default · TRIP-935 AC-7)', () => {
    it('주 버튼은 "계속" 라벨을 쓰고 보류 버튼은 없다(5.1.1(iv))', () => {
      renderDefault();

      // 완전일치 — 버튼 안 글자 전체가 정확히 "계속"(부분 포함 아님).
      expect(screen.getByTestId('onboarding-location-allow')).toHaveTextContent(
        '계속'
      );
      expect(screen.queryByTestId('onboarding-location-later')).toBeNull();
    });
  });

  describe('🔴 TRIP-935 AC-7 · 권한 안내 화면에 "허용" 단어가 없다 (default)', () => {
    it('default 상태 어디에도 "허용"이 들어간 글자가 없다(5.1.1(iv))', () => {
      renderDefault();

      // 앵커 — 주 버튼은 그려졌다.
      expect(screen.getByTestId('onboarding-location-allow')).toBeOnTheScreen();
      expect(screen.queryAllByText(/허용/)).toHaveLength(0);
    });
  });

  // 히어로 일러스트 존재·닫기(×) 부재(TRIP-717)는 jest-cut A 에서 지웠다 — 생김새·지운 것의 재등장이라 실화면 QA 몫(permissions.md 위치 사전 안내).
});

// TRIP-1427 (Q-016 · 결정 3) — 거부 본문에서 내부 용어 '온보딩'을 빼고, 숙소를 등록한 적 없는 신규 사용자 기준으로 쓴다.
describe('LocationPreprompt — 거부 본문 문구 (AC-L4)', () => {
  const DENIED_BODY =
    '위치 없이도 계속 쓸 수 있어요.\n숙소를 등록하면 그 위치를 기준으로 탐색·동선을 안내해 드릴게요.';

  /** `toHaveTextContent` 는 공백을 정규화해 `\n` 이 빠져도 통과한다 — 원문 비교용(PushPreprompt.test 선례). */
  function rawText(node: { props: { children?: unknown } }): string {
    const { children } = node.props;
    if (typeof children === 'string') return children;
    if (Array.isArray(children)) {
      return children.filter((c) => typeof c === 'string').join('');
    }
    return '';
  }

  it('본문은 새 문구 원문(개행 포함) 그대로이고, 거부 프레임 어디에도 "온보딩"이 없다', () => {
    // 준비·실행
    render(
      <LocationPreprompt
        purposeContext={PURPOSE}
        state="permission-denied"
        onProceed={jest.fn()}
        onOpenSettings={jest.fn()}
      />
    );

    // 단언 — 본문 원문
    expect(rawText(screen.getByTestId('onboarding-location-denied-body'))).toBe(
      DENIED_BODY
    );
    // 단언 — 프레임이 그려진 상태에서 '온보딩' 글자 0건
    expect(screen.getByTestId('onboarding-location-root')).toBeOnTheScreen();
    expect(screen.queryAllByText(/온보딩/)).toHaveLength(0);
  });
});
