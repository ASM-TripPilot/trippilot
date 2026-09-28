import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import {
  HOME_DEFAULT_PROPS,
  HOME_LOADING_PROPS,
  HOME_TRAVELING_PROPS,
} from '../model/homeFixtures';
import type { HomeSpotCard, HomeSpotsLane } from '../model/homeTypes';
import { HomeScreen } from './HomeScreen';

/**
 * TRIP-1049 · 홈 '지금 뜨는 장소' — 실데이터 섹션 상태 + 저장 하트 (Figma a01 2091:1357, 하트 32 통일).
 *
 * 무엇을 보장하나(화면은 라우터·서버를 모르는 순수 뷰 — 조회·배선은 `(tabs)/index.tsx` 몫):
 *  - `spotsLane` 을 안 주면 지금처럼 픽스처 4장, 하트 없음(AC-14 — 담을 대상이 없는 "거짓말 하트" 금지).
 *  - 준 경우 섹션은 자기 상태를 따로 가진다: 대기=스켈레톤 · 실패=한 줄 재시도(AC-13) · 0장=섹션 숨김.
 *  - 하트는 카드에 poiId 가 있고 onToggleSave 가 있을 때만. 담김/안 담김 = 글리프 testID + selected.
 *  - 대기 중 하트는 disabled, 실패 문구 배너(AC-12 → AC-7 표시면).
 *  - 여행 중 얼굴(스팟 섹션이 있는 두 번째 얼굴)에서도 같은 섹션이 쓰인다.
 *
 * 홈 스팟 카드 자체는 여전히 버튼이 아니다(상세 이동은 별도 티켓) — 그래서 이 파일엔 카드 press 가 없다.
 */

const SPOT_A: HomeSpotCard = {
  poiId: 'poi-a',
  title: '해운대 해수욕장',
  tag: '#해변',
  imageUrl: null,
};
const SPOT_B: HomeSpotCard = {
  poiId: 'poi-b',
  title: '감천문화마을',
  tag: '#명소',
  imageUrl: null,
};

function lane(over: Partial<HomeSpotsLane> = {}): HomeSpotsLane {
  return {
    status: 'ready',
    cards: [SPOT_A, SPOT_B],
    onRetry: jest.fn(),
    savedPoiIds: [],
    pendingPoiIds: [],
    onToggleSave: jest.fn(),
    saveErrorMessage: null,
    onDismissSaveError: jest.fn(),
    ...over,
  };
}

describe('TRIP-1049 · 홈 지금 뜨는 장소 — 픽스처 무회귀', () => {
  it('H-1 · spotsLane 이 없으면 픽스처 카드만 그리고 하트는 하나도 없다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);

    expect(screen.getByTestId('home-spot-card-0')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^home-spot-save-/)).toHaveLength(0);
  });
});

describe('TRIP-1049 · 홈 지금 뜨는 장소 — 저장 하트', () => {
  it('H-2 · 카드마다 하트가 있고, 담긴 곳은 찬 하트+선택됨 · 아닌 곳은 빈 하트+선택 아님', () => {
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        spotsLane={lane({ savedPoiIds: ['poi-b'] })}
      />
    );

    // 카드는 실데이터 2장이다(픽스처 4장이 아니다).
    expect(
      within(screen.getByTestId('home-spot-card-0')).getByText(SPOT_A.title)
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('home-spot-card-2')).toBeNull();

    expect(
      screen.getByTestId('home-spot-heart-outline-poi-a')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('home-spot-save-poi-a')).not.toBeSelected();
    expect(
      screen.getByTestId('home-spot-heart-filled-poi-b')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('home-spot-heart-outline-poi-b')).toBeNull();
    expect(screen.getByTestId('home-spot-save-poi-b')).toBeSelected();
  });

  it('H-3 · 하트 press → onToggleSave(poiId) 1회', () => {
    const onToggleSave = jest.fn();
    render(
      <HomeScreen {...HOME_DEFAULT_PROPS} spotsLane={lane({ onToggleSave })} />
    );

    fireEvent.press(screen.getByTestId('home-spot-save-poi-a'));

    expect(onToggleSave).toHaveBeenCalledTimes(1);
    expect(onToggleSave).toHaveBeenCalledWith('poi-a');
  });

  it('H-4 · 대기 중 하트는 disabled 이고 눌러도 onToggleSave 0회 · 옆 하트는 살아 있다', () => {
    const onToggleSave = jest.fn();
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        spotsLane={lane({ pendingPoiIds: ['poi-a'], onToggleSave })}
      />
    );
    const heart = screen.getByTestId('home-spot-save-poi-a');

    expect(heart).toBeDisabled();
    fireEvent.press(heart);
    expect(onToggleSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('home-spot-save-poi-b')).not.toBeDisabled();
  });

  it('H-5 · 하트는 32 흰 원이다(h-8·w-8·rounded-pill·bg-on-primary — 하트 32 통일 결정)', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} spotsLane={lane()} />);

    const tokens = String(
      screen.getByTestId('home-spot-save-poi-a').props.className ?? ''
    )
      .trim()
      .split(/\s+/);
    expect(tokens).toEqual(
      expect.arrayContaining(['h-8', 'w-8', 'rounded-pill', 'bg-on-primary'])
    );
  });

  it('H-9 · poiId 없는 카드는 onToggleSave 가 있어도 하트를 그리지 않는다', () => {
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        spotsLane={lane({
          cards: [{ title: '이름만 있는 곳', tag: '#태그', imageUrl: null }],
        })}
      />
    );

    expect(screen.getByTestId('home-spot-card-0')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^home-spot-save-/)).toHaveLength(0);
  });

  it('H-10 · 실패 문구가 오면 배너에 그대로 보이고, 누르면 닫기 콜백이 온다', () => {
    const onDismissSaveError = jest.fn();
    const message = '연결이 불안정해 담지 못했어요';
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        spotsLane={lane({ saveErrorMessage: message, onDismissSaveError })}
      />
    );
    const banner = screen.getByTestId('home-spot-save-error');

    expect(within(banner).getByText(message)).toBeOnTheScreen();
    fireEvent.press(banner);
    expect(onDismissSaveError).toHaveBeenCalledTimes(1);
  });

  it('H-10b · 실패 문구가 없으면 배너도 없다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} spotsLane={lane()} />);

    expect(screen.queryByTestId('home-spot-save-error')).toBeNull();
    // 앵커 — 섹션은 그려졌다(배너 부재가 섹션 부재 때문이 아니다).
    expect(screen.getByTestId('home-spot-save-poi-a')).toBeOnTheScreen();
  });
});

describe('TRIP-1049 · 홈 지금 뜨는 장소 — 섹션 상태(대기·실패·0건)', () => {
  it('H-6 · 대기 중이면 스켈레톤만 그리고 카드는 없다', () => {
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        spotsLane={lane({ status: 'loading', cards: [] })}
      />
    );

    expect(screen.getByTestId('home-spots-skeleton')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-spot-card-0')).toBeNull();
  });

  it('H-7 · 실패면 한 줄 재시도가 뜨고, 누르면 onRetry 1회 · 카드는 없다(조용히 사라지지 않는다)', () => {
    const onRetry = jest.fn();
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        spotsLane={lane({ status: 'error', cards: [], onRetry })}
      />
    );

    fireEvent.press(screen.getByTestId('home-spots-error'));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('home-spot-card-0')).toBeNull();
    expect(screen.queryByTestId('home-spots-skeleton')).toBeNull();
  });

  it('H-8 · 0건이면 섹션을 통째로 숨긴다(제목·더 보기 없음), 다른 섹션은 그대로다', () => {
    render(
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        spotsLane={lane({ status: 'ready', cards: [] })}
      />
    );

    expect(screen.queryByText('지금 뜨는 장소')).toBeNull();
    expect(screen.queryByTestId('home-spots-more')).toBeNull();
    expect(screen.queryByTestId('home-spots-error')).toBeNull();
    // 짝 — 컬렉션 섹션은 산다(홈 전체를 지우는 구현 차단).
    expect(screen.getByTestId('home-collection-card-0')).toBeOnTheScreen();
  });
});

describe('TRIP-1049 · 여행 중 얼굴도 같은 섹션을 쓴다', () => {
  it('H-11 · 여행 중(스팟 섹션이 있는 얼굴)에서 spotsLane 카드·하트가 그려진다', () => {
    render(<HomeScreen {...HOME_TRAVELING_PROPS} spotsLane={lane()} />);

    expect(screen.getByTestId('home-spot-save-poi-a')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('home-spot-card-1')).getByText(SPOT_B.title)
    ).toBeOnTheScreen();
  });
});

/**
 * TRIP-1049 5-b 경고-1 보강 — 홈 전면 로딩(여행 정보 대기)이 스팟 섹션 상태보다 우선한다.
 *
 * 왜 필요한가: 여행 정보가 아직 안 왔을 때 스팟 레인만 먼저 도착하면, 우선순위가 뒤집힌 구현은
 * 여행 히어로가 스켈레톤인 채로 **엉뚱한 지역(전국)** 카드와 하트를 먼저 보여 준다(여행이 확정되면
 * 지역이 바뀌어 교체된다). 사용자는 다른 지역 카드를 잠깐 보고, 그 사이 하트를 누를 수도 있다.
 * code-critic M4 뮤턴트(우선순위 뒤집기)에 node 167개가 전부 green이던 사각을 막는다.
 */
describe('TRIP-1049 경고-1 · 홈 전면 로딩이면 스팟 레인 상태와 무관하게 스켈레톤이다', () => {
  it('H-12 · 전면 로딩 + 레인 ready(카드 2장) → 스켈레톤만, 카드·하트 없음', () => {
    render(<HomeScreen {...HOME_LOADING_PROPS} spotsLane={lane()} />);

    expect(screen.getByTestId('home-spots-skeleton')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-spot-card-0')).toBeNull();
    expect(screen.queryAllByTestId(/^home-spot-save-/)).toHaveLength(0);
  });

  it('H-13 · 전면 로딩 + 레인 ready(0장) → 섹션을 숨기지 않고 스켈레톤이다', () => {
    // 0건 숨김은 "조회가 끝났는데 비었다"일 때만이다 — 전면 로딩 중엔 아직 모른다.
    render(
      <HomeScreen {...HOME_LOADING_PROPS} spotsLane={lane({ cards: [] })} />
    );

    expect(screen.getByTestId('home-spots-skeleton')).toBeOnTheScreen();
  });

  it('H-14 · 전면 로딩 + 레인 error → 재시도가 아니라 스켈레톤이다', () => {
    render(
      <HomeScreen
        {...HOME_LOADING_PROPS}
        spotsLane={lane({ status: 'error', cards: [] })}
      />
    );

    expect(screen.getByTestId('home-spots-skeleton')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-spots-error')).toBeNull();
  });
});
