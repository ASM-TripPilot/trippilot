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
 * TRIP-1023 #005 (결정1 · Q2) — 온보딩 위치 단계도 앞으로만. 두 얼굴 모두 머리의 뒤로 셰브론을 뺀다
 * (56px 머리 바 자체는 남긴다 — 바 존치는 6-b 육안). 글리프는 이름으로 찾는다(02a ★5).
 */
function backChevronCount(): number {
  return screen.UNSAFE_root.findAll(
    (node) =>
      typeof node.type === 'function' &&
      /BackChevron/.test((node.type as { name?: string }).name ?? '')
  ).length;
}

describe('🔴 TRIP-1023 #005 — 위치 프리프롬프트 머리에 뒤로 글리프가 없다 (AC-A4)', () => {
  it.each([
    { state: 'default' as const, anchor: 'onboarding-location-hero' },
    {
      state: 'permission-denied' as const,
      anchor: 'onboarding-location-denied-notice',
    },
  ])(
    '$state 얼굴: 본문은 그려지고, 뒤로 셰브론과 뒤로 역할 요소는 없다',
    ({ state, anchor }) => {
      render(
        <LocationPreprompt
          purposeContext={PURPOSE}
          state={state}
          onProceed={jest.fn()}
          onOpenSettings={jest.fn()}
        />
      );

      expect(screen.getByTestId('onboarding-location-root')).toBeOnTheScreen();
      expect(screen.getByTestId(anchor)).toBeOnTheScreen();

      expect(backChevronCount()).toBe(0);
      expect(screen.queryAllByTestId(/back/).length).toBe(0);
    }
  );
});

/**
 * 비주얼 구조 가드 — 옛 LocationPreprompt.visual.test.tsx (c08-location 전체화면 1296:1208 / 1297:1208 ·
 * Seed 확정 1·5 · TRIP-162·717·935).
 *
 * 문구 일반 규칙: testID 만 단언돼 온 지점(allow·later 버튼)은 Figma 문구를 채택하되 TRIP-935 AC-7(R8)로
 * 주 버튼만 "계속"이다(권한 창 앞 안내 버튼이 "허용"이면 심사 5.1.1(iv) 반려, 정본 BR-U0-30 도
 * "목적 설명 + 계속/나중에"). 거부 안내 '설정에서' 앵커는 위 AC D3 가 잠근다.
 * 전체화면 레이아웃 자체와 denied 버튼 라벨은 [검증] 스크린샷 대조 몫.
 */
describe('비주얼 구조', () => {
  // 렌더된 노드의 className 을 공백으로 쪼갠 '토큰 배열'로 만든다. 배열 원소 일치(includes)로만
  // 비교한다 — 부분 문자열 오탐(예: 'border-info-border'.includes('border')) 을 구조적으로 없앤다
  // (SocialLoginScreen.test.tsx `비주얼 구조` §D5 와 동일 근거).
  function classTokens(node: { props?: { className?: unknown } }): string[] {
    const cn = node.props?.className;
    return typeof cn === 'string' ? cn.trim().split(/\s+/).filter(Boolean) : [];
  }

  type JsonNode = {
    props?: { testID?: unknown; className?: unknown };
    children?: (JsonNode | string)[] | null;
  };

  // toJSON(호스트 렌더 결과)을 전위 순회하며 특정 className 토큰을 가진 노드를 모은다. testID 가 없는
  // 안내 줄 컨테이너를 잡을 때 쓴다 — 앵커가 0개면 뒤따르는 length 단언이 red 라 조용한 통과가 없다
  // (SocialLoginScreen.test.tsx `비주얼 구조` §D3 nodesWithToken 과 동형).
  function nodesWithToken(token: string): JsonNode[] {
    const acc: JsonNode[] = [];
    const walk = (n: JsonNode | string | null | undefined): void => {
      if (!n || typeof n === 'string') return;
      if (classTokens(n).includes(token)) acc.push(n);
      (n.children ?? []).forEach(walk);
    };
    const root = screen.toJSON() as unknown as JsonNode | JsonNode[] | null;
    if (Array.isArray(root)) root.forEach(walk);
    else walk(root);
    return acc;
  }

  // 주어진 testID 를 자식으로 갖는 노드(=부모)를 돌려준다. 동결 앵커('설정에서')의 부모가 곧 안내
  // 텍스트 노드라, 그 색 토큰(text-info→text-muted)을 testID 없이 안정적으로 잡는다(02a §5 실측).
  function parentOfTestId(testID: string): JsonNode | null {
    let found: JsonNode | null = null;
    const walk = (n: JsonNode | string | null | undefined): void => {
      if (!n || typeof n === 'string' || found) return;
      for (const child of n.children ?? []) {
        if (
          child &&
          typeof child !== 'string' &&
          child.props?.testID === testID
        ) {
          found = n;
          return;
        }
      }
      (n.children ?? []).forEach(walk);
    };
    const root = screen.toJSON() as unknown as JsonNode | JsonNode[] | null;
    if (Array.isArray(root)) root.forEach(walk);
    else walk(root);
    return found;
  }

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

  describe('LocationPreprompt — 히어로 일러스트 (default)', () => {
    it('레이더 히어로 일러스트 요소가 렌더된다', () => {
      renderDefault();

      // 전체화면 전환의 구조 증거 — 일러스트의 생김새(중첩 ellipse)는 스크린샷이 검증한다.
      expect(screen.getByTestId('onboarding-location-hero')).toBeOnTheScreen();
    });
  });

  // 카드형으로 되돌린다 — hairline 테두리 라운드 카드 + 청록(info) 아이콘 + 15 ink 텍스트, 닫기 없음.
  // 동결 앵커('설정에서' 완전일치)는 보존한다.
  describe('LocationPreprompt — 위치 안내 카드형 복귀 (TRIP-717)', () => {
    function renderDenied() {
      render(
        <LocationPreprompt
          purposeContext={PURPOSE}
          state="permission-denied"
          onProceed={jest.fn()}
          onOpenSettings={jest.fn()}
        />
      );
    }

    it('안내가 hairline 테두리 라운드 카드다(border+rounded-input) — 인라인 줄(border-t/border-b)이 아니다', () => {
      renderDenied();

      // ▸실행 — 카드는 rounded-input 을 갖는 유일 노드다(다른 라운드 토큰과 안 섞임). 0개면 length red.
      const cards = nodesWithToken('rounded-input');
      expect(cards).toHaveLength(1);
      const tokens = classTokens(cards[0]);

      // ▸단언 — 테두리 카드(border+border-hairline+rounded-input) 존재 + 인라인 줄 토큰(border-t/-b) 부재.
      expect({
        border: tokens.includes('border'),
        hairline: tokens.includes('border-hairline'),
        rounded: tokens.includes('rounded-input'),
        noRuleTop: tokens.includes('border-t'),
        noRuleBottom: tokens.includes('border-b'),
      }).toEqual({
        border: true,
        hairline: true,
        rounded: true,
        noRuleTop: false,
        noRuleBottom: false,
      });
    });

    it('안내 텍스트가 15 ink(text-card-title·text-ink)이고 뉴트럴 text-muted 는 없다', () => {
      renderDenied();

      // ▸실행 — 동결 앵커('설정에서')의 부모가 곧 안내 텍스트 노드다(02a §5 실측: parentOfTestId).
      const noticeText = parentOfTestId('onboarding-location-denied-notice');
      expect(noticeText).not.toBeNull();
      const tokens = classTokens(noticeText as JsonNode);

      // ▸단언 — 15 ink 채택 + TRIP-592 뉴트럴 폐기.
      expect({
        size: tokens.includes('text-card-title'),
        ink: tokens.includes('text-ink'),
        noMuted: tokens.includes('text-muted'),
      }).toEqual({ size: true, ink: true, noMuted: false });
    });

    it('닫기(×) 버튼은 더 이상 없다 (onDismissNotice/noticeDismissed 폐기)', () => {
      renderDenied();

      // ▸단언 — × testID 부재 + denied 진행 수단·안내 앵커는 그대로.
      expect(
        screen.queryByTestId('onboarding-location-notice-dismiss')
      ).toBeNull();
      expect(
        screen.getByTestId('onboarding-location-denied-notice')
      ).toHaveTextContent('설정에서');
      expect(
        screen.getByTestId('onboarding-location-settings')
      ).toBeOnTheScreen();
    });
  });

  // TRIP-717 5-b 참고-1 봉합: 하단 바 hairline·default 본문 회색은 testID 없어 무심판이었다
  // (되돌려도 green). 두 노드에 testID/토큰 단언을 걸어 Figma 역행을 jest 가 잡게 한다.
  describe('LocationPreprompt — 하단 바 hairline · default 본문 회색 (TRIP-717)', () => {
    it('default 본문(onboarding-location-purpose)이 text-muted 회색이다(text-ink 회귀 금지)', () => {
      render(
        <LocationPreprompt
          purposeContext={PURPOSE}
          state="default"
          onProceed={jest.fn()}
          onOpenSettings={jest.fn()}
        />
      );

      const tokens = classTokens(
        screen.getByTestId('onboarding-location-purpose')
      );
      expect({
        muted: tokens.includes('text-muted'),
        noInk: tokens.includes('text-ink'),
      }).toEqual({ muted: true, noInk: false });
    });

    it('하단 바(onboarding-location-footer)에 상단 hairline(border-t·border-hairline)이 있다', () => {
      render(
        <LocationPreprompt
          purposeContext={PURPOSE}
          state="default"
          onProceed={jest.fn()}
          onOpenSettings={jest.fn()}
        />
      );

      const tokens = classTokens(
        screen.getByTestId('onboarding-location-footer')
      );
      expect({
        ruleTop: tokens.includes('border-t'),
        hairline: tokens.includes('border-hairline'),
      }).toEqual({ ruleTop: true, hairline: true });
    });
  });
});
