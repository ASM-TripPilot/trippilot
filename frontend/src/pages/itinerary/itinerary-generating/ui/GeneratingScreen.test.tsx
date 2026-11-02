import {
  fireEvent,
  render,
  screen,
  within,
  act,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { hostNodes, useAnimatedProbe } from '@/test-support/animatedProbe';

import { GeneratingScreen } from './GeneratingScreen';

/**
 * h07 "AI가 일정 짜는 중" 화면 — **페이지 통합으로 못 만드는 것만** 남긴 뷰 단위 파일(B안 (c), 2026-11-01).
 *
 * 나머지(진행 골격·숫자 어휘 없음·실패/한도 얼굴·버튼 배선·펄스 원 개수·장식 그림 숨김/글자 0)는
 * `GeneratingPage.integration.test.tsx` 가 실 react-query + MSW 로 본다. 남긴 이유:
 *  - 동작 줄이기(진행 바·단계 펄스·장식 그림): 가짜 타이머 + JS 드라이버 강제(`useAnimatedProbe`)가 필요한데
 *    가짜 타이머는 MSW 응답을 멈춘다 — 통합 버킷에서 못 돈다.
 *  - 한도 > 409 > 실패 판정 순서: 페이지가 세 얼굴 값을 한꺼번에 넘기는 응답 조합이 없다.
 */

const noop = () => {};

describe('AI 일일 한도 얼굴 — 판정 순서', () => {
  function limitProps() {
    return { onContinueManual: jest.fn(), onClose: jest.fn() };
  }

  describe('🔴 L2 · AC-17 — 한도 > 409 안내 > 실패 (판정 순서)', () => {
    it('한도·409·실패가 한꺼번에 와도 한도 얼굴만 그린다', () => {
      render(
        <GeneratingScreen
          onBackground={noop}
          onRetry={noop}
          failed
          busy={{
            cancelable: true,
            onCancelAndRetry: noop,
            onWait: noop,
          }}
          aiLimit={limitProps()}
        />
      );

      expect(screen.getByTestId('ai-limit-notice')).toBeOnTheScreen();
      expect(screen.queryByTestId('itinerary-generation-busy')).toBeNull();
      expect(screen.queryByTestId('itinerary-generating-failed')).toBeNull();
    });
  });
});

// TRIP-1069 · 옛 GeneratingScreen.bar.test.tsx — 가짜 타이머·Animated 스파이는 이 describe 안에서만 켠다.
describe('진행 바 · 동작 줄이기', () => {
  /**
   * TRIP-1125 · h07 진행 바(`itinerary-generating-progress`)의 동작 줄이기 계약(AC-9, 01b Q2=(b)). "바가 실제로
   * 미끄러지는가"(옛 B-1)와 "확인이 오기 전에 떠나면 안 움직인다"(옛 B-3)는 TRIP-1352 에서 지웠다 — 가짜 타이머로
   * 애니메이션 값을 훑는 심판은 접근성 계약이 아니라 구현을 재서 느리고 깨지기 쉽다(실움직임은 6-b).
   *
   * ⚠️ jest 는 `onLayout` 을 부르지 않아 트랙 폭이 0 → translateX 가 항상 0 이다. 폭을 주지 않고
   *   "안 움직인다"를 재면 동작 줄이기를 무시하는 코드도 공허하게 통과한다 — 그래서 layout 이벤트로
   *   폭 300 을 먼저 준다.
   */
  const probe = useAnimatedProbe();

  const noop = () => {};
  const BAR = 'itinerary-generating-progress';
  const TRACK_WIDTH = 300;

  function giveTrackWidth(): void {
    fireEvent(screen.getByTestId(BAR), 'layout', {
      nativeEvent: { layout: { width: TRACK_WIDTH, height: 8 } },
    });
  }

  /**
   * 트랙 안 세그먼트의 폭·translateX. 트랙 바로 아래 자식은 `Animated.View` 합성 노드라 style 에
   * 보간 객체가 들어 있다 — 값이 풀린 **첫 호스트 자손**을 읽는다.
   */
  function segment(): { width: number; translateX: number } {
    const [, seg] = hostNodes(screen.getByTestId(BAR));
    if (!seg) throw new Error('진행 바 세그먼트가 없다');
    const style = StyleSheet.flatten(seg.props.style) ?? {};
    const transforms = (style.transform ?? []) as Record<string, unknown>[];
    const translate = transforms.find((entry) => 'translateX' in entry);
    return {
      width: Number(style.width ?? 0),
      translateX: Number(translate?.translateX ?? 0),
    };
  }

  describe('🔴 B-2 · AC-9 · Q2(b) — 동작 줄이기가 켜져 있으면 바가 보이는 채로 한 자리에 멈춘다', () => {
    it('시간이 흘러도 세그먼트가 그대로이고, 트랙 안에 완전히 보인다', async () => {
      probe.setReduceMotion(true);
      render(<GeneratingScreen onBackground={noop} onRetry={noop} />);
      await act(async () => {});
      giveTrackWidth();

      const faces = [JSON.stringify(segment())];
      for (let t = 0; t < 3000; t += 20) {
        act(() => {
          jest.advanceTimersByTime(20);
        });
        faces.push(JSON.stringify(segment()));
      }
      expect(new Set(faces).size).toBe(1);

      // 빈 회색 트랙(세그먼트가 왼쪽 밖에 숨음)이 아니다 — 폭 전체가 트랙 안에 있다.
      const { width, translateX } = segment();
      expect(width).toBeGreaterThan(0);
      expect(translateX).toBeGreaterThanOrEqual(0);
      expect(translateX + width).toBeLessThanOrEqual(TRACK_WIDTH);
    });
  });
});

// 옛 GeneratingScreen.pulse.test.tsx — 가짜 타이머·JS 드라이버 강제는 이 describe 안에서만 켠다.
describe('단계 펄스', () => {
  /**
   * TRIP-1046 · h07 생성 중 3단계 원의 펄스 계약(QA #025). "원이 실제로 움직이고 1→2→3 순서로 번지는가"(옛 P-2)·
   * 정리(P-2d)·확인 전 이탈(P-2e)·세 원이 같은 얼굴인가(P-1 의 구조 서명)는 TRIP-1352 에서 지웠다 — 구현을 재는
   * 타이머 훑기라 느리고(가짜 타이머 20ms 표본 수백 회) 실움직임은 6-b 몫이다. 남긴 것:
   *  - 🔴 각 단계 행에 펄스 원이 정확히 1개(⚑C — 완료·대기 차등 없는 균일한 진행 표식).
   *  - 🔴 기기 "동작 줄이기"가 켜져 있으면 멈춘 완전한 원(접근성).
   *  - 실패·409 얼굴엔 펄스 원이 없다.
   */
  const probe = useAnimatedProbe();

  const noop = () => {};
  const PULSE = /^itinerary-generating-pulse-/;

  /** 움직이는 얼굴 — 서브트리 호스트들의 opacity·transform(02a ★6). */
  function face(n: number): string {
    const dot = screen.getByTestId(`itinerary-generating-pulse-${n}`);
    return JSON.stringify(
      hostNodes(dot).map((node) => {
        const style = StyleSheet.flatten(node.props.style) ?? {};
        return { opacity: style.opacity, transform: style.transform };
      })
    );
  }

  /** 마운트 후 isReduceMotionEnabled 의 Promise 를 비운다(02a ★4). */
  async function renderProgress(): Promise<void> {
    render(<GeneratingScreen onBackground={noop} onRetry={noop} />);
    await act(async () => {});
  }

  describe('🔴 P-4 · AC-4 — 동작 줄이기가 켜져 있으면 펄스를 멈춘 완전한 원', () => {
    it('시간이 흘러도 세 원이 그대로이고, 같은 모양이며, 흐려지거나 줄지 않았다', async () => {
      probe.setReduceMotion(true);
      await renderProgress();

      // 짝 — 원이 실제로 있다(없으면 아래 "안 움직인다"가 공허하게 통과).
      expect(screen.getAllByTestId(PULSE)).toHaveLength(3);

      const perDot: string[][] = [[face(1)], [face(2)], [face(3)]];
      for (let t = 0; t < 3000; t += 20) {
        act(() => {
          jest.advanceTimersByTime(20);
        });
        [1, 2, 3].forEach((n, i) => perDot[i].push(face(n)));
      }
      perDot.forEach((faces) => expect(new Set(faces).size).toBe(1));
      expect(perDot[1][0]).toBe(perDot[0][0]);
      expect(perDot[2][0]).toBe(perDot[0][0]);

      [1, 2, 3].forEach((n) => {
        hostNodes(
          screen.getByTestId(`itinerary-generating-pulse-${n}`)
        ).forEach((node) => {
          const style = StyleSheet.flatten(node.props.style) ?? {};
          expect([undefined, 1]).toContain(style.opacity);
          const transforms = (style.transform ?? []) as Record<
            string,
            unknown
          >[];
          transforms.forEach((entry) => {
            if ('scale' in entry) expect(entry.scale).toBe(1);
          });
        });
      });
    });
  });
});

// TRIP-1384 · h07 진행 표면의 "빈 일정 카드 섞기" 일러스트. 가짜 타이머·JS 드라이버 강제는 이 describe 안에서만 켠다.
describe('빈 일정 카드 섞기 일러스트', () => {
  /**
   * 생김새(색·픽셀)는 단언하지 않는다(README 판정 4) — 존재·글자 0·접근성 숨김·동작 줄이기 정지만 잠근다.
   * 실제로 섞이는 모양은 6-b 실기 몫.
   */
  const probe = useAnimatedProbe();
  const noop = () => {};
  const ILLUSTRATION = 'itinerary-generating-illustration';
  const TOP_CARD = 'itinerary-generating-illustration-card-top';

  async function renderProgress(): Promise<void> {
    render(<GeneratingScreen onBackground={noop} onRetry={noop} />);
    await act(async () => {});
  }

  function topFace(): string {
    const card = screen.getByTestId(TOP_CARD, { includeHiddenElements: true });
    return JSON.stringify(
      hostNodes(card).map((node) => {
        const style = StyleSheet.flatten(node.props.style) ?? {};
        return style.transform;
      })
    );
  }

  /** 카드 컨테이너(Animated.View 래퍼)까지 올라가 transform 을 읽는다. */
  function wrapperFace(): string {
    let node = screen.getByTestId(TOP_CARD, { includeHiddenElements: true });
    const faces: unknown[] = [];
    for (let i = 0; i < 3 && node.parent; i += 1) {
      node = node.parent;
      const style = StyleSheet.flatten(node.props.style) ?? {};
      faces.push(style.transform);
    }
    return JSON.stringify(faces);
  }

  it('동작 줄이기가 꺼져 있으면 카드가 움직이고 (긍정 짝)', async () => {
    probe.setReduceMotion(false);
    await renderProgress();

    const faces = new Set([wrapperFace()]);
    for (let t = 0; t < 3600; t += 100) {
      act(() => {
        jest.advanceTimersByTime(100);
      });
      faces.add(wrapperFace());
    }
    expect(faces.size).toBeGreaterThan(1);
  });

  it('동작 줄이기가 켜져 있으면 시간이 흘러도 정지 컷 그대로다', async () => {
    probe.setReduceMotion(true);
    await renderProgress();

    // 짝 — 카드가 있다.
    expect(topFace()).toBeTruthy();
    const faces = new Set([wrapperFace()]);
    for (let t = 0; t < 3600; t += 100) {
      act(() => {
        jest.advanceTimersByTime(100);
      });
      faces.add(wrapperFace());
    }
    expect(faces.size).toBe(1);
  });
});
