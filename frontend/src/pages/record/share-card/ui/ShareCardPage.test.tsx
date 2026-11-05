import { AxiosError } from 'axios';
import { createElement } from 'react';
import { View } from 'react-native';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { router } from 'expo-router';

import type {
  ShareCardCopy,
  Trip,
  TripSummary,
} from '@/shared/api/index.schemas';
import { customInstance } from '@/shared/api/mutator';
import { renderWithQueryClient } from '@/test-support/queryRender';

import { useTripSummary } from '@/features/reflection';
import { ShareCardScreen } from './ShareCardScreen';
import { StoryDeck } from './StoryDeck';
import {
  useGetTripsTripId,
  useGetTripsTripIdItinerary,
} from '@/shared/api/index.hooks';
import { ShareCardPage } from './ShareCardPage';

/**
 * TRIP-1667 · 이 파일의 「스토리 덱 ↔ 내보내기 전환」 describe 는 페이지가 두 얼굴(덱 → 내보내기 → 덱 마지막 장)을 한 곳에서
 * 잇는 배선(어느 화면이 서는가 · 어떤 값이 어느 쪽으로 내려가는가 · 뒤로/닫기가 어디로 가는가)을 목 화면 위에서 본다.
 * 덱 안의 장 내용·시간·탭은 `StoryDeck.test`/`storyDeck.test`/`useStoryDeck.test`, 서버를 낀 전체 흐름은 `ShareCardPage.integration` 이 맡는다.
 *
 * TRIP-1071 결정 4(c) · j06 공유 카드 페이지 — 요약 미준비면 카드 대신 안내.
 *
 * h16(확정 일정, 여행 전)에서도 [공유하기]로 j06 에 들어올 수 있게 됐다(결정 4c). 여행이 끝나 요약이
 * 준비되기 전(`envelope.ready === false`)에는 방문 0·사진 0 의 빈 카드를 그리지 않고, '여행이 끝나면
 * 만들 수 있어요' 안내와 [돌아가기]만 보인다 — 저장·공유·편집할 것이 없다(BR-U5-48 의 뜻을 j06 이 진다).
 *
 * 화면(`ShareCardScreen`)은 props 캡처 목(null 반환)으로 치환해 페이지 판정만 본다(TripSummaryPage.hookMock
 * 선례 — NativeWind interop 함정 회피). 안내(`StateNotice`)는 진짜로 그린다. 판정은 `shareEnabled`
 * 재사용이 권고지만 여기선 결과(무엇이 그려지나)만 본다.
 *
 * 3동작: 준비(요약·여행 조회 결과 주입) → 실행(페이지 렌더·버튼 press) → 단언(안내/화면·라우터 호출).
 */

jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    router: ['push', 'back', 'canGoBack', 'replace'],
  })
);

jest.mock('@/features/reflection/model/useTripSummary', () => ({
  useTripSummary: jest.fn(),
}));

// TRIP-1781 — 표지 사진을 고르는 훅. 이 파일은 `generated/trips/trips` 를 두 함수만 남기고 목하므로 진짜 훅(records 조회)이 못 돈다 →
// 배럴을 부분 목으로 막는다(나머지 export 는 그대로). 훅이 실제로 사진을 고르는 흐름은 `useTripCoverPhoto.integration`·`ShareCardPage.integration` 몫.
const mockUseTripCoverPhoto = jest.fn();
jest.mock('@/features/reflection', () => ({
  ...jest.requireActual('@/features/reflection'),
  useTripCoverPhoto: (...args: unknown[]) => mockUseTripCoverPhoto(...args),
}));

// 일정 조회(TRIP-1667 — 일차 카드 색용)도 이 모듈에서 온다. 빠지면 페이지가 TypeError 로 죽는다.
jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTripsTripId: jest.fn(),
  useGetTripsTripIdItinerary: jest.fn(),
}));

// 화면·덱은 "받은 props 만 기록하는" 가짜다 — 서 있는지는 testID 마커로 본다(JSX 대신 createElement: NativeWind 주입 참조 함정 회피).
jest.mock('./ShareCardScreen', () => ({
  ShareCardScreen: jest.fn(() => null),
}));
jest.mock('./StoryDeck', () => ({
  StoryDeck: jest.fn(() => null),
}));

// TRIP-1605 — 카드 얼굴이 서버 문구(POST …/share-card/copy)를 부른다. 생성 클라이언트가 모두 지나는 `customInstance` 한 곳만
// 목으로 막아 네트워크 0 으로 둔다(끝나지 않는 Promise = 문구 대기 중). "언제·몇 번 부르나"는 MSW 로 보는
// ShareCardPage.integration AC-1 이 맡는다(같은 네 경우 — 2026-11-01 jest 축소에서 이 파일 사본을 지웠다).
jest.mock('@/shared/api/mutator', () => ({
  customInstance: jest.fn(),
}));
const customInstanceMock = customInstance as jest.Mock;

const NOT_READY_TITLE = '여행이 끝나면 만들 수 있어요';

const TRIP: Trip = {
  tripId: 'trip-1',
  title: '부산 여행',
  startDate: '2026-06-10',
  endDate: '2026-06-12',
  party: 2,
  preferenceSnapshot: {},
  destinations: [{ seq: 1, region: '부산', nights: 2 }],
  status: 'PLANNED',
  createdAt: '2026-06-01T10:00:00Z',
  updatedAt: '2026-06-01T10:00:00Z',
} as Trip;

const SUMMARY: TripSummary = {
  narrative: '좋은 여행이었어요',
  highlights: [
    {
      date: '2026-06-11',
      dayOrder: 1,
      visitCount: 2,
      places: ['광안리 해변', '감천문화마을'],
    },
  ],
  stats: {
    totalVisits: 12,
    totalDistanceKm: 38,
    distanceSource: 'VISIT_LINE',
    totalPhotos: 24,
    hasLocationData: false,
  },
  source: 'RULE',
  generatedAt: '2026-06-12T10:00:00Z',
};

const AI_COPY: ShareCardCopy = {
  caption: '광안리에서 노을을 보고 감천문화마을 골목을 걸었어요',
  hashtags: ['#광안리노을', '#감천문화마을'],
  isFallback: false,
};

/** 서버가 준 실패 응답 흉내 — `isAxiosError` 가 true 여야 훅의 한도 판정이 돈다(`isRateLimited.test.ts` 선례). */
function httpError(status: number, data: unknown = {}): AxiosError {
  const error = new AxiosError('request failed');
  error.response = {
    status,
    statusText: '',
    data,
    headers: {},
    config: { headers: {} },
  } as AxiosError['response'];
  return error;
}

function givenTrip() {
  (useGetTripsTripId as jest.Mock).mockReturnValue({
    data: TRIP,
    isPending: false,
    isError: false,
  });
}

function givenSummary(ready: boolean) {
  (useTripSummary as jest.Mock).mockReturnValue({
    envelope: ready ? { ready: true, summary: SUMMARY } : { ready: false },
    summary: ready ? SUMMARY : undefined,
    source: ready ? 'RULE' : undefined,
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  });
}

const screenMock = ShareCardScreen as unknown as jest.Mock;
const deckMock = StoryDeck as unknown as jest.Mock;
const lastProps = (mock: jest.Mock) => mock.mock.calls.at(-1)?.[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockUseTripCoverPhoto.mockReturnValue({ photo: null, picking: false });
  customInstanceMock.mockImplementation(() => new Promise(() => undefined));
  // 일정 조회는 색에만 쓰인다 — 이 파일에선 "아직 안 옴"(데이터 없음)으로 둔다. 몇 번·언제 부르는지는 통합이 MSW 로 센다.
  (useGetTripsTripIdItinerary as jest.Mock).mockReturnValue({
    data: undefined,
    isPending: false,
    isError: false,
  });
  // 마커: 지금 어느 얼굴이 서 있는지 testID 로 읽는다.
  screenMock.mockImplementation(() =>
    createElement(View, { testID: 'mock-export-face' })
  );
  deckMock.mockImplementation(() =>
    createElement(View, { testID: 'mock-story-deck' })
  );
});

describe('🔴 TRIP-1071 AC-12 · 요약 미준비(ready:false) → 카드 대신 안내 (결정 4c)', () => {
  it('안내 제목이 뜨고, 카드 화면은 그리지 않는다(저장·공유·편집 어포던스 0)', () => {
    // 준비: 여행은 있고 요약은 아직(여행 전·진행 중).
    givenTrip();
    givenSummary(false);

    // 실행
    renderWithQueryClient(<ShareCardPage tripId="trip-1" />);

    // 단언
    const notice = screen.getByTestId('reflection-share-not-ready');
    expect(within(notice).getByText(NOT_READY_TITLE)).toBeOnTheScreen();
    expect(screenMock).not.toHaveBeenCalled();
    expect(deckMock).not.toHaveBeenCalled(); // 덱도 없다 — 서버 문구 호출은 덱이 서야 시작되므로 이 얼굴에선 0
  });

  it('[돌아가기] press → router.back 1회(막다른 화면이 아니다, Q4)', () => {
    givenTrip();
    givenSummary(false);
    renderWithQueryClient(<ShareCardPage tripId="trip-1" />);

    const back = screen.getByTestId('reflection-share-not-ready-back');
    expect(within(back).getByText('돌아가기')).toBeOnTheScreen();
    fireEvent.press(back);

    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('ready:true → 스토리 덱이 첫 얼굴로 서고(내보내기 화면은 아직 아님), 안내는 없다(짝 앵커)', async () => {
    givenTrip();
    givenSummary(true);

    renderWithQueryClient(<ShareCardPage tripId="trip-1" />);
    // 서버 문구 뮤테이션이 시작될 때까지 기다린다 — 덱이 첫 얼굴일 때 이미 1회 나간다(안 기다리면 시작 갱신이 act 밖으로 샌다)
    await waitFor(() => expect(customInstanceMock).toHaveBeenCalledTimes(1));

    expect(screen.getByTestId('mock-story-deck')).toBeOnTheScreen();
    expect(screenMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('reflection-share-not-ready')).toBeNull();
    // 덱이 받는 값: 장 목록(표지·1일차·동선·숫자 = 4장), 서버 문구 전(캡션 ''), 온디바이스 해시태그, 처음 장에서 시작
    const props = lastProps(deckMock);
    expect(props.slides.map((slide: { key: string }) => slide.key)).toEqual([
      'cover',
      'day-1',
      'route',
      'stats',
    ]);
    expect(props.caption).toBe('');
    expect(props.hashtagText).toBe('#부산여행');
    expect(props.startAt ?? 'first').toBe('first');
  });

  it('조회 중이면 기존 준비 중 안내 그대로 — 미준비 안내와 섞이지 않는다(회귀 앵커)', () => {
    (useGetTripsTripId as jest.Mock).mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    });
    (useTripSummary as jest.Mock).mockReturnValue({
      envelope: undefined,
      summary: undefined,
      source: undefined,
      isPending: true,
      isError: false,
      refetch: jest.fn(),
    });

    renderWithQueryClient(<ShareCardPage tripId="trip-1" />);

    expect(screen.getByTestId('reflection-share-pending')).toBeOnTheScreen();
    expect(screen.queryByTestId('reflection-share-not-ready')).toBeNull();
    expect(screenMock).not.toHaveBeenCalled();
    expect(deckMock).not.toHaveBeenCalled();
  });
});

describe('🔴 TRIP-1071 5-b 경고-1 · 요약 조회 오류는 "미준비"로 접지 않는다 (INV-4 · Seed Q4)', () => {
  it('오류 → reflection-share-error + [다시 시도](재조회 1회), 미준비 안내·카드 화면은 없다', () => {
    // 준비: 여행은 있고 요약 조회가 실패했다(봉투 없음 — 분기가 없으면 미준비 안내로 새는 모양).
    givenTrip();
    const refetch = jest.fn();
    (useTripSummary as jest.Mock).mockReturnValue({
      envelope: undefined,
      summary: undefined,
      source: undefined,
      isPending: false,
      isError: true,
      refetch,
    });

    // 실행: 렌더 후 [다시 시도]를 누른다.
    renderWithQueryClient(<ShareCardPage tripId="trip-1" />);
    const retry = screen.getByTestId('reflection-share-retry');
    fireEvent.press(retry);

    // 단언: 오류 안내가 뜨고, 재조회가 1회 불린다.
    expect(screen.getByTestId('reflection-share-error')).toBeOnTheScreen();
    expect(within(retry).getByText('다시 시도')).toBeOnTheScreen();
    expect(refetch).toHaveBeenCalledTimes(1);
    // 오류를 '여행이 끝나면…'(미준비)으로 둔갑시키지 않는다 + 카드·저장/공유 어포던스 0.
    expect(screen.queryByTestId('reflection-share-not-ready')).toBeNull();
    expect(screen.queryByText(NOT_READY_TITLE)).toBeNull();
    expect(screenMock).not.toHaveBeenCalled();
    expect(deckMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('reflection-share-save')).toBeNull();
    expect(screen.queryByTestId('reflection-share-export')).toBeNull();
  });
});

describe('🔴 TRIP-1667 · 스토리 덱 ↔ 내보내기 전환 (같은 얼굴 아래의 상태 전환)', () => {
  // 서버 문구 뮤테이션은 마운트 직후 비동기로 시작해 상태를 바꾼다 — 시작(customInstance 1회)까지 기다려 act 밖 갱신 경고를 막는다.
  const mount = async () => {
    givenTrip();
    givenSummary(true);
    const view = renderWithQueryClient(<ShareCardPage tripId="trip-1" />);
    await waitFor(() => expect(customInstanceMock).toHaveBeenCalledTimes(1));
    return view;
  };
  /** 덱의 [공유 카드 만들기] 를 누른 것처럼 `onMake` 를 부른다. */
  const make = () => act(() => lastProps(deckMock).onMake());
  /** 내보내기 화면의 뒤로를 누른 것처럼 `onBack` 을 부른다. */
  const exportBack = () => act(() => lastProps(screenMock).onBack());

  it('PU-1 · [공유 카드 만들기] → 덱이 사라지고 내보내기 화면이 선다, 헤더 뒤로 → 덱 "마지막 장"으로 돌아온다(화면 이탈 아님)', async () => {
    await mount();
    expect(screen.queryByTestId('mock-export-face')).toBeNull(); // 실행 전 "아직 없다" 앵커

    make();
    expect(screen.getByTestId('mock-export-face')).toBeOnTheScreen();
    expect(screen.queryByTestId('mock-story-deck')).toBeNull();

    exportBack();
    expect(screen.getByTestId('mock-story-deck')).toBeOnTheScreen();
    expect(screen.queryByTestId('mock-export-face')).toBeNull();
    expect(lastProps(deckMock).startAt).toBe('last');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('PU-2 · 덱의 ×(onClose)는 화면을 나간다(router.back 1회) — 내보내기 화면의 뒤로는 나가지 않는다(PU-1)', async () => {
    await mount();

    act(() => lastProps(deckMock).onClose());

    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('PU-3 · 덱 → 내보내기 → 덱 → 내보내기를 오가도 서버 문구 호출은 1회 그대로다(얼굴을 다시 마운트하지 않는다)', async () => {
    await mount();
    // 덱이 첫 얼굴일 때 이미 1회
    await waitFor(() => expect(customInstanceMock).toHaveBeenCalledTimes(1));

    make();
    exportBack();
    make();
    exportBack();
    await act(async () => {});

    expect(customInstanceMock).toHaveBeenCalledTimes(1);
  });

  it('PU-4 · 해시태그는 한 곳에서 정한다: 내보내기에서 고친 값(onCommitHashtags)이 내보내기 화면·덱 양쪽에 내려가고 다시 열어도 유지된다', async () => {
    await mount();
    make();
    // 내보내기 화면은 보여 줄 값(hashtagText)을 받아 그리고, 고친 값은 위로 올린다(controlled)
    expect(lastProps(screenMock).hashtagText).toBe('#부산여행');
    expect(typeof lastProps(screenMock).onCommitHashtags).toBe('function');

    act(() => lastProps(screenMock).onCommitHashtags('#내태그'));
    expect(lastProps(screenMock).hashtagText).toBe('#내태그');

    exportBack();
    expect(lastProps(deckMock).hashtagText).toBe('#내태그');

    make();
    expect(lastProps(screenMock).hashtagText).toBe('#내태그');
  });

  it('PU-5 · 내보내기 화면이 받는 나머지 값: 대표 카드·포맷 3종·서버 문구 대기 표시(copyPending)가 그대로 내려간다', async () => {
    await mount();
    make();

    const props = lastProps(screenMock);
    expect(props.card.title).toBe('부산 여행');
    expect(props.formats).toHaveLength(3);
    expect(props.copyPending).toBe(true); // customInstance 가 끝나지 않는 Promise = 문구 대기 중
    expect(props.copyLimitReached).toBe(false);
    expect(props.caption).toBe('');
  });

  it('PU-6 · 서버 문구가 오면 대기 표시(copyPending)가 꺼지고 문구가 내려간다 — 응답 뒤에도 true 면 캡션 자리 회색 상자가 계속 깜빡인다', async () => {
    // 준비: 응답을 우리가 풀어 줄 때까지 붙잡아 둔다(PU-5 의 "끝나지 않는 Promise" 와 짝 — 이쪽은 끝나는 쪽).
    let resolveCopy: (copy: ShareCardCopy) => void = () => undefined;
    customInstanceMock.mockImplementation(
      () =>
        new Promise<ShareCardCopy>((resolve) => {
          resolveCopy = resolve;
        })
    );
    await mount();
    make();
    expect(lastProps(screenMock).copyPending).toBe(true); // 응답 전 앵커 — 아래 false 가 "원래 false" 가 아님을 보인다

    // 실행: 서버가 문구를 준다.
    await act(async () => resolveCopy(AI_COPY));

    // 단언: 대기가 꺼지고, 서버 캡션이 화면 쪽 props 로 내려간다.
    const props = lastProps(screenMock);
    expect(props.copyPending).toBe(false);
    expect(props.caption).toBe(AI_COPY.caption);
    expect(props.copyLimitReached).toBe(false);
  });

  it.each([
    [
      '하루 한도(429 SHARE_CARD_DAILY_LIMIT)',
      httpError(429, { error: { code: 'SHARE_CARD_DAILY_LIMIT' } }),
      true,
    ],
    ['그 밖의 서버 실패(500)', httpError(500), false],
  ])(
    'PU-7 · 문구 요청이 %s 로 끝나도 대기 표시(copyPending)가 꺼진다 — 한도 안내(copyLimitReached)만 갈린다',
    async (_name, error, limitReached) => {
      // 준비: PU-6 과 같게 응답을 붙잡아 두되, 이번엔 실패로 푼다.
      let rejectCopy: (reason: unknown) => void = () => undefined;
      customInstanceMock.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectCopy = reject;
          })
      );
      await mount();
      make();
      expect(lastProps(screenMock).copyPending).toBe(true); // 실패 전 앵커

      // 실행: 서버가 실패로 답한다.
      await act(async () => rejectCopy(error));

      // 단언: 대기는 꺼지고, 서버 문구는 없으며(캡션 빈 채), 한도 안내만 실패 종류에 따라 갈린다.
      const props = lastProps(screenMock);
      expect(props.copyPending).toBe(false);
      expect(props.caption).toBe('');
      expect(props.copyLimitReached).toBe(limitReached);
    }
  );
});

// TRIP-1781 · 표지 사진 — 페이지가 훅 결과를 한 번 받아 덱 표지와 대표 카드(내보내기)에 **같은 값**으로 내리고, 고르는 동안은 저장·공유를 잠근다.
// 화면·덱은 props 캡처 목이라 "무엇을 받았나"만 본다. 노드가 실제로 서는지는 `ShareCardPage.integration`·`StoryDeck.test` 가 본다.
describe('🔴 TRIP-1781 · 표지 사진 배선', () => {
  const PHOTO = { uri: 'file://a', poiId: 'p1' };
  const mount = async () => {
    givenTrip();
    givenSummary(true);
    const view = renderWithQueryClient(<ShareCardPage tripId="trip-1" />);
    await waitFor(() => expect(customInstanceMock).toHaveBeenCalledTimes(1));
    return view;
  };
  const make = () => act(() => lastProps(deckMock).onMake());

  it('PC-1 · 사진이 있으면 덱 첫 장(표지)과 내보내기 화면이 같은 사진을 받고, 잠금은 풀려 있다', async () => {
    mockUseTripCoverPhoto.mockReturnValue({ photo: PHOTO, picking: false });
    await mount();

    const cover = lastProps(deckMock).slides[0];
    expect(cover.kind).toBe('cover');
    expect(cover.cover.picture).toEqual(PHOTO);

    make();
    expect(lastProps(screenMock).coverPicture).toEqual(PHOTO);
    expect(lastProps(screenMock).exportLocked).toBe(false);
  });

  it('PC-2 · 사진이 없으면 표지의 사진도 대표 카드의 사진도 null(색 표지)이다', async () => {
    await mount();

    expect(lastProps(deckMock).slides[0].cover.picture).toBeNull();
    make();
    expect(lastProps(screenMock).coverPicture).toBeNull();
  });

  it('PC-3 · 사진을 고르는 중이면 내보내기 화면의 exportLocked 가 참이고, 끝나면 거짓으로 따라간다', async () => {
    mockUseTripCoverPhoto.mockReturnValue({ photo: null, picking: true });
    const view = await mount();
    make();
    expect(lastProps(screenMock).exportLocked).toBe(true); // 고르는 중 앵커

    mockUseTripCoverPhoto.mockReturnValue({ photo: PHOTO, picking: false });
    view.rerender(<ShareCardPage tripId="trip-1" />);

    expect(lastProps(screenMock).exportLocked).toBe(false);
    expect(lastProps(screenMock).coverPicture).toEqual(PHOTO);
  });

  it('PC-4 · 훅은 요약이 준비돼도 안 돼도 불린다 — 준비되면 사진 수를, 아니면 undefined(요청 0)를 넘긴다', async () => {
    givenTrip();
    givenSummary(true);
    const ready = renderWithQueryClient(<ShareCardPage tripId="trip-1" />);
    await waitFor(() => expect(customInstanceMock).toHaveBeenCalledTimes(1));
    expect(mockUseTripCoverPhoto).toHaveBeenLastCalledWith({
      tripId: 'trip-1',
      totalPhotos: SUMMARY.stats.totalPhotos,
    });
    ready.unmount();

    mockUseTripCoverPhoto.mockClear();
    givenSummary(false);
    renderWithQueryClient(<ShareCardPage tripId="trip-1" />);
    expect(mockUseTripCoverPhoto).toHaveBeenCalled();
    expect(mockUseTripCoverPhoto).toHaveBeenLastCalledWith({
      tripId: 'trip-1',
      totalPhotos: undefined,
    });
  });
});
