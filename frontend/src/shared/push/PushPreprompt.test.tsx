import { fireEvent, render, screen } from '@testing-library/react-native';

import { PushPreprompt } from './PushPreprompt';

/**
 * TRIP-1108 · c08-push 푸시 알림 사전 안내 카드(Figma 4774:2960) — **화면(순수 뷰)**.
 *
 * 무엇을 보장하나:
 *  - 벨 히어로 · 제목 · 목적 · 보조 문구와 `계속` 버튼 하나를 그린다(건너뛰기 없음 — 5.1.1(iv))(문구는 Figma 원문, 2줄 개행 포함).
 *  - 권한 창 앞 안내라 어디에도 "허용"을 쓰지 않는다(TRIP-935 R8 · 심사 5.1.1(iv)).
 *  - 버튼은 콜백만 올려보낸다 — OS 권한 창·토큰 등록은 호출자(페이지) 몫이다.
 * (TRIP-1356 — 「OS 알림 API·권한 루틴을 싣지 않는다」 지뢰 목과 P6 it 을 지웠다: import 구조 가드. 부르지 않음은 P3 콜백 계약이 본다.)
 */

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
});
