import { render, screen, within } from '@testing-library/react-native';

import { TripCard } from './TripCard';
import type { MyTripCardVM } from '../model';

/**
 * TRIP-1121 · AC-4(표시) — 카드 배지 'live' = "여행 중" (Figma `4745:2943`).
 *
 * 무엇을 보장하나:
 *  - badge 'live' 면 배지 글자가 '여행 중'이고, resume CTA 는 없다(`resume` 미전달이어도 — 배지 파생
 *    폴백이 'draft' 에서만 켜진다).
 *  - 색은 작성중과 같은 분기다(01b D5 — Figma 에서 작성중·여행 중 배지 값이 완전히 같다): 배지 바탕
 *    `bg-primary-pale`, 글자 `text-primary-text`. 상태문은 완성과 같은 `text-muted`.
 *
 * 색은 jest 가 픽셀로 못 보므로 className **토큰**으로 잰다. 문자열 포함(`toContain`)을 쓰면
 * `text-primary` 가 `text-primary-text` 안에서 거짓으로 걸린다 → 공백으로 쪼갠 토큰 배열로 비교(02a ★5).
 */

const noop = () => {};

function vm(over: Partial<MyTripCardVM> = {}): MyTripCardVM {
  return {
    tripId: 't1',
    title: '부산 여행',
    metaLine: '9월 29일 ~ 30일 · 1박 2일 · 2명',
    badge: 'live',
    extra: '일정 확정',
    ...over,
  };
}

/** host 요소의 className 을 공백 토큰 배열로(부분 문자열 오탐 방지). */
function tokens(element: { props: { className?: unknown } }): string[] {
  return String(element.props.className ?? '').split(/\s+/);
}

describe('🔴 L1 · live 배지 = "여행 중", resume 없음', () => {
  it('badge=live 면 "여행 중" 배지 · "일정 확정" 상태문이 뜨고 resume CTA 는 없다', () => {
    // 준비·실행
    render(<TripCard vm={vm()} onPress={noop} testIDPrefix="my-trip" />);

    // 단언
    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('여행 중');
    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '일정 확정'
    );
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();
  });
});

describe('🔴 L2 · live 색 = 작성중 분기 (01b D5)', () => {
  it('배지 bg-primary-pale · 글자 text-primary-text · 상태문 text-muted', () => {
    render(<TripCard vm={vm()} onPress={noop} testIDPrefix="my-trip" />);

    const badge = screen.getByTestId('my-trip-badge-t1');
    // 배지 글자 — 라벨 텍스트로 잡는다(L1 이 green 이 된 뒤에야 잡힌다).
    const label = within(badge).getByText('여행 중');

    expect(tokens(badge)).toContain('bg-primary-pale');
    expect(tokens(badge)).not.toContain('bg-success-bg');
    expect(tokens(label)).toContain('text-primary-text');
    expect(tokens(label)).not.toContain('text-success');
    expect(tokens(screen.getByTestId('my-trip-extra-t1'))).toContain(
      'text-muted'
    );
  });
});
