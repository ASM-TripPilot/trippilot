import { render, screen } from '@testing-library/react-native';

import { LocationPreprompt } from './LocationPreprompt';

// 렌더된 노드의 className 을 공백으로 쪼갠 '토큰 배열'로 만든다. 배열 원소 일치(includes)로만
// 비교한다 — 부분 문자열 오탐(예: 'border-info-border'.includes('border')) 을 구조적으로 없앤다
// (SocialLoginScreen.visual.test.tsx §D5 와 동일 근거).
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
// (SocialLoginScreen.visual.test.tsx §D3 nodesWithToken 과 동형).
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

/**
 * c08-location 전체화면 전환(1296:1208 / 1297:1208) 구조 가드 (Seed 확정 1·5, TRIP-162).
 *
 * 문구 일반 규칙(Seed 확정 1)의 두 갈래를 이 파일이 고정한다:
 *  - testID 만 단언돼 온 지점(allow·later 버튼) → **Figma 문구 채택** ("위치 사용 허용"/"나중에 하기")
 *    → TRIP-935 AC-7(R8): 주 버튼만 "계속"으로 뒤집었다. 권한 창 앞 안내 화면 버튼이 "허용"이면
 *    심사 5.1.1(iv) 반려 사례이고, 정본 BR-U0-30 도 "목적 설명 + 계속/나중에"다. testID 는 유지.
 *  - 동결 테스트가 문구를 단언하는 지점(거부 안내 '설정에서') → **기존 문구 유지**
 *
 * 전체화면 레이아웃 자체(카드 → 풀스크린)와 denied 버튼 라벨은 [검증] 스크린샷 대조 몫.
 * 기존 testID 전량 보존(AC-INV1)·콜백 계약은 동결 테스트(LocationPreprompt.test.tsx)가 커버한다.
 */

const PURPOSE = '내 주변 숙소를 찾으려면 현재 위치가 필요해요';

function renderDefault() {
  render(
    <LocationPreprompt
      purposeContext={PURPOSE}
      onProceed={jest.fn()}
      onDefer={jest.fn()}
    />
  );
}

describe('LocationPreprompt — 버튼 문구 (default · TRIP-935 AC-7)', () => {
  it('주 버튼은 "계속", 보류 버튼은 "나중에 하기" 라벨을 쓴다(BR-U0-30)', () => {
    renderDefault();

    // 완전일치 — 버튼 안 글자 전체가 정확히 "계속"(부분 포함 아님).
    expect(screen.getByTestId('onboarding-location-allow')).toHaveTextContent(
      '계속'
    );
    expect(screen.getByTestId('onboarding-location-later')).toHaveTextContent(
      '나중에 하기'
    );
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

describe('LocationPreprompt — 기존 문구 유지 지점 (denied)', () => {
  it('전체화면 전환 후에도 거부 안내에 "설정에서" 조각이 남아 있다', () => {
    render(
      <LocationPreprompt
        purposeContext={PURPOSE}
        state="permission-denied"
        onProceed={jest.fn()}
        onDefer={jest.fn()}
        onOpenSettings={jest.fn()}
      />
    );

    // 동결 테스트와 같은 앵커를 새 파일에서도 고정한다 — 전면 재작성 중 문구 회귀 방지.
    expect(
      screen.getByTestId('onboarding-location-denied-notice')
    ).toHaveTextContent('설정에서');
  });
});

// TRIP-717: TRIP-592 인라인 줄(상하 hairline·뉴트럴 text·닫기 ×)을 Figma 1297:1208 정본
// 카드형으로 되돌린다 — hairline 테두리 라운드 카드 + 청록(info) 아이콘 + 15 ink 텍스트, 닫기 없음.
// 동결 앵커('설정에서' 완전일치)는 보존한다.
describe('LocationPreprompt — 위치 안내 카드형 복귀 (TRIP-717)', () => {
  function renderDenied() {
    render(
      <LocationPreprompt
        purposeContext={PURPOSE}
        state="permission-denied"
        onProceed={jest.fn()}
        onDefer={jest.fn()}
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
        onDefer={jest.fn()}
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
        onDefer={jest.fn()}
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
