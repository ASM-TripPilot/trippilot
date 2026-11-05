import { Profiler } from 'react';
import { act, render, screen, within } from '@testing-library/react-native';

import { countUpText } from '@/shared/lib/countUp';

import {
  answerReduceMotionSynchronously,
  useAnimatedProbe,
} from '@/test-support/animatedProbe';
import { revealValues } from '@/test-support/revealProbe';

import { COUNT_UP_DURATION_MS, CountUpText } from '@/shared/ui/CountUpText';
import type { DayHighlight, TripSummary } from '@/shared/api/index.schemas';

import { buildSummaryMagazineVM } from '@/features/reflection/index.view';
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

/**
 * TRIP-1666 — 화면 props 는 `vm`(매거진 VM) 하나로 바뀌었다. 손으로 VM 모양을 베끼지 않고 순수 빌더(`buildSummaryMagazineVM`)로 만든다 —
 * VM 모양의 정본은 `summaryMagazineVM.test.ts` 이고 이 파일은 "등장 순서·카운트업"만 잰다.
 */
interface VmOver {
  totalVisits?: number;
  totalDistanceKm?: number;
  totalPhotos?: number;
  hasLocationData?: boolean;
  narrative?: string;
  highlights?: DayHighlight[];
  /** TRIP-1781 — 훅이 고른 표지 사진. */
  coverPhoto?: { uri: string; poiId: string } | null;
}
const hl = (
  date: string,
  dayOrder: number,
  places: string[]
): DayHighlight => ({
  date,
  dayOrder,
  visitCount: places.length,
  places,
});
function vmOf(over: VmOver = {}) {
  const summary: TripSummary = {
    narrative: over.narrative ?? '',
    highlights: over.highlights ?? [hl('2026-06-11', 1, ['광안리 해변'])],
    stats: {
      totalVisits: over.totalVisits ?? 12,
      totalDistanceKm: over.totalDistanceKm ?? 38,
      distanceSource: 'VISIT_LINE',
      totalPhotos: over.totalPhotos ?? 24,
      hasLocationData: over.hasLocationData ?? true,
    },
    source: 'RULE',
    generatedAt: '2026-06-12T10:00:00Z',
  };
  return buildSummaryMagazineVM({ summary, coverPhoto: over.coverPhoto });
}

function baseProps(
  over: Partial<TripSummaryScreenProps> = {}
): TripSummaryScreenProps {
  return {
    vm: vmOf(),
    view: 'MAP',
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

  // 숫자 타일의 화면 순서는 방문 → 사진 → 이동이다(매거진 숫자 타일, TRIP-1666 — 옛 방문·거리·사진 순서에서 바뀜).
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
    renderScreen({ vm: vmOf() });
    await advance(0);
    expect(statTexts()).toEqual(['0', '0', '0km']);
    await advance(100);

    const mid = statTexts();
    expect(mid[2]).toMatch(/^\d+km$/);
    expect(Number(mid[0])).toBeLessThan(12);
    expect(Number(mid[1])).toBeLessThan(24);
    expect(Number.parseInt(mid[2], 10)).toBeLessThan(38);

    await advance(1000);
    expect(statTexts()).toEqual(['12', '24', '38km']);
  });

  it('동작 줄이기면 처음부터 최종값이다', async () => {
    probe.setReduceMotion(true);
    renderScreen({ vm: vmOf() });
    await advance(0);
    expect(statTexts()).toEqual(['12', '24', '38km']);
    await advance(100);
    expect(statTexts()).toEqual(['12', '24', '38km']);
  });

  it('0·측정 못 함(—)인 칸은 숫자를 지어내지 않고 그대로다', async () => {
    probe.setReduceMotion(false);
    renderScreen({
      vm: vmOf({
        totalVisits: 0,
        totalPhotos: 0,
        totalDistanceKm: 0,
        hasLocationData: false,
      }),
    });
    await advance(0);
    expect(statTexts()).toEqual(['0', '0', '—']);
    await advance(300);
    expect(statTexts()).toEqual(['0', '0', '—']);
  });

  // 등장 래퍼는 `shared/ui/RevealItem` 이 한 벌로 맡는다 — 곡선·지연 계산은 그쪽 테스트, 여기는 이 화면이 넘기는 첫 지연(1050 = 경로 0.15+0.9초 뒤)과
  // 카드 순번(내레이션이 있으면 일차 카드가 한 칸 뒤)만 잰다. TRIP-1666: 인용문 testID 노드가 등장 래퍼의 직접 자식이어야 `revealValues` 가 래퍼를 읽는다(구현 쪽 Fragment 루트 계약). 1050 대신 h14 의 500 을 넘기면 1000ms 시점에 이미 보여 red.
  it('내레이션·일차 카드는 경로가 다 그려진 뒤(1050ms) 차례로(150ms 간격) 등장한다', async () => {
    probe.setReduceMotion(false);
    renderScreen({
      vm: vmOf({
        narrative: '3일 동안 12곳을 다녀왔어요.',
        highlights: [
          hl('2026-06-11', 1, ['광안리 해변']),
          hl('2026-06-12', 2, ['전포 카페거리']),
        ],
      }),
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

// TRIP-1736 · 카운트업 시계를 reanimated(UI 스레드)로 옮기고 표시 문자열이 바뀔 때만 다시 그린다(01b Q1=B).
// 이징은 지금 화면 그대로(Q2) — 시계 `Easing.out(Easing.cubic)` 위에 `countUpText` 안 easeOutCubic 이 한 번 더 걸린 곡선.
// jest 프레임은 1ms 라 1ms 마다 act 를 끊어 커밋을 센다. 이관 전 실측(같은 장치): `38km` 커밋 900 · 표시 문자열 39종.
describe('TRIP-1736 · CountUpText — 문자열이 바뀔 때만 다시 그린다', () => {
  const probe = useAnimatedProbe();

  function shownNow(): string {
    const root = screen.toJSON() as { children: unknown[] | null } | null;
    return String(root?.children?.[0]);
  }

  async function play(value: string, ms = COUNT_UP_DURATION_MS + 100) {
    let commits = 0;
    const view = render(
      <Profiler id="count" onRender={() => (commits += 1)}>
        <CountUpText value={value} />
      </Profiler>
    );
    await act(async () => {});
    const mounted = commits;
    const shown = [shownNow()];
    for (let t = 1; t <= ms; t += 1) {
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      shown.push(shownNow());
    }
    const changes = shown.filter((text, i) => i > 0 && text !== shown[i - 1]);
    return {
      view,
      shown,
      changes: changes.length,
      frameCommits: commits - mounted,
    };
  }

  it.each(['38km', '12', '1.9km'])(
    '%s — 재생 중 커밋은 표시 문자열 변경 수 이하, 끝은 입력 그대로',
    async (value) => {
      probe.setReduceMotion(false);
      const { shown, changes, frameCommits } = await play(value);

      expect(shown[0]).not.toBe(value); // 앵커 — 실제로 카운트업이 돌았다
      expect(changes).toBeGreaterThan(0);
      expect(frameCommits).toBeLessThanOrEqual(changes);
      expect(shown.at(-1)).toBe(value);
    }
  );

  it('도중 숫자는 지금 화면 곡선과 같다(시계 ease-out cubic × countUpText)', async () => {
    probe.setReduceMotion(false);
    const { shown } = await play('38km', 700);
    const clock = (ms: number) =>
      1 - (1 - Math.min(1, Math.max(0, ms / COUNT_UP_DURATION_MS))) ** 3;
    // 프레임 반올림으로 앞뒤 몇 ms 어긋나도 되게 ±3ms 창 안의 값 중 하나면 통과. 단일 이징이면 100ms 에 11km 라 걸린다.
    for (const t of [50, 100, 200, 300, 600]) {
      const allowed = [-3, -2, -1, 0, 1, 2, 3].map((d) =>
        countUpText('38km', clock(t + d))
      );
      expect(allowed).toContain(shown[t]);
    }
  });

  it('목표 문자열이 바뀌면 0 부터 다시 재생한다', async () => {
    probe.setReduceMotion(false);
    const { view } = await play('12');
    expect(shownNow()).toBe('12');

    // play() 와 같은 <Profiler> 로 감싸야 같은 인스턴스 갱신이다 — 감싸지 않으면 리마운트라 "다시 재생"을 못 본다(03b 차단 #1).
    view.rerender(
      <Profiler id="count" onRender={() => {}}>
        <CountUpText value="38km" />
      </Profiler>
    );
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
    const restarted = Number.parseInt(shownNow(), 10);
    expect(shownNow()).toMatch(/^\d+km$/);
    expect(restarted).toBeLessThan(38);

    await act(async () => {
      jest.advanceTimersByTime(COUNT_UP_DURATION_MS + 100);
    });
    expect(shownNow()).toBe('38km');
  });
});

// TRIP-1781 · 표지 사진 — 사진이 있으면 표지에 사진·스크림 노드가 서고, 없으면 둘 다 없다(색 표지). 색·농도는 jest 가 안 본다(구조만).
// 훅이 사진을 고르는 흐름은 `TripSummaryPage.integration` 이, 사진 입력 → 표지 값은 `summaryMagazineVM.test` 가 맡는다.
describe('TRIP-1781 · 표지 사진·스크림 노드', () => {
  it('TS-1 · 사진이 있으면 표지에 사진(그 주소)·스크림 노드가 서고 제목은 그대로다', () => {
    renderScreen({
      vm: vmOf({ coverPhoto: { uri: 'file://a', poiId: 'p1' } }),
    });

    const photo = screen.getByTestId('reflection-summary-cover-photo');
    expect(photo.props.source).toEqual([{ uri: 'file://a' }]);
    expect(
      screen.getByTestId('reflection-summary-cover-scrim')
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('reflection-summary-cover')).getByText(
        '12곳 · 사진 24장'
      )
    ).toBeOnTheScreen();
  });

  it('TS-2 · 사진이 없으면 표지는 서고 사진·스크림 노드는 둘 다 없다(짝)', () => {
    renderScreen({ vm: vmOf() });

    expect(screen.getByTestId('reflection-summary-cover')).toBeOnTheScreen();
    expect(screen.queryByTestId('reflection-summary-cover-photo')).toBeNull();
    expect(screen.queryByTestId('reflection-summary-cover-scrim')).toBeNull();
  });
});
