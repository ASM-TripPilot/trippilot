import { act, render, screen, within } from '@testing-library/react-native';

import {
  answerReduceMotionSynchronously,
  useAnimatedProbe,
} from '@/test-support/animatedProbe';
import { revealValues } from '@/test-support/revealProbe';

import {
  TripSummaryScreen,
  type TripSummaryScreenProps,
} from './TripSummaryScreen';

/**
 * j04 여행 요약 — **모션만** 남긴 뷰 단위(B안 2026-11-01, (c) 통합으로 만들기 어려운 것).
 *
 * 나머지 화면 동작(통계·출처 라벨·문장 카드·일차 카드·방문 목록·공유·하단 바)은 `TripSummaryPage.integration.test.tsx`
 * 가 요약 응답만 바꿔 본다. 카운트업·등장 순서는 가짜 타이머로 프레임을 흘려 재야 해서 화면을 직접 그린다.
 */

function baseProps(
  over: Partial<TripSummaryScreenProps> = {}
): TripSummaryScreenProps {
  return {
    stats: { totalVisits: 12, distanceText: '38km', totalPhotos: 24 },
    distanceSourceLabel: '근사',
    view: 'MAP',
    dayCards: [
      {
        key: '2026-06-11',
        dayLabel: '1일차',
        visitCountLabel: '5곳',
        subtitle: '광안리 해변→전포 카페거리',
      },
    ],
    orderedVisits: [],
    shareEnabled: true,
    onShare: jest.fn(),
    ...over,
  };
}

// 기본은 "동작 줄이기 켜짐"을 동기로 답한다(TRIP-1624) — 케이스마다 `probe.setReduceMotion` 으로 스스로 정한다.
beforeEach(() => answerReduceMotionSynchronously(true));

function renderScreen(over: Partial<TripSummaryScreenProps> = {}) {
  const props = baseProps(over);
  render(<TripSummaryScreen {...props} />);
  return props;
}

describe('TRIP-1386 · 모션', () => {
  const probe = useAnimatedProbe();

  const statTexts = (): string[] => {
    const stats = screen.getByTestId('reflection-summary-stats');
    return within(stats)
      .getAllByText(/^(\d+|\d+(\.\d)?km|—)$/)
      .map((n) => String(n.props.children));
  };

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
  }

  it('카운트업이 끝나면 세 칸이 서버 값과 정확히 같고, 도중에는 최종값보다 작다(같은 형식)', async () => {
    probe.setReduceMotion(false);
    renderScreen({
      stats: { totalVisits: 12, distanceText: '38km', totalPhotos: 24 },
    });
    await advance(0);
    expect(statTexts()).toEqual(['0', '0km', '0']);
    await advance(100);

    const mid = statTexts();
    expect(mid[1]).toMatch(/^\d+km$/);
    expect(Number(mid[0])).toBeLessThan(12);
    expect(Number.parseInt(mid[1], 10)).toBeLessThan(38);
    expect(Number(mid[2])).toBeLessThan(24);

    await advance(1000);
    expect(statTexts()).toEqual(['12', '38km', '24']);
  });

  it('동작 줄이기면 처음부터 최종값이다', async () => {
    probe.setReduceMotion(true);
    renderScreen({
      stats: { totalVisits: 12, distanceText: '38km', totalPhotos: 24 },
    });
    await advance(0);
    expect(statTexts()).toEqual(['12', '38km', '24']);
    await advance(100);
    expect(statTexts()).toEqual(['12', '38km', '24']);
  });

  it('0·측정 못 함(—)인 칸은 숫자를 지어내지 않고 그대로다', async () => {
    probe.setReduceMotion(false);
    renderScreen({
      stats: { totalVisits: 0, distanceText: '—', totalPhotos: 0 },
    });
    await advance(0);
    expect(statTexts()).toEqual(['0', '—', '0']);
    await advance(300);
    expect(statTexts()).toEqual(['0', '—', '0']);
  });

  // 등장 래퍼는 `shared/ui/RevealItem` 이 한 벌로 맡는다 — 곡선·지연 계산은 그쪽 테스트, 여기는 이 화면이 넘기는 첫 지연(1050 = 경로 0.15+0.9초 뒤)과
  // 카드 순번(내레이션이 있으면 일차 카드가 한 칸 뒤)만 잰다. 1050 대신 h14 의 500 을 넘기면 1000ms 시점에 이미 보여 red.
  it('내레이션·일차 카드는 경로가 다 그려진 뒤(1050ms) 차례로(150ms 간격) 등장한다', async () => {
    probe.setReduceMotion(false);
    renderScreen({
      narrative: '3일 동안 12곳을 다녀왔어요.',
      dayCards: [
        {
          key: '2026-06-11',
          dayLabel: '1일차',
          visitCountLabel: '5곳',
          subtitle: '광안리 해변',
        },
        {
          key: '2026-06-12',
          dayLabel: '2일차',
          visitCountLabel: '4곳',
          subtitle: '전포 카페거리',
        },
      ],
    });
    await advance(0);
    const narrative = screen.getByTestId('reflection-summary-narrative');
    const [day1, day2] = screen.getAllByTestId('reflection-summary-day-card');
    const opacities = () =>
      [narrative, day1, day2].map((node) => revealValues(node).opacity);

    await advance(1000);
    expect(opacities()).toEqual([0, 0, 0]); // 경로가 그려지는 동안(첫 카드 1050ms 전) 모두 대기

    await advance(130); // 1130ms — 내레이션(1050)만 시작, 1일차(1200)·2일차(1350)는 아직
    const [first, second, third] = opacities();
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    expect(third).toBe(0);

    await advance(770); // 1900ms — 마지막 카드(1350+450)까지 끝
    expect(opacities()).toEqual([1, 1, 1]);
  });
});
