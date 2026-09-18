import { render, screen } from '@testing-library/react-native';

import { TriggerBanner } from './TriggerBanner';

/**
 * TRIP-561 · i01 변수 감지 배너 — 영향 슬롯 카드 안 경고 줄. 순수 프레젠테이션(props 만).
 *
 * 무엇을 보장하나:
 *  - 배너가 완성된 문구(페이지가 서버 reason 을 넣어 조립한 값)를 그린다.
 *  - **버튼·chevron·× 가 없다** — 아이콘+텍스트뿐(라이브 i01 실측, 재계획 어포던스는 i08 칩 소관).
 *  - 색은 토큰 클래스(`bg-primary-pale`·`text-primary-text`).
 *
 * 3동작 뼈대: 준비=text prop → 실행=render → 단언=testID·문구·버튼 부재·토큰.
 * 개념: **queryByTestId** = 없으면 throw 하지 않고 null 을 준다 → 부재 단언(toBeNull)에 쓴다.
 */

function classTokens(node: { props?: { className?: unknown } }): string[] {
  const cn = node.props?.className;
  return typeof cn === 'string' ? cn.split(/\s+/).filter(Boolean) : [];
}

const BODY = '비 예보 · 17시 이후 비 — 실내로 바꾸거나 시간을 당길 수 있어요';

describe('TriggerBanner (i01)', () => {
  it('D1 배너와 완성 문구를 그린다', () => {
    render(<TriggerBanner text={BODY} />);
    expect(screen.getByTestId('execution-live-trigger-banner')).toBeTruthy();
    // 긴 문구라 regex 부분일치로 잰다(toHaveTextContent 문자열은 완전일치라 부적합 — 매처 근거).
    expect(screen.getByText(/17시 이후 비/)).toBeTruthy();
  });

  it('D2 버튼(chevron·×)이 없다 — 아이콘+텍스트뿐', () => {
    render(<TriggerBanner text={BODY} />);
    expect(
      screen.queryByTestId('execution-live-trigger-alternative')
    ).toBeNull();
    expect(screen.queryByTestId('execution-live-trigger-dismiss')).toBeNull();
  });

  it('D3 배경·글자색이 raw hex 가 아니라 primary 토큰 클래스다', () => {
    render(<TriggerBanner text={BODY} />);
    const banner = screen.getByTestId('execution-live-trigger-banner');
    expect(classTokens(banner)).toContain('bg-primary-pale');
    const body = screen.getByText(/17시 이후 비/);
    expect(classTokens(body)).toContain('text-primary-text');
  });
});
