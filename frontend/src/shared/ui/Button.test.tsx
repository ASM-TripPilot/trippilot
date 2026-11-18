import { act, fireEvent, render, screen } from '@testing-library/react-native';

import {
  guardPress,
  openPressGuardWindow,
  PRESS_GUARD_SCREEN_LISTENERS,
  resetPressGuard,
} from '@/shared/lib/pressGuard';
import { freezeDate } from '@/test-support/freezeDate';

import { Button, buttonClasses, type ButtonSize } from './Button';

/**
 * TRIP-1828 — 공용 Button(`shared/ui/Button`)의 누름 계약.
 *
 * 무엇을 보장하나:
 *  - 누르는 요소는 role=button 하나이고 testID·accessibilityLabel 이 그 요소에 붙는다(이관한 화면 테스트가 testID 로 누른다).
 *  - disabled·loading 이면 진짜로 안 눌린다(접근성 상태만 바꾸는 "가짜 비활성" 금지).
 *  - onPress 가 Promise 를 돌려주면 끝날 때까지(성공·실패 둘 다) Button 이 잠금을 쥔다. 잠금은 다시 그리기를
 *    기다리지 않는다 — 같은 틱 둘째 누름도 막는다.
 *  - 창은 **따르기만** 한다(01b Q10) — 열린 창·화면 전환 중에는 무시하고, 자기 누름이 창을 열지는 않는다.
 *    그래서 호출부가 `guardPress(f)` 로 감싸 넘겨도 죽지 않는다(두 번 감싸면 0회가 되는 함정, 01 맹점 ①).
 *
 * 생김새(색·높이·반경·스피너 모양)는 단언하지 않는다(README 판정 4) — 실화면 QA 몫.
 *
 * 시계는 `Date` 만 멈춘다(창 판정이 `Date.now()` 비교라서). 창을 넘기려면 `jest.setSystemTime` 으로 옮긴다.
 */

const NOW = new Date('2026-11-08T00:00:00Z').getTime();

beforeEach(() => {
  freezeDate('2026-11-08T00:00:00Z');
  resetPressGuard();
});

// 창·전환 상태는 모듈 전역이라 describe 밖에서 지운다 — 앞 테스트가 연 창이 다음 테스트의 첫 누름을 삼키지 않게.
afterEach(() => {
  resetPressGuard();
  jest.useRealTimers();
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 마이크로태스크를 다 비운다 — 진짜 setTimeout(가짜는 Date 뿐). 처리 안 된 거절도 이 사이에 터진다. */
function drain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('TRIP-1828 · Button — 누름과 비활성(AC-1·AC-2·AC-3)', () => {
  it('누르면 onPress 가 1회 나간다', () => {
    const onPress = jest.fn();
    render(
      <Button testID="cta" onPress={onPress}>
        저장
      </Button>
    );

    fireEvent.press(screen.getByTestId('cta'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('onPress 가 Promise 가 아니면 잠금을 쥐지 않는다 — 다음 누름도 받는다(void 의 연타 막기는 호출부 몫, 01b Q10)', () => {
    const onPress = jest.fn();
    render(
      <Button testID="cta" onPress={onPress}>
        저장
      </Button>
    );

    fireEvent.press(screen.getByTestId('cta'));
    fireEvent.press(screen.getByTestId('cta'));

    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('testID·accessibilityLabel 은 누르는 요소 하나에 붙고, role=button 은 정확히 1개다', () => {
    const onPress = jest.fn();
    render(
      <Button testID="cta" accessibilityLabel="다음 단계로" onPress={onPress}>
        다음
      </Button>
    );

    const cta = screen.getByTestId('cta');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '다음 단계로' })).toBe(cta);
    fireEvent.press(cta);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('disabled 면 비활성으로 읽히고 눌러도 onPress 0회', () => {
    const onPress = jest.fn();
    render(
      <Button testID="cta" disabled onPress={onPress}>
        저장
      </Button>
    );

    const cta = screen.getByTestId('cta');
    expect(cta).toBeDisabled();
    fireEvent.press(cta);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('loading 이면 busy·비활성으로 읽히고 눌러도 onPress 0회, 이름(라벨)은 남는다', () => {
    const onPress = jest.fn();
    render(
      <Button testID="cta" loading onPress={onPress}>
        저장
      </Button>
    );

    const cta = screen.getByTestId('cta');
    expect(cta).toBeBusy();
    expect(cta).toBeDisabled();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '저장' })).toBe(cta);
    fireEvent.press(cta);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('TRIP-1828 · Button — Promise 잠금(01b 잠금 내장 · AC-4)', () => {
  it('Promise 가 끝날 때까지 busy 이고 둘째 누름은 0회, 성공으로 끝나면 다시 1회 받는다', async () => {
    const pending = deferred();
    const onPress = jest.fn(() => pending.promise);
    render(
      <Button testID="cta" onPress={onPress}>
        저장
      </Button>
    );

    // 앵커: 누르기 전엔 busy 가 아니다 — 아래 busy 가 누름에서 왔음을 가른다.
    expect(screen.getByTestId('cta')).not.toBeBusy();
    fireEvent.press(screen.getByTestId('cta'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('cta')).toBeBusy();

    fireEvent.press(screen.getByTestId('cta'));
    expect(onPress).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve();
      await drain();
    });

    expect(screen.getByTestId('cta')).not.toBeBusy();
    expect(screen.getByTestId('cta')).toBeEnabled();
    fireEvent.press(screen.getByTestId('cta'));
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('Promise 가 실패로 끝나도 잠금이 풀려 다시 1회 받고, 처리 안 된 거절로 테스트가 깨지지 않는다', async () => {
    const pending = deferred();
    const onPress = jest.fn(() => pending.promise);
    render(
      <Button testID="cta" onPress={onPress}>
        저장
      </Button>
    );

    fireEvent.press(screen.getByTestId('cta'));
    fireEvent.press(screen.getByTestId('cta'));
    expect(onPress).toHaveBeenCalledTimes(1);

    // jest 는 테스트 중 처리 안 된 거절이 나면 그 테스트를 실패시킨다(02a §5 실측) — drain 이 그 순간을 테스트 안에 둔다.
    await act(async () => {
      pending.reject(new Error('저장 실패'));
      await drain();
    });

    expect(screen.getByTestId('cta')).not.toBeBusy();
    expect(screen.getByTestId('cta')).toBeEnabled();
    fireEvent.press(screen.getByTestId('cta'));
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('다시 그리기 전 같은 틱에 두 번 눌러도 Promise onPress 는 1회 — 잠금은 상태가 아니라 누르는 순간 쥔다', () => {
    const onPress = jest.fn(() => new Promise<void>(() => {}));
    render(
      <Button testID="cta" onPress={onPress}>
        저장
      </Button>
    );

    // 바깥 act 안에선 두 누름 사이에 다시 그리기가 없다 — busy·disabled 상태만으로 막는 구현은 2회가 된다(02a §5 실측).
    act(() => {
      fireEvent.press(screen.getByTestId('cta'));
      fireEvent.press(screen.getByTestId('cta'));
    });

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('TRIP-1828 · Button — 연타 창을 따르기만 한다(01b Q10 · AC-5·AC-6)', () => {
  it('열린 창 안에서는 0회, 창이 닫히면(400ms 뒤) 1회', () => {
    const onPress = jest.fn();
    render(
      <Button testID="cta" onPress={onPress}>
        저장
      </Button>
    );

    openPressGuardWindow();
    fireEvent.press(screen.getByTestId('cta'));
    expect(onPress).not.toHaveBeenCalled();

    jest.setSystemTime(NOW + 400);
    fireEvent.press(screen.getByTestId('cta'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('Button 누름은 창을 열지 않는다 — 직후 다른 guardPress 콜백이 통과한다', () => {
    const onPress = jest.fn();
    const other = jest.fn();
    const guardedOther = guardPress(other);
    render(
      <Button testID="cta" onPress={onPress}>
        저장
      </Button>
    );

    fireEvent.press(screen.getByTestId('cta'));
    guardedOther();

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('호출부가 guardPress(f) 로 감싸 넘겨도 f 는 1회 나가고(이중 감싸기 무해), 그 창이 같은 틱 둘째 누름을 막는다', () => {
    const raw = jest.fn();
    render(
      <Button testID="cta" onPress={guardPress(raw)}>
        다음
      </Button>
    );

    fireEvent.press(screen.getByTestId('cta'));
    expect(raw).toHaveBeenCalledTimes(1);

    act(() => {
      fireEvent.press(screen.getByTestId('cta'));
      fireEvent.press(screen.getByTestId('cta'));
    });
    expect(raw).toHaveBeenCalledTimes(1);
  });

  it('화면 전환 중(transitionStart~transitionEnd)엔 0회, 전환이 끝나고 창이 닫히면 1회', () => {
    const onPress = jest.fn();
    render(
      <Button testID="cta" onPress={onPress}>
        저장
      </Button>
    );

    PRESS_GUARD_SCREEN_LISTENERS.transitionStart({
      target: 'route-b',
      data: { closing: false },
    });
    fireEvent.press(screen.getByTestId('cta'));
    expect(onPress).not.toHaveBeenCalled();

    PRESS_GUARD_SCREEN_LISTENERS.transitionEnd({ data: { closing: false } });
    jest.setSystemTime(NOW + 400);
    fireEvent.press(screen.getByTestId('cta'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('TRIP-1828 · buttonClasses — 비활성은 변형과 무관하게 한 종(AC-8 "비활성 1종")', () => {
  // 값(클래스 토큰)은 보지 않는다(판정 4). 변형끼리 같은 값인지만 — 비활성 규칙이 한 곳이라는 동치다.
  it.each<ButtonSize>(['lg', 'md'])(
    'size=%s 에서 disabled 면 primary·secondary·ink 가 같은 값이다',
    (size) => {
      // 앵커: 활성일 땐 변형마다 다르다 — 무엇을 넣어도 같은 값을 내는 함수로 통과하지 않게.
      expect(buttonClasses({ size, variant: 'secondary' })).not.toEqual(
        buttonClasses({ size, variant: 'primary' })
      );

      const primary = buttonClasses({
        size,
        variant: 'primary',
        disabled: true,
      });
      expect(
        buttonClasses({ size, variant: 'secondary', disabled: true })
      ).toEqual(primary);
      expect(buttonClasses({ size, variant: 'ink', disabled: true })).toEqual(
        primary
      );
    }
  );
});
