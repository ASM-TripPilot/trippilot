import { render, screen } from '@testing-library/react-native';

import { TripCard } from './TripCard';
import type { MyTripCardVM } from '../model';

/**
 * TRIP-1121 · AC-4(표시) — 카드 배지 'live' = "여행 중" (Figma `4745:2943`).
 *
 * 무엇을 보장하나:
 *  - badge 'live' 면 배지 글자가 '여행 중'이고, resume CTA 는 없다(`resume` 미전달이어도 — 배지 파생
 *    폴백이 'draft' 에서만 켜진다).
 *  - 색(작성중과 같은 분기, 01b D5)은 실화면 QA 몫이다.
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

// L2(live 배지·글자·상태문 색 토큰)는 jest-cut 에서 지웠다 — 색 토큰이라 실화면 QA 몫.
