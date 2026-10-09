import { fireEvent, render, screen } from '@testing-library/react-native';

import { LocationPreprompt } from '@/shared/location/LocationPreprompt';

import { PushPreprompt } from './PushPreprompt';

/**
 * TRIP-1108 · c08-push 푸시 알림 사전 안내 카드(Figma 4774:2960) — **화면(순수 뷰)**.
 *
 * 무엇을 보장하나:
 *  - 벨 히어로 · 제목 · 목적 · 보조 문구와 `계속` 버튼 하나를 그린다(건너뛰기 없음 — 5.1.1(iv))(문구는 Figma 원문, 2줄 개행 포함).
 *  - 권한 창 앞 안내라 어디에도 "허용"을 쓰지 않는다(TRIP-935 R8 · 심사 5.1.1(iv)).
 *  - 버튼은 콜백만 올려보낸다 — OS 권한 창·토큰 등록은 호출자(페이지) 몫이다.
 *  - 바로 앞 화면인 위치 카드와 하단 바·버튼·히어로 틀이 같다(R5 선례 복제).
 *
 * 지뢰 목: 아래 세 모듈은 **실리는 순간** 터진다. 카드가 OS 알림 API 나 권한 루틴을 import 만 해도
 * 이 파일 전체가 red 다 — "부르지 않았다"(0회)보다 강한 "싣지도 않았다"를 잰다.
 */
jest.mock('@/shared/push/register', () => {
  throw new Error('카드가 권한 루틴(@/shared/push/register)을 실었다');
});
jest.mock('@/shared/push/request', () => {
  throw new Error('카드가 권한 요청(@/shared/push/request)을 실었다');
});
jest.mock('expo-notifications', () => {
  throw new Error('카드가 expo-notifications(OS 알림 API)를 실었다');
});

const TITLE = '알림을 켜면 여행 중 변화를\n바로 알 수 있어요';
const PURPOSE =
  '일정 시작 전 리마인드와 여행 중 날씨·휴무 변화를\n푸시로 알려 드려요';
const AUX = '알림은 언제든 설정에서 끌 수 있어요';

/** 공백 정규화된 문구 — getByText 로 노드를 찾을 때 쓴다(개행 = 공백으로 본다). */
function normalized(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/**
 * Text 노드의 문자열 자식을 원문 그대로 이어 붙인다. `toHaveTextContent`·`getByText` 는 공백을
 * 정규화해 `\n` 이 빠져도 통과하므로, Figma "2줄 고정 개행"은 이것으로 `===` 비교한다.
 */
function rawText(node: { props: { children?: unknown } }): string {
  const { children } = node.props;
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) {
    return children.filter((c) => typeof c === 'string').join('');
  }
  return '';
}

type JsonNode = {
  props?: { testID?: unknown; className?: unknown };
  children?: (JsonNode | string)[] | null;
};

/** testID 를 가진 노드의 **부모** className(문자열). 없으면 null. */
function parentClassOf(testID: string): string | null {
  let found: string | null = null;
  const walk = (n: JsonNode | string | null | undefined): void => {
    if (!n || typeof n === 'string' || found !== null) return;
    for (const child of n.children ?? []) {
      if (
        child &&
        typeof child !== 'string' &&
        child.props?.testID === testID
      ) {
        found = String(n.props?.className ?? '');
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

function classOf(testID: string): string {
  return String(screen.getByTestId(testID).props.className ?? '');
}

function renderCard(onProceed = jest.fn()) {
  render(<PushPreprompt onProceed={onProceed} />);
  return { onProceed };
}

describe('🔴 TRIP-1108 AC-2 · 카드 표면 — 히어로·제목·목적·보조 문구', () => {
  it('P1 루트·벨 히어로·목적 문단이 보이고, 제목·목적은 Figma 원문 2줄 개행 그대로다', () => {
    // 준비·실행
    renderCard();

    // 단언 — 뼈대
    expect(screen.getByTestId('onboarding-push-root')).toBeOnTheScreen();
    expect(screen.getByTestId('onboarding-push-hero')).toBeOnTheScreen();
    expect(screen.getByTestId('onboarding-push-purpose')).toBeOnTheScreen();

    // 단언 — 문구 원문(개행 포함, 문자열 === 비교)
    expect(rawText(screen.getByTestId('onboarding-push-purpose'))).toBe(
      PURPOSE
    );
    expect(rawText(screen.getByText(normalized(TITLE)))).toBe(TITLE);
    expect(screen.getByText(AUX)).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-1108 AC-10 · 버튼 문구 — "허용"을 쓰지 않는다(R8)', () => {
  it('P2 주 버튼은 정확히 "계속"이고 보류 버튼은 없으며, 카드 어디에도 "허용"이 없다', () => {
    renderCard();

    // toHaveTextContent(문자열) = 완전 일치(공백 정규화 후)
    expect(screen.getByTestId('onboarding-push-allow')).toHaveTextContent(
      '계속'
    );
    expect(screen.queryByTestId('onboarding-push-later')).toBeNull();
    expect(screen.queryByText(/나중에/)).toBeNull();
    // 긍정 앵커(위) + 부정 — 카드가 그려진 상태에서 "허용" 글자 0건.
    expect(screen.queryAllByText(/허용/)).toHaveLength(0);
  });
});

describe('🔴 TRIP-1108 · 콜백만 올려보낸다', () => {
  it('P3 "계속"을 누르면 onProceed 1회', () => {
    const { onProceed } = renderCard();

    fireEvent.press(screen.getByTestId('onboarding-push-allow'));

    expect(onProceed).toHaveBeenCalledTimes(1);
  });

  it('P6 카드 모듈은 OS 알림 API·권한 루틴을 싣지 않는다(파일 머리 지뢰 목 아래에서 그려진다)', () => {
    renderCard();

    expect(screen.getByTestId('onboarding-push-root')).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-1108 R5 · 바로 앞 위치 카드와 틀이 같다', () => {
  it('P5 하단 바·주 버튼·히어로 틀의 className 이 위치 카드 default 와 글자까지 같다', () => {
    // 준비 — 기준(위치 카드)을 먼저 그려 문자열로 떠 둔다.
    const location = render(
      <LocationPreprompt purposeContext="x" onProceed={jest.fn()} />
    );
    const expected = {
      allow: classOf('onboarding-location-allow'),
      footer: parentClassOf('onboarding-location-allow'),
      hero: classOf('onboarding-location-hero'),
    };
    location.unmount();
    // 기준 앵커 — 빈 문자열끼리 같아서 통과하는 일을 막는다.
    expect(expected.allow).toContain('bg-primary');
    expect(expected.footer).toContain('border-t');

    // 실행
    renderCard();

    // 단언 — 문자열끼리 비교(노드 객체를 expect 에 넣지 않는다)
    expect(classOf('onboarding-push-allow')).toBe(expected.allow);
    expect(parentClassOf('onboarding-push-allow')).toBe(expected.footer);
    expect(classOf('onboarding-push-hero')).toBe(expected.hero);
  });
});
