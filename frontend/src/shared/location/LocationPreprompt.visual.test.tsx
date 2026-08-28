import type { ReactElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  LocationPreprompt,
  type LocationPrepromptProps,
} from './LocationPreprompt';

// onDismissNotice 는 게이트① 시점에 아직 없는 옵셔널 prop 이다(01b Q1 = 부모 소유, D2 무상태 유지).
// 동결 소스를 고치지 않고 "구현 후 계약"을 확장 타입으로 선언·재대입한다 — 더 좁은 props 를 받는
// 컴포넌트는 더 넓은 props 자리에 대입 가능하므로 지금도 컴파일되고 구현 후에도 유효하다
// (TermsScreen.visual.test.tsx 의 TermsScreenNext 선례와 동형).
type LocationPrepromptPropsNext = LocationPrepromptProps & {
  /** 안내 줄 닫기(×) 콜백 — 부모가 소유한 1회성 상태를 올려보내는 무동작 optional 콜백. */
  onDismissNotice?: () => void;
};
const LocationPrepromptNext: (
  props: LocationPrepromptPropsNext
) => ReactElement = LocationPreprompt;

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

describe('LocationPreprompt — Figma 문구 채택 지점 (default)', () => {
  it('허용 버튼은 "위치 사용 허용", 보류 버튼은 "나중에 하기" 라벨을 쓴다', () => {
    renderDefault();

    expect(screen.getByTestId('onboarding-location-allow')).toHaveTextContent(
      '위치 사용 허용'
    );
    expect(screen.getByTestId('onboarding-location-later')).toHaveTextContent(
      '나중에 하기'
    );
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

// TRIP-592: 위치 안내가 청록 pale 카드에서 '상하 hairline 인라인 줄 + 뉴트럴 텍스트 + 닫기(×)'로
// 위계를 바꾼다(01b Q3/Q4 확정: 재색만, 문구 현행 유지). 동결 앵커('설정에서' 완전일치)는 보존한다.
describe('LocationPreprompt — 위치 안내 줄 위계 전환 (AC-③-1 · AC-③-2, TRIP-592)', () => {
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

  it('안내 줄이 상하 hairline 인라인 줄이고, 청록 pale 카드(bg-info-bg·border-info-border·rounded-button)가 아니다', () => {
    renderDenied();

    // ▸실행 — 안내 줄은 denied 프레임에서 border-t 를 갖는 유일 노드다(내비바는 border-b 만, 02a §5 실측).
    // 앵커가 0개면 length 단언이 red 라 조용한 통과가 없다(현재 소스는 border-t 0개 → 정상 red).
    const lines = nodesWithToken('border-t');
    expect(lines).toHaveLength(1);
    const tokens = classTokens(lines[0]);

    // ▸단언 — 상하 hairline 실선 존재 + 채움 카드 토큰 3종 부재.
    expect({
      ruleColor: tokens.includes('border-hairline'),
      ruleBottom: tokens.includes('border-b'),
      noInfoBg: tokens.includes('bg-info-bg'),
      noInfoBorder: tokens.includes('border-info-border'),
      noCardRadius: tokens.includes('rounded-button'),
    }).toEqual({
      ruleColor: true,
      ruleBottom: true,
      noInfoBg: false,
      noInfoBorder: false,
      noCardRadius: false,
    });
  });

  it('안내 텍스트가 뉴트럴 text-muted 를 갖고 청록 text-info 는 없다', () => {
    renderDenied();

    // ▸실행 — 동결 앵커('설정에서')의 부모가 곧 안내 텍스트 노드다(02a §5 실측: parentOfTestId).
    const noticeText = parentOfTestId('onboarding-location-denied-notice');
    expect(noticeText).not.toBeNull();
    const tokens = classTokens(noticeText as JsonNode);

    // ▸단언 — 뉴트럴 채택 + 청록 폐기.
    expect({
      neutral: tokens.includes('text-muted'),
      noInfo: tokens.includes('text-info'),
    }).toEqual({ neutral: true, noInfo: false });
  });
});

describe('LocationPreprompt — 안내 줄 닫기(×) 버튼 (AC-③-3 컴포넌트 몫, TRIP-592)', () => {
  it('denied 에서 onDismissNotice 를 주면 닫기 버튼이 렌더되고, 누르면 콜백이 1회 발화된다', () => {
    const onDismissNotice = jest.fn();
    render(
      <LocationPrepromptNext
        purposeContext={PURPOSE}
        state="permission-denied"
        onProceed={jest.fn()}
        onDefer={jest.fn()}
        onOpenSettings={jest.fn()}
        onDismissNotice={onDismissNotice}
      />
    );

    // ▸실행 — × 버튼(신규 testID). 컴포넌트는 상태를 갖지 않고 콜백만 올려보낸다(D2 무상태 유지).
    const dismiss = screen.getByTestId('onboarding-location-notice-dismiss');
    expect(dismiss).toBeOnTheScreen();
    fireEvent.press(dismiss);

    // ▸단언 — 1회성 상태 소유는 부모 몫이므로 여기서는 콜백 발화만 관측한다.
    expect(onDismissNotice).toHaveBeenCalledTimes(1);
  });

  it('onDismissNotice 미전달(기존 호출 형태)이면 denied 안내 앵커가 그대로 남고 크래시가 없다', () => {
    // 옵셔널 additive 무회귀 — 콜백 없는 기존 소비 형태가 그대로 동작해야 한다(01b ★4). × 버튼의
    // 렌더 여부는 계약이 열어 둔다("미지정 시 렌더 안 함 또는 무동작") — 여기서 단언하지 않는다.
    render(
      <LocationPreprompt
        purposeContext={PURPOSE}
        state="permission-denied"
        onProceed={jest.fn()}
        onDefer={jest.fn()}
        onOpenSettings={jest.fn()}
      />
    );

    // 동결 앵커가 보존되고(문구 회귀 없음) denied 진행 수단도 그대로다.
    expect(
      screen.getByTestId('onboarding-location-denied-notice')
    ).toHaveTextContent('설정에서');
    expect(
      screen.getByTestId('onboarding-location-settings')
    ).toBeOnTheScreen();
  });
});
