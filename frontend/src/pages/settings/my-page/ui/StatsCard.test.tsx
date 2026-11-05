import { fireEvent, render, screen } from '@testing-library/react-native';

import { StatsCard, type StatsVM } from './StatsCard';

/**
 * TRIP-1790 · 마이 탭 「지금까지」 통계 카드 — props 만 받는 순수 카드(조회·판정은 `MyPage` 몫).
 *
 * 무엇을 보장하나:
 *  - ready: 머리 「지금까지」 + 칸 셋(여행·도시·방문)의 값이 그대로 나온다. 방문 0 은 숫자 `0`(아는 값 — 모름이 아니다).
 *    잘렸으면(`truncated`) 세 값 **모두** 뒤에 `+`.
 *  - loading: 세 값 `–`(U+2013 — 프로필 카드와 같은 글자), 버튼 없음. failed: 세 값 `–` + 「다시 시도」, 누르면 `onRetry` 1회.
 *    재시도 중(`retrying`)이면 버튼이 진짜 disabled 라 눌러도 불리지 않는다(연타·중복 재요청 방지).
 *  - `onRetry` 가 없으면 어느 얼굴에도 버튼이 없다 — 눌러도 반응 없는 버튼을 그리지 않는다.
 *  - INV-3: 어느 얼굴에도 시간(분·시간·소요)·거리(km)·이동 글자가 없다.
 *
 * 커버하지 않는 것: 칸 사이 세로선·간격·그림자·카드 모양(생김새는 jest 금지 — 실화면 QA), 머리 부제 카피.
 *
 * 매처 근거: `toHaveTextContent(문자열)` 은 완전 일치(RNTL `matches` 의 `exact` 기본값) — 값 칸은 `12+` 한 Text 라 문자열 그대로 비교한다.
 * `toBeDisabled()` 는 호스트 Pressable 의 접근성 disabled 를 읽는다(`StaySelectSheet.test` 선례).
 *
 * 3동작: 준비(props) → 실행(render·press) → 단언.
 */

const EN_DASH = '–';
const TIME_OR_DISTANCE = /분|시간|소요|km|이동/;

function ready(
  over: Partial<Extract<StatsVM, { kind: 'ready' }>> = {}
): StatsVM {
  return {
    kind: 'ready',
    trips: 3,
    cities: 2,
    visits: 12,
    truncated: false,
    ...over,
  };
}

function values(): string[] {
  return ['trips', 'cities', 'visits'].map((cell) =>
    // 한 Text 의 글자 — 자식이 한 조각이든 둘이든 이어 붙인다.
    [screen.getByTestId(`my-stats-${cell}-value`).props.children]
      .flat()
      .join('')
  );
}

describe('ready 얼굴', () => {
  it('C1 · 머리 「지금까지」와 세 칸의 라벨·값이 나오고 재시도 버튼은 없다(onRetry 를 줘도)', () => {
    // 준비·실행
    render(<StatsCard stats={ready()} onRetry={jest.fn()} />);

    // 단언
    expect(screen.getByTestId('my-stats-card')).toBeOnTheScreen();
    expect(screen.getByText('지금까지')).toBeOnTheScreen();
    expect(screen.getByText('여행')).toBeOnTheScreen();
    expect(screen.getByText('도시')).toBeOnTheScreen();
    expect(screen.getByText('방문')).toBeOnTheScreen();
    expect(values()).toEqual(['3', '2', '12']);
    expect(screen.queryAllByText(/\+/)).toHaveLength(0);
    expect(screen.queryByTestId('my-stats-retry')).toBeNull();
  });

  it('C2 · 값이 0 이면 숫자 0 이다 — `–` 로 그리지 않는다', () => {
    render(<StatsCard stats={ready({ visits: 0 })} />);

    expect(screen.getByTestId('my-stats-visits-value')).toHaveTextContent('0');
    expect(values()).toEqual(['3', '2', '0']);
  });

  it('C3 · 잘렸으면 세 값 모두 뒤에 `+` 가 붙는다', () => {
    render(<StatsCard stats={ready({ truncated: true })} />);

    expect(values()).toEqual(['3+', '2+', '12+']);
  });
});

describe('loading · failed 얼굴', () => {
  it('C4 · loading — 세 값이 `–` 이고 버튼은 없다(onRetry 를 줘도)', () => {
    render(<StatsCard stats={{ kind: 'loading' }} onRetry={jest.fn()} />);

    expect(screen.getByTestId('my-stats-card')).toBeOnTheScreen();
    expect(values()).toEqual([EN_DASH, EN_DASH, EN_DASH]);
    expect(screen.queryByTestId('my-stats-retry')).toBeNull();
  });

  it('C5 · failed — 세 값이 `–` 이고 「다시 시도」를 누르면 onRetry 1회', () => {
    const onRetry = jest.fn();
    render(
      <StatsCard
        stats={{ kind: 'failed', retrying: false }}
        onRetry={onRetry}
      />
    );

    expect(values()).toEqual([EN_DASH, EN_DASH, EN_DASH]);
    const retry = screen.getByTestId('my-stats-retry');
    expect(retry).toHaveTextContent('다시 시도');
    expect(retry).not.toBeDisabled();

    fireEvent.press(retry);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('C6 · failed 인데 재시도 중이면 버튼이 disabled 라 눌러도 onRetry 가 불리지 않는다', () => {
    const onRetry = jest.fn();
    render(
      <StatsCard stats={{ kind: 'failed', retrying: true }} onRetry={onRetry} />
    );

    const retry = screen.getByTestId('my-stats-retry');
    expect(retry).toBeDisabled();

    fireEvent.press(retry);

    expect(onRetry).not.toHaveBeenCalled();
  });

  it('C7 · failed 인데 onRetry 가 없으면 버튼 자체가 없다(누를 곳 없는 버튼 금지)', () => {
    render(<StatsCard stats={{ kind: 'failed', retrying: false }} />);

    expect(values()).toEqual([EN_DASH, EN_DASH, EN_DASH]);
    expect(screen.queryByTestId('my-stats-retry')).toBeNull();
  });
});

describe('INV-3 · 시간·거리 글자가 없다', () => {
  it.each<[string, StatsVM]>([
    ['ready', ready()],
    ['ready · 잘림', ready({ truncated: true })],
    ['loading', { kind: 'loading' }],
    ['failed', { kind: 'failed', retrying: false }],
  ])('C8 · %s 얼굴에 분·시간·소요·km·이동 글자 0', (_name, stats) => {
    render(<StatsCard stats={stats} onRetry={jest.fn()} />);

    // 짝 — 카드가 실제로 그려졌다(안 그려서 0 이 공짜로 나오는 것 방지).
    expect(screen.getByTestId('my-stats-card')).toBeOnTheScreen();
    expect(screen.getByTestId('my-stats-visits-value')).toBeOnTheScreen();
    expect(screen.queryAllByText(TIME_OR_DISTANCE)).toHaveLength(0);
  });
});
