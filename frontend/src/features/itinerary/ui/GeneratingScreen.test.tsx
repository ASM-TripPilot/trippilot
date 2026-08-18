import { fireEvent, render, screen } from '@testing-library/react-native';

import { GeneratingScreen } from './GeneratingScreen';

/**
 * h09 "AI가 일정 짜는 중" 화면의 **렌더 계약**(TRIP-305). 화면은 완성된 콜백만 받는다 —
 * 조회도 POST 도 라우팅도 하지 않는다(배선은 `GeneratingPage` 몫).
 *
 * *(개념)* **testID** — 화면 요소에 붙이는 테스트 전용 이름표. 사용자에게는 안 보이고, 테스트가
 * "그 요소"를 정확히 집어 오는 손잡이다. **queryAllByText(정규식)** 은 텍스트를 **부분(포함)** 으로
 * 훑어 매칭 배열을 준다(0건이면 빈 배열) — "화면에 그 문자열이 하나도 없다"를 재는 데 쓴다.
 *
 * 무엇을 보장하나 — 이 칸의 존재 이유부터:
 *  - 🔴 진행 표면 골격이 실재한다(AC-1·AC-V): 앱바 · 비결정형 진행 표시 · 체크리스트 3행
 *    (장소 수집·동선 계산·시간 배치) · footer · [취소]/[백그라운드로] 두 버튼.
 *  - 🔴 **화면에 퍼센트(`48%`)·시간추정(`10초쯤`)·소요시간(`N분`/`N시간`) 문자열이 하나도 없다**
 *    (AC-1·AC-2 · INV-3). 소스 가드(`itineraryTimeStructure`)는 `%`·`초`를 아예 안 봐서(brief §맹점 ④)
 *    이 **렌더 결과** 단언이 유일한 그물이다(개념 [[결과를 보는 심판과 수단을 보는 심판]]).
 *  - 🔴 실패는 삼켜지지 않는다(AC-6 · INV-4): `failed` 면 실패 표면 + [다시 시도]가 뜬다.
 *  - 🔴 [취소]·[백그라운드로]가 **각자의** 콜백을 부른다(뒤바뀜 방지).
 *
 * 3동작 뼈대: 준비 = 콜백 spy 로 렌더 → 실행 = 렌더만/버튼 press → 단언 = 보이는 것·불린 콜백.
 * (SafeAreaProvider 래핑은 불필요 — `DraftScreen.test.tsx` 선례대로 직접 렌더.)
 */

/** 진행 화면에 있어선 안 되는 숫자 어휘 — 자리 앵커 `\d` 가 필수다: 체크리스트 라벨 `시간 배치` 가
 * `시간` 을 포함하므로 bare `시간` 은 정당 라벨을 red 로 만든다. `\d\s*시간` 이라야 "N시간"만 잡고
 * `시간 배치` 는 통과한다(02a §5-1 · ★3 실측). */
const PERCENT = /\d\s*%/; // "48%" → "8%" 에 걸림
const SECONDS = /\d\s*초/; // "10초쯤" → "0초" 에 걸림
const DURATION = /\d\s*분|\d\s*시간/; // "이동 30분"·"2시간" 에 걸림, "시간 배치" 는 아님

const noop = () => {};

describe('🔴 S1 · AC-1·AC-V — 진행 표면 골격이 실재한다', () => {
  it('앱바·진행 표시·체크리스트 3행·footer·두 버튼이 렌더된다', () => {
    render(
      <GeneratingScreen onCancel={noop} onBackground={noop} onRetry={noop} />
    );

    expect(screen.getByTestId('itinerary-generating-appbar')).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-generating-footer')).toBeOnTheScreen();

    // 두 버튼 — Seed 가 못박은 [취소]·[백그라운드로].
    expect(screen.getByTestId('itinerary-generating-cancel')).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-generating-background')
    ).toBeOnTheScreen();

    // 체크리스트는 정확히 3행이고, 각 행의 라벨이 Figma 정본 문구다(정확 문자열 일치).
    expect(screen.queryAllByTestId(/^itinerary-generating-step-/)).toHaveLength(
      3
    );
    expect(screen.getByText('장소 수집')).toBeOnTheScreen();
    expect(screen.getByText('동선 계산')).toBeOnTheScreen();
    expect(screen.getByText('시간 배치')).toBeOnTheScreen();
  });
});

describe('🔴 S2 · AC-1·AC-2 — 숫자·시간 어휘를 그리지 않는다 (결과 심판)', () => {
  it('진행 화면에 퍼센트·초 추정·소요시간 문자열이 하나도 없다', () => {
    render(
      <GeneratingScreen onCancel={noop} onBackground={noop} onRetry={noop} />
    );

    // 긍정 짝 — 진행 표면이 실제로 떴다(없으면 아래 "0건"이 빈 렌더에서 공허하게 통과한다).
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();

    // 부정 — 계약에 없는 퍼센트(48%)·지어낸 시간추정(10초쯤)·소요시간(N분/N시간)이 0건이다.
    expect(screen.queryAllByText(PERCENT)).toHaveLength(0);
    expect(screen.queryAllByText(SECONDS)).toHaveLength(0);
    expect(screen.queryAllByText(DURATION)).toHaveLength(0);
  });
});

describe('🔴 S3 · AC-6 — 실패는 삼켜지지 않는다 (INV-4)', () => {
  it('failed 면 실패 표면과 [다시 시도] 버튼이 뜨고 onRetry 를 부른다', () => {
    const onRetry = jest.fn();
    render(
      <GeneratingScreen
        onCancel={noop}
        onBackground={noop}
        onRetry={onRetry}
        failed
      />
    );

    expect(screen.getByTestId('itinerary-generating-failed')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('itinerary-generating-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 S4 · AC-6 짝 — 기본은 실패 표면이 없다', () => {
  it('failed 미지정이면 실패 표면이 없고, 진행 표면은 그대로 뜬다', () => {
    render(
      <GeneratingScreen onCancel={noop} onBackground={noop} onRetry={noop} />
    );

    // 부정 — 실패가 아닌데 실패 표면이 뜨면 안 된다.
    expect(screen.queryByTestId('itinerary-generating-failed')).toBeNull();
    // 긍정 짝 — 빈 렌더에서 위 부정이 공짜로 통과하는 것을 막는다.
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();
  });
});

describe('🔴 S5 · 버튼 뒤바뀜 방지 — 각 버튼이 제 콜백을 부른다', () => {
  it('[취소]는 onCancel 만, [백그라운드로]는 onBackground 만 부른다', () => {
    const onCancel = jest.fn();
    const onBackground = jest.fn();
    render(
      <GeneratingScreen
        onCancel={onCancel}
        onBackground={onBackground}
        onRetry={noop}
      />
    );

    fireEvent.press(screen.getByTestId('itinerary-generating-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onBackground).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('itinerary-generating-background'));
    expect(onBackground).toHaveBeenCalledTimes(1);
    // 취소는 추가로 안 불렸다(두 버튼이 같은 핸들러로 묶이지 않았다).
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
