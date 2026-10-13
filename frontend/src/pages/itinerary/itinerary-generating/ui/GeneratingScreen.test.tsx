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
 * h07(라이브 Figma · 구 h09) "AI가 일정 짜는 중" 화면의 **렌더 계약**(TRIP-305 → TRIP-789 정합).
 * 화면은 완성된 콜백·데이터만 받는다 — 조회도 POST 도 라우팅도 하지 않는다(배선은 `GeneratingPage` 몫).
 *
 * *(개념)* **testID** — 화면 요소에 붙이는 테스트 전용 이름표. 사용자에게는 안 보이고, 테스트가
 * "그 요소"를 정확히 집어 오는 손잡이다. **queryAllByText(정규식)** 은 텍스트를 **부분(포함)** 으로
 * 훑어 매칭 배열을 준다(0건이면 빈 배열) — "화면에 그 문자열이 하나도 없다"를 재는 데 쓴다.
 * **queryByTestId** 는 못 찾으면 **null**(부재 단언용, `getByTestId` 는 못 찾으면 throw).
 *
 * 무엇을 보장하나 — 이 칸의 존재 이유부터(TRIP-789 Figma 정합 재작성):
 *  - 🔴 진행 표면 골격이 실재하고(AC-3) **하단(footer·2버튼)은 사라졌다**(AC-4): 앱바 · 비결정형 진행
 *    표시 · 체크리스트 3행(장소 수집·동선 계산·시간 배치)만 있고 footer·[취소]·[백그라운드로]는 없다.
 *  - 🔴 **화면에 퍼센트(`48%`)·시간추정(`10초쯤`)·소요시간(`N분`/`N시간`) 문자열이 하나도 없다**
 *    (AC-1·AC-2 · INV-3 · ⚑C). 부제는 **현행 유지**(Q3 — '10초쯤' 미추가, 동결 `초` 가드 유지).
 *    소스 가드(`itineraryTimeStructure`)는 `%`·`초`를 아예 안 봐서 이 **렌더 결과** 단언이 유일한 그물.
 *  - 🔴 실패는 삼켜지지 않는다(AC-7 · INV-4): `failed` 면 실패 표면 + [다시 시도]가 뜬다(핸들링 무변경).
 *  - 🔴 앱바 뒤로 셰브론이 **onBackground** 를 부른다(AC-4 — 취소 개념 소멸, 뒤로=백그라운드).
 *
 * 3동작 뼈대: 준비 = 콜백 spy 로 렌더 → 실행 = 렌더만/버튼 press → 단언 = 보이는 것·불린 콜백.
 * (SafeAreaProvider 래핑은 불필요 — `DraftScreen.test.tsx` 선례대로 직접 렌더.)
 *
 * 한 파일로 합친 기록(TRIP-1150): 옛 `.bar`·`.pulse` 두 파일을 바깥 describe 로 붙였다. 두 파일은
 * 최상위에서 가짜 타이머·`Animated` 스파이를 켰는데, 그대로 두면 S1~S6 까지 그 아래서 돈다 — 그래서 각자의
 * describe 안 beforeEach/afterEach 로 가뒀다.
 */

/** 진행 화면에 있어선 안 되는 숫자 어휘 — 자리 앵커 `\d` 가 필수다: 체크리스트 라벨 `시간 배치` 가
 * `시간` 을 포함하므로 bare `시간` 은 정당 라벨을 red 로 만든다. `\d\s*시간` 이라야 "N시간"만 잡고
 * `시간 배치` 는 통과한다. */
const PERCENT = /\d\s*%/; // "48%" → "8%" 에 걸림
const SECONDS = /\d\s*초/; // "10초쯤" → "0초" 에 걸림
const DURATION = /\d\s*분|\d\s*시간/; // "이동 30분"·"2시간" 에 걸림, "시간 배치" 는 아님

const noop = () => {};

describe('🔴 S1 · AC-3·AC-4 — 진행 골격은 있고 하단(footer·2버튼)은 사라졌다', () => {
  it('앱바·진행 표시·체크리스트 3행은 있고 footer·[취소]·[백그라운드로]는 없다', () => {
    render(<GeneratingScreen onBackground={noop} onRetry={noop} />);

    // 긍정 — 남는 골격.
    expect(screen.getByTestId('itinerary-generating-appbar')).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();

    // 체크리스트는 정확히 3행이고, 각 행의 라벨이 Figma 정본 문구다(정확 문자열 일치).
    expect(screen.queryAllByTestId(/^itinerary-generating-step-/)).toHaveLength(
      3
    );
    expect(screen.getByText('장소 수집')).toBeOnTheScreen();
    expect(screen.getByText('동선 계산')).toBeOnTheScreen();
    expect(screen.getByText('시간 배치')).toBeOnTheScreen();

    // 부정 — Figma 정합으로 제거된 하단 안내박스·2버튼이 트리에서 사라졌다(AC-4).
    expect(screen.queryByTestId('itinerary-generating-footer')).toBeNull();
    expect(screen.queryByTestId('itinerary-generating-cancel')).toBeNull();
    expect(screen.queryByTestId('itinerary-generating-background')).toBeNull();
  });
});

describe('🔴 S2 · AC-1·AC-2 — 숫자·시간 어휘를 그리지 않는다 (결과 심판)', () => {
  it('진행 화면에 퍼센트·초 추정·소요시간 문자열이 하나도 없다', () => {
    render(<GeneratingScreen onBackground={noop} onRetry={noop} />);

    // 긍정 짝 — 진행 표면이 실제로 떴다(없으면 아래 "0건"이 빈 렌더에서 공허하게 통과한다).
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();

    // 부정 — 계약에 없는 퍼센트(48%)·지어낸 시간추정(10초쯤)·소요시간(N분/N시간)이 0건이다.
    // ⚑C(가짜 진척 금지) + Q3(동결 `초` 가드 유지 = '10초쯤' 미추가).
    expect(screen.queryAllByText(PERCENT)).toHaveLength(0);
    expect(screen.queryAllByText(SECONDS)).toHaveLength(0);
    expect(screen.queryAllByText(DURATION)).toHaveLength(0);
  });
});

describe('🔴 S3 · AC-7 — 실패는 삼켜지지 않는다 (INV-4)', () => {
  it('failed 면 실패 표면과 [다시 시도] 버튼이 뜨고 onRetry 를 부른다', () => {
    const onRetry = jest.fn();
    render(<GeneratingScreen onBackground={noop} onRetry={onRetry} failed />);

    expect(screen.getByTestId('itinerary-generating-failed')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('itinerary-generating-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 S4 · AC-7 짝 — 기본은 실패 표면이 없다', () => {
  it('failed 미지정이면 실패 표면이 없고, 진행 표면은 그대로 뜬다', () => {
    render(<GeneratingScreen onBackground={noop} onRetry={noop} />);

    // 부정 — 실패가 아닌데 실패 표면이 뜨면 안 된다.
    expect(screen.queryByTestId('itinerary-generating-failed')).toBeNull();
    // 긍정 짝 — 빈 렌더에서 위 부정이 공짜로 통과하는 것을 막는다.
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();
  });
});

describe('🔴 S5 · AC-4 — 앱바 뒤로 셰브론이 onBackground 를 부른다 (취소 개념 소멸)', () => {
  it('앱바 뒤로 press → onBackground 만 1회 부른다', () => {
    const onBackground = jest.fn();
    render(<GeneratingScreen onBackground={onBackground} onRetry={noop} />);

    fireEvent.press(screen.getByTestId('itinerary-generating-back'));
    expect(onBackground).toHaveBeenCalledTimes(1);
  });
});

// TRIP-1368 · AI 일정 생성 일일 한도(서버 429 수신) — 한도 얼굴의 렌더 계약(TRIP-1268 이 그린 얼굴을 승계).
describe('AI 일일 한도 얼굴', () => {
  /**
   * 무엇을 보장하나:
   *  - `aiLimit` 이 오면 한도 얼굴(`ai-limit-notice`)만 그린다 — 제목·본문(시각으로만 말함, INV-3)·
   *    [직접 짜기 이어가기]·[닫기]. **[다시 시도]는 없다**(눌러도 또 막히는 버튼은 거짓말이다).
   *  - 얼굴 우선순위는 **한도 > 409 안내(busy) > 실패 > 진행**. 이전 POST 실패가 남아 있어도 한도가 이긴다.
   *  - 두 버튼은 각자 자기 콜백만 1회 부른다.
   *
   * *(개념)* `getByText('문자열')` 은 Text 하나의 글자 전체와 **완전 일치**, `getByText(/정규식/)` 은
   * **부분 일치**다. 본문은 두 문장을 한 줄로 합쳐 그릴 수도 있어 정규식으로, 제목·버튼 글자는 완전 일치로 잰다.
   *
   * 3동작 뼈대: 준비 = 콜백 spy 로 `aiLimit` 을 넘겨 렌더 → 실행 = 렌더만/버튼 press → 단언 = 보이는 얼굴·불린 콜백.
   */
  const TITLE = '오늘 AI 일정 만들기를 모두 썼어요';

  function limitProps() {
    return { onContinueManual: jest.fn(), onClose: jest.fn() };
  }

  describe('🔴 L1 · AC-7·AC-9 — 한도 얼굴의 글자와 버튼', () => {
    it('제목·본문 두 문장·두 버튼이 있고, [다시 시도]·진행 표면은 없다', () => {
      render(
        <GeneratingScreen
          onBackground={noop}
          onRetry={noop}
          aiLimit={{ ...limitProps(), retryAt: { day: '내일', time: '00:00' } }}
        />
      );

      const notice = screen.getByTestId('ai-limit-notice');
      expect(within(notice).getByText(TITLE)).toBeOnTheScreen();
      expect(
        within(notice).getByText(/내일 00:00 이후에 다시 쓸 수 있어요/)
      ).toBeOnTheScreen();
      expect(
        within(notice).getByText(/직접 짜기는 계속 쓸 수 있어요/)
      ).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('ai-limit-manual-cta')).getByText(
          '직접 짜기 이어가기'
        )
      ).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('ai-limit-close')).getByText('닫기')
      ).toBeOnTheScreen();

      // 부정 — 다시 시도·진행 표면(진행 바·단계 펄스)이 한 조각도 없다.
      expect(screen.queryByTestId('itinerary-generating-retry')).toBeNull();
      expect(screen.queryByTestId('itinerary-generating-progress')).toBeNull();
      expect(screen.queryByTestId('itinerary-generating-pulse-1')).toBeNull();
    });
  });

  describe('🔴 L1b · Retry-After 가 없으면 — 시각 없이 안내만 한다 (INV-4)', () => {
    it('retryAt 이 null 이면 시각 문장이 없고 나머지 얼굴은 그대로다', () => {
      render(
        <GeneratingScreen
          onBackground={noop}
          onRetry={noop}
          aiLimit={{ ...limitProps(), retryAt: null }}
        />
      );

      const notice = screen.getByTestId('ai-limit-notice');
      expect(within(notice).getByText(TITLE)).toBeOnTheScreen();
      expect(within(notice).queryByText(/이후에 다시 쓸 수 있어요/)).toBeNull();
      expect(
        within(notice).getByText(/직접 짜기는 계속 쓸 수 있어요/)
      ).toBeOnTheScreen();
      expect(screen.getByTestId('ai-limit-manual-cta')).toBeOnTheScreen();
      expect(screen.getByTestId('ai-limit-close')).toBeOnTheScreen();
    });
  });

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

  describe('🔴 L3 · AC-9 — 두 버튼은 자기 콜백만 부른다', () => {
    it('[직접 짜기 이어가기] → onContinueManual 1회, onClose 0회', () => {
      const props = limitProps();
      render(
        <GeneratingScreen onBackground={noop} onRetry={noop} aiLimit={props} />
      );

      fireEvent.press(screen.getByTestId('ai-limit-manual-cta'));

      expect(props.onContinueManual).toHaveBeenCalledTimes(1);
      expect(props.onClose).not.toHaveBeenCalled();
    });

    it('[닫기] → onClose 1회, onContinueManual 0회', () => {
      const props = limitProps();
      render(
        <GeneratingScreen onBackground={noop} onRetry={noop} aiLimit={props} />
      );

      fireEvent.press(screen.getByTestId('ai-limit-close'));

      expect(props.onClose).toHaveBeenCalledTimes(1);
      expect(props.onContinueManual).not.toHaveBeenCalled();
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

  describe('🔴 P-1a · AC-1 — 단계 행마다 펄스 원 1개', () => {
    it('각 단계 행 안에 itinerary-generating-pulse-n 이 정확히 1개씩, 모두 3개다', async () => {
      await renderProgress();

      [1, 2, 3].forEach((n) => {
        const step = screen.getByTestId(`itinerary-generating-step-${n}`);
        const dots = within(step).getAllByTestId(PULSE);
        expect(dots).toHaveLength(1);
        expect(dots[0].props.testID).toBe(`itinerary-generating-pulse-${n}`);
      });
      expect(screen.getAllByTestId(PULSE)).toHaveLength(3);
    });
  });

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

  describe('P-6 · AC-6 — 실패·409 얼굴엔 펄스 원이 없다', () => {
    it('failed 면 실패 표면만 있고 펄스 원은 0개다', async () => {
      render(<GeneratingScreen onBackground={noop} onRetry={noop} failed />);
      await act(async () => {});

      expect(
        screen.getByTestId('itinerary-generating-failed')
      ).toBeOnTheScreen();
      expect(screen.queryAllByTestId(PULSE)).toHaveLength(0);
    });

    it('busy(다른 여행 생성 중)면 안내만 있고 펄스 원은 0개다', async () => {
      render(
        <GeneratingScreen
          onBackground={noop}
          onRetry={noop}
          busy={{ cancelable: true, onCancelAndRetry: noop, onWait: noop }}
        />
      );
      await act(async () => {});

      expect(screen.getByTestId('itinerary-generation-busy')).toBeOnTheScreen();
      expect(screen.queryAllByTestId(PULSE)).toHaveLength(0);
    });
  });
});
