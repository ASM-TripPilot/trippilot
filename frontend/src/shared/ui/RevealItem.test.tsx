import { useEffect } from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';

import { useAnimatedProbe } from '@/test-support/animatedProbe';
import { revealValues, type RevealValues } from '@/test-support/revealProbe';

import { RevealItem } from './RevealItem';

/**
 * TRIP-1641 · 등장 모션 래퍼 `RevealItem`(구 DraftPage 의 RevealItem + TripSummary 의 DayCardReveal 을 한 벌로) 계약.
 *
 * 무엇을 보장하나:
 *  - AC1 자식(카드)은 래퍼가 "동작 줄이기" 답을 받든(null→true/false) 모션이 꺼지든(revealing true→false) 다시 만들어지지 않는다.
 *  - AC3 답이 오기 전엔 투명하다(자식은 이미 마운트 — 숨김은 마운트가 아니라 투명도). revealing=false 면 답 전에도 보인다.
 *  - AC2 답이 true(동작 줄이기)면 등장 없이 곧장 보인다. revealing=false 로 마운트해도 첫 렌더부터 보인다.
 *  - AC2′ 답이 false 면 `firstDelayMs + index×150` ms 동안 투명하다가 450ms 뒤 투명도 1·이동 0 이 된다.
 *  - D4 index 가 중간에 바뀌어도 등장을 다시 시작하지 않는다.
 *
 * 값 읽기는 `revealProbe`(getAnimatedStyle) + 가짜 타이머. 곡선 모양(이징·25px)은 재지 않는다 — 끝값·0 유지·방향만(README 판정 4).
 * 실제 화면 번쩍임·worklet 크래시(UI 스레드)는 jest 사각 — 6-b 실기 몫.
 */

const reduceMotionMock = jest.mocked(AccessibilityInfo.isReduceMotionEnabled);
const CHILD = 'reveal-child';
/** 등장 한 번이 걸리는 시간(명세 450ms) — 지연 뒤 이만큼 지나면 끝나 있어야 한다. */
const DURATION_MS = 450;
const STEP_MS = 50;

/** 마운트·언마운트 횟수를 세는 자식 — "리마운트 0" 의 눈. */
function Child({
  onMount,
  onUnmount,
}: {
  onMount: () => void;
  onUnmount: () => void;
}) {
  useEffect(() => {
    onMount();
    return onUnmount;
  }, [onMount, onUnmount]);
  return <Text testID={CHILD}>카드</Text>;
}

type ItemProps = Partial<{
  index: number;
  firstDelayMs: number;
  revealing: boolean;
}>;

function setup(initial: ItemProps = {}) {
  const onMount = jest.fn();
  const onUnmount = jest.fn();
  let props: ItemProps = initial;
  const ui = () => (
    <RevealItem index={0} firstDelayMs={500} {...props}>
      <Child onMount={onMount} onUnmount={onUnmount} />
    </RevealItem>
  );
  const view = render(ui());
  return {
    mounts: onMount,
    unmounts: onUnmount,
    /** 일부 prop 만 바꿔 다시 그린다(RNTL 이 act 로 감싼다). */
    update: (next: ItemProps) => {
      props = { ...props, ...next };
      view.rerender(ui());
    },
  };
}

/** 동작 줄이기 답을 호출 시점에 쥐고 있다가 `answer(v)` 로 내준다 — "답이 늦게 오는" 상황. 마운트 **뒤에** 답을 준다. */
function holdAnswer(): (reduce: boolean) => Promise<void> {
  let release: (reduce: boolean) => void = () => {};
  reduceMotionMock.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        release = resolve;
      })
  );
  return async (reduce) => {
    await act(async () => {
      release(reduce);
    });
  };
}

/** 가짜 시계를 `ms` 만큼 흘린다. */
function flow(ms: number): void {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

const child = () => screen.getByTestId(CHILD);
const now = (): RevealValues => revealValues(child());

/** 지금부터 `totalMs` 까지 `STEP_MS` 간격으로 표본을 모은다(첫 표본 = 지금). */
function sample(totalMs: number): RevealValues[] {
  const taken = [now()];
  for (let at = STEP_MS; at <= totalMs; at += STEP_MS) {
    flow(STEP_MS);
    taken.push(now());
  }
  return taken;
}

function expectSettled(values: RevealValues[]): void {
  values.forEach((value) => {
    expect(value.opacity).toBe(1);
    expect(value.translateY).toBeCloseTo(0, 5);
  });
}

let consoleError: jest.SpyInstance;
let consoleWarn: jest.SpyInstance;

describe('RevealItem', () => {
  useAnimatedProbe();

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error');
    consoleWarn = jest.spyOn(console, 'warn');
  });

  afterEach(() => {
    // 노이즈 예산(scripts/noise-budget.cjs) 여유가 0 — 새 경고(act·Reanimated)는 여기서 먼저 잡는다.
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });

  describe('AC1 · 자식은 한 번만 마운트된다', () => {
    it.each([false, true])(
      '동작 줄이기 답이 늦게(%s) 와도 자식은 다시 만들어지지 않는다',
      async (reduce) => {
        const answer = holdAnswer();
        const item = setup();
        expect(item.mounts).toHaveBeenCalledTimes(1);

        await answer(reduce);
        flow(2000);

        expect(item.mounts).toHaveBeenCalledTimes(1);
        expect(item.unmounts).not.toHaveBeenCalled();
      }
    );

    it('등장이 재생되는 도중 revealing 이 꺼져도 자식은 다시 만들어지지 않는다', async () => {
      const answer = holdAnswer();
      const item = setup({ revealing: true });
      await answer(false);
      flow(700); // 지연(500) 지나 이동 중

      item.update({ revealing: false });
      flow(1000);

      expect(item.mounts).toHaveBeenCalledTimes(1);
      expect(item.unmounts).not.toHaveBeenCalled();
    });

    it('답이 오기 전에 revealing 이 꺼져도 자식은 다시 만들어지지 않는다', async () => {
      const answer = holdAnswer();
      const item = setup({ revealing: true });

      item.update({ revealing: false });
      await answer(false);

      expect(item.mounts).toHaveBeenCalledTimes(1);
      expect(item.unmounts).not.toHaveBeenCalled();
    });
  });

  describe('AC3 · 답이 오기 전', () => {
    it('revealing(기본값 true)이면 답이 오기 전엔 투명하고, 자식은 이미 마운트돼 있다', () => {
      holdAnswer();
      const item = setup();

      expect(item.mounts).toHaveBeenCalledTimes(1);
      const before = sample(1500); // 답이 안 오면 시간이 흘러도 켜지지 않는다
      before.forEach((value) => {
        expect(value.opacity).toBe(0);
        expect(value.translateY).toBeGreaterThan(0);
      });
    });

    it('revealing=false 면 답이 오기 전에도 처음부터 보인다', () => {
      holdAnswer();
      setup({ revealing: false });

      expectSettled(sample(500));
    });
  });

  describe('AC2 · 동작 줄이기가 켜져 있거나 revealing=false', () => {
    it('답이 true 면 등장 없이 곧장 보이고, 시간이 흘러도 변하지 않는다', async () => {
      const answer = holdAnswer();
      setup();
      await answer(true);

      flow(100); // reanimated 는 jest 에서 스타일을 한 틱 뒤에 반영한다
      expectSettled(sample(2000));
    });

    it('revealing=false 로 마운트하면 답이 false 여도 처음부터 보이고 등장을 재생하지 않는다', async () => {
      const answer = holdAnswer();
      setup({ revealing: false });
      expectSettled([now()]); // 첫 렌더 — 아직 아무 시간도 안 흘렀다

      await answer(false);
      expectSettled(sample(2000)); // 지연(500)·재생(450)이 지나도 0 으로 내려가지 않는다
    });
  });

  describe('AC2′ · 답이 false 면 등장이 재생된다', () => {
    it('지연 동안 투명하고, 그 뒤 단조 증가해 450ms 안에 투명도 1·이동 0 이 된다', async () => {
      const answer = holdAnswer();
      setup({ index: 0, firstDelayMs: 500 });
      await answer(false);

      const values = sample(500 + DURATION_MS + 100);

      const waiting = values.slice(0, 500 / STEP_MS - 1); // 0 ~ 400ms
      waiting.forEach((value) => expect(value.opacity).toBe(0));
      const opacities = values.map((value) => value.opacity);
      const shifts = values.map((value) => value.translateY);
      opacities.slice(1).forEach((opacity, i) => {
        expect(opacity).toBeGreaterThanOrEqual(opacities[i]);
      });
      shifts.slice(1).forEach((shift, i) => {
        expect(shift).toBeLessThanOrEqual(shifts[i]);
      });
      // 중간값이 실제로 있다 = 뚝 켜지는 게 아니라 올라온다.
      expect(opacities.some((opacity) => opacity > 0 && opacity < 1)).toBe(
        true
      );
      expect(shifts.some((shift) => shift > 0 && shift < shifts[0])).toBe(true);
      expectSettled(values.slice(-2));
    });

    // h14 카드는 500ms(경로 시작 0.5초 뒤)·j04 는 1050ms(경로가 다 그려진 뒤), 카드 사이는 150ms — 시작 시각을 값으로 못박는다.
    it.each([
      ['h14 첫 카드', 500, 0, 500],
      ['h14 셋째 카드', 500, 2, 800],
      ['j04 첫 카드', 1050, 0, 1050],
      ['j04 둘째 카드', 1050, 1, 1200],
    ])(
      '%s — firstDelayMs=%i · index=%i 면 %ims 뒤에 시작해 +450ms 에 끝난다',
      async (_name, firstDelayMs, index, startMs) => {
        const answer = holdAnswer();
        setup({ index, firstDelayMs });
        await answer(false);

        flow(startMs - 100);
        expect(now().opacity).toBe(0); // 시작 100ms 전 — 아직 투명

        flow(100 + DURATION_MS / 2);
        const mid = now();
        expect(mid.opacity).toBeGreaterThan(0); // 시작 후 절반 — 올라오는 중
        expect(mid.opacity).toBeLessThan(1);

        flow(DURATION_MS / 2 + 100);
        expectSettled([now()]); // 시작 + 450 + 100 — 끝
      }
    );
  });

  describe('AC3 · 등장 도중·직전에 revealing 이 꺼지면 즉시 보인다', () => {
    it.each([
      ['답이 오기 전', null, 0],
      ['지연 중(답 false, 200ms)', false, 200],
      ['이동 중(답 false, 650ms)', false, 650],
    ] as const)(
      '%s 에 꺼지면 깜빡임 없이 투명도 1·이동 0 이 되고 유지된다',
      async (_name, reduce, atMs) => {
        const answer = holdAnswer();
        const item = setup({ revealing: true });
        if (reduce !== null) await answer(reduce);
        flow(atMs);

        item.update({ revealing: false });
        flow(100);

        expectSettled(sample(1500));
      }
    );
  });

  describe('D4 · 등장은 한 번만 시작한다', () => {
    it('지연 중에 index 가 바뀌어도 처음 정한 때에 끝난다(다시 시작하지 않는다)', async () => {
      const answer = holdAnswer();
      const item = setup({ index: 0, firstDelayMs: 500 });
      await answer(false);
      flow(200);

      item.update({ index: 5 }); // 다시 시작했다면 200+500+750 ms 에야 시작
      flow(500 + DURATION_MS - 200 + 100);

      expectSettled([now()]);
    });

    it('끝난 뒤 index 가 바뀌어도 다시 투명해지지 않는다', async () => {
      const answer = holdAnswer();
      const item = setup({ index: 0, firstDelayMs: 500 });
      await answer(false);
      flow(500 + DURATION_MS + 100);
      expectSettled([now()]);

      item.update({ index: 3 });

      expectSettled(sample(2000));
    });
  });
});
