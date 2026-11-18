import { Profiler } from 'react';
import { getAnimatedStyle } from 'react-native-reanimated';
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

  // 등장 래퍼는 `shared/ui/RevealItem` 이 한 벌로 맡는다 — 곡선·지연 계산은 그쪽 테스트, 여기는 이 화면이 넘기는 첫 지연(TRIP-1831 — 0. 종전 1050 은 "지도 경로가
  // 다 그려진 뒤"였는데 지도 분기가 늘 비어 빈 대기였다)과 순번(내레이션이 있으면 일차 카드가 한 칸 뒤, 동선 정류장은 카드 뒤에서 이어짐)만 잰다.
  // TRIP-1666: 인용문 testID 노드가 등장 래퍼의 직접 자식이어야 `revealValues` 가 래퍼를 읽는다(구현 쪽 Fragment 루트 계약).
  const SUMMARY_VM = () =>
    vmOf({
      narrative: '3일 동안 12곳을 다녀왔어요.',
      highlights: [
        hl('2026-06-11', 1, ['광안리 해변']),
        hl('2026-06-12', 2, ['전포 카페거리']),
      ],
    });
  /** 내레이션·일차 카드 둘·동선 정류장 둘 — 화면 순서(= 등장 순번 0~4)대로. */
  const revealNodes = () => [
    screen.getByTestId('reflection-summary-narrative'),
    ...screen.getAllByTestId('reflection-summary-day-card'),
    ...screen.getAllByTestId('reflection-summary-visit-item'),
  ];
  const opacities = () => revealNodes().map((n) => revealValues(n).opacity);
  /** 표지 스티커(StickerPop) 래퍼의 지금 투명도 — 스티커 첫 줄 글자에서 위로 올라가 처음 만나는 투명도 있는 호스트. */
  const stickerOpacity = (): number => {
    let node = screen.getByText('여행').parent;
    while (node) {
      if (typeof node.type === 'string') {
        const style = getAnimatedStyle(node) as { opacity?: unknown };
        if (typeof style.opacity === 'number') return style.opacity;
      }
      node = node.parent;
    }
    return Number.NaN;
  };

  it('첫 방문: 내레이션은 지연 없이 곧장 등장을 시작하고, 일차 카드·동선 정류장이 150ms 간격으로 이어서 올라와 모두 보인다 (TRIP-1831 — 첫 지연 0)', async () => {
    // 준비: 동작 줄이기 끔 + 첫 방문(기본 — `revealing` 을 안 주면 켜짐).
    probe.setReduceMotion(false);
    renderScreen({ vm: SUMMARY_VM() });
    await advance(0);
    expect(revealNodes()).toHaveLength(5); // 앵커 — 내레이션 1 + 일차 카드 2 + 정류장 2

    // 실행 + 단언: 60ms — 내레이션만 시작(옛 1050ms 지연이면 0 이라 red), 나머지는 대기.
    await advance(60);
    let [narrative, day1, day2, stop1, stop2] = opacities();
    expect(narrative).toBeGreaterThan(0);
    expect([day1, day2, stop1, stop2]).toEqual([0, 0, 0, 0]);

    // 220ms — 1일차 카드(순번 1, 150ms 시차)까지 시작, 2일차(300)·정류장(450·600)은 아직.
    await advance(160);
    [narrative, day1, day2, stop1, stop2] = opacities();
    expect(day1).toBeGreaterThan(0);
    expect([day2, stop1, stop2]).toEqual([0, 0, 0]);

    // 500ms — 첫 정류장(순번 3 = 450ms 시작)이 시작했고 둘째(600)는 아직. 정류장 지연도 0 기준이다(옛 1050 이면 0).
    await advance(280);
    [narrative, day1, day2, stop1, stop2] = opacities();
    expect(day2).toBeGreaterThan(0);
    expect(stop1).toBeGreaterThan(0);
    expect(stop2).toBe(0);

    // 1200ms — 마지막 정류장(600 + 450)까지 끝.
    await advance(700);
    expect(opacities()).toEqual([1, 1, 1, 1, 1]);
  });

  it('재방문(revealing=false): 첫 렌더부터 내레이션·일차 카드·동선 정류장이 전부 보이고(투명 구간 없음) 숫자도 처음부터 최종값이며 시간이 흘러도 안 바뀐다 (TRIP-1831)', async () => {
    // 준비: 동작 줄이기 끔 + 이미 본 요약.
    probe.setReduceMotion(false);
    renderScreen({ vm: SUMMARY_VM(), revealing: false });

    // 실행 + 단언 1: 아직 시계를 안 흘렸다(0ms) — 전부 불투명·제자리, 숫자는 최종값.
    await advance(0);
    revealNodes().forEach((node) =>
      expect(revealValues(node)).toEqual({ opacity: 1, translateY: 0 })
    );
    expect(statTexts()).toEqual(['12', '24', '38km']);

    // 단언 2: 100ms 뒤에도 그대로(카운트업이 0 에서 다시 시작하지 않는다).
    await advance(100);
    expect(opacities()).toEqual([1, 1, 1, 1, 1]);
    expect(statTexts()).toEqual(['12', '24', '38km']);
    // 단언 3: 표지 스티커(첫 방문은 350ms 뒤 팝)도 이미 끝 모습이다(6-b 실측으로 보강). 형광펜 색은 style 단언 금지(README 판정 4)라 실화면 몫.
    expect(stickerOpacity()).toBe(1);
  });

  it('첫 방문이면 100ms 에는 스티커가 아직 시작 전이다 — 위 재방문 단언 3 이 공허하지 않다는 짝', async () => {
    probe.setReduceMotion(false);
    renderScreen({ vm: SUMMARY_VM() });
    await advance(100);
    expect(stickerOpacity()).toBe(0);
  });

  it('동작 줄이기 켜짐이면 첫 방문이어도 첫 렌더부터 전부 보인다 (종전 그대로)', async () => {
    probe.setReduceMotion(true);
    renderScreen({ vm: SUMMARY_VM() });

    await advance(0);

    expect(opacities()).toEqual([1, 1, 1, 1, 1]);
    expect(statTexts()).toEqual(['12', '24', '38km']);
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
