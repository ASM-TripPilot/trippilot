import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import {
  ExploreLandingScreen,
  type ExploreLandingScreenProps,
  type PlaceCardVM,
} from './ExploreLandingScreen';

/**
 * TRIP-1049 · d01 탐색 랜딩 '장소' 가로 레인 카드 저장 하트 (Figma 4664:2585).
 *
 * 무엇을 보장하나: d05 목적지 결과(`DestinationDetailScreen.test.tsx` TRIP-1049 절)와 같은 계약을
 * d01 레인에 건다 — 접두만 `explore-place-*` 로 다르다.
 *  - 저장 배선(onToggleSave)이 없으면 하트가 없다(AC-8, 기존 테스트·프리뷰 무회귀).
 *  - 담김/안 담김 = 서로 다른 글리프 testID + `selected`(색 X).
 *  - 하트 press → onToggleSave(poiId), 카드 이동 0(AC-4). 대기 중엔 둘 다 0(02a ★2).
 *  - 실패 문구 배너(AC-7 표시면), 로딩 얼굴에선 배너를 그리지 않는다(숙소 배너 선례).
 *
 * 3동작 뼈대: 준비=placeLane 저장 필드 → 실행=렌더/press → 단언=testID·selected·콜백 횟수.
 */

const A: PlaceCardVM = {
  poiId: 'p1',
  name: '감천문화마을',
  region: '사하구',
  imageUrl: null,
};
const B: PlaceCardVM = {
  poiId: 'p2',
  name: '광안리 해변',
  region: '수영구',
  imageUrl: null,
};

type PlaceLane = NonNullable<ExploreLandingScreenProps['placeLane']>;

function props(
  lane: Partial<PlaceLane> = {},
  over: Partial<ExploreLandingScreenProps> = {}
): ExploreLandingScreenProps {
  return {
    heading: { title: '무엇을 둘러볼까요?', subtitle: '둘러봐요' },
    onPressSearch: () => {},
    stayLane: {
      error: false,
      cards: [],
      onRetry: () => {},
      onSeeAll: () => {},
    },
    placeLane: {
      error: false,
      cards: [A, B],
      onRetry: () => {},
      onPressCard: jest.fn(),
      savedPoiIds: [],
      pendingPoiIds: [],
      onToggleSave: jest.fn(),
      saveErrorMessage: null,
      onDismissSaveError: jest.fn(),
      ...lane,
    },
    savedMenu: {
      open: false,
      savedCount: 0,
      onToggle: () => {},
      onPressSavedPlaces: () => {},
      onPressSavedStays: () => {},
    },
    ...over,
  };
}

describe('TRIP-1049 · d01 장소 레인 저장 하트', () => {
  it('S-1 · 저장 배선이 없으면 하트가 없고 카드는 그대로다(무회귀)', () => {
    render(
      <ExploreLandingScreen
        {...props({
          savedPoiIds: undefined,
          pendingPoiIds: undefined,
          onToggleSave: undefined,
          saveErrorMessage: undefined,
          onDismissSaveError: undefined,
        })}
      />
    );

    expect(screen.queryByTestId(`explore-place-save-${A.poiId}`)).toBeNull();
    expect(
      screen.getByTestId(`explore-place-card-${A.poiId}`)
    ).toBeOnTheScreen();
  });

  it('S-2 · 담긴 장소는 찬 하트+선택됨, 안 담긴 장소는 빈 하트+선택 아님', () => {
    render(<ExploreLandingScreen {...props({ savedPoiIds: [A.poiId] })} />);

    expect(
      screen.getByTestId(`explore-place-heart-filled-${A.poiId}`)
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId(`explore-place-heart-outline-${A.poiId}`)
    ).toBeNull();
    expect(screen.getByTestId(`explore-place-save-${A.poiId}`)).toBeSelected();

    expect(
      screen.getByTestId(`explore-place-heart-outline-${B.poiId}`)
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`explore-place-save-${B.poiId}`)
    ).not.toBeSelected();
  });

  it('S-3 · 하트 press → onToggleSave(poiId) 1회, 카드 이동은 0회', () => {
    const onToggleSave = jest.fn();
    const onPressCard = jest.fn();
    render(<ExploreLandingScreen {...props({ onToggleSave, onPressCard })} />);

    fireEvent.press(screen.getByTestId(`explore-place-save-${B.poiId}`));

    expect(onToggleSave).toHaveBeenCalledTimes(1);
    expect(onToggleSave).toHaveBeenCalledWith(B.poiId);
    expect(onPressCard).not.toHaveBeenCalled();
  });

  it('S-4 · 대기 중 하트는 disabled 이고, 눌러도 담기·카드 이동 모두 0회다', () => {
    const onToggleSave = jest.fn();
    const onPressCard = jest.fn();
    render(
      <ExploreLandingScreen
        {...props({ pendingPoiIds: [A.poiId], onToggleSave, onPressCard })}
      />
    );
    const heart = screen.getByTestId(`explore-place-save-${A.poiId}`);

    expect(heart).toBeDisabled();
    fireEvent.press(heart);

    expect(onToggleSave).not.toHaveBeenCalled();
    expect(onPressCard).not.toHaveBeenCalled();
    // 짝 — 옆 카드 하트는 살아 있다.
    expect(
      screen.getByTestId(`explore-place-save-${B.poiId}`)
    ).not.toBeDisabled();
  });

  it('S-5 · 실패 문구 배너가 문구 그대로 보이고, 누르면 닫기 콜백 · 문구 없으면 배너 없음', () => {
    const onDismissSaveError = jest.fn();
    const message = '지금은 담을 수 없는 장소예요';
    const { rerender } = render(<ExploreLandingScreen {...props()} />);
    expect(screen.queryByTestId('explore-place-save-error')).toBeNull();

    rerender(
      <ExploreLandingScreen
        {...props({ saveErrorMessage: message, onDismissSaveError })}
      />
    );
    const banner = screen.getByTestId('explore-place-save-error');

    expect(within(banner).getByText(message)).toBeOnTheScreen();
    fireEvent.press(banner);
    expect(onDismissSaveError).toHaveBeenCalledTimes(1);
  });

  it('S-6 · 로딩 얼굴(isLoading)에서는 실패 배너를 그리지 않는다', () => {
    render(
      <ExploreLandingScreen
        {...props(
          { saveErrorMessage: '연결이 불안정해 담지 못했어요' },
          {
            isLoading: true,
          }
        )}
      />
    );

    expect(screen.queryByTestId('explore-place-save-error')).toBeNull();
    // 앵커 — 정말 로딩 얼굴이다.
    expect(
      screen.getByTestId('explore-landing-skeleton-place-0')
    ).toBeOnTheScreen();
  });
});
