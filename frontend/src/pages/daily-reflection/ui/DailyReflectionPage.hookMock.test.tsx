import type { ReactNode } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';

import { useDailyReflection } from '@/features/reflection/model/useDailyReflection';
import { DailyReflectionScreen } from './DailyReflectionScreen';
import {
  useGetTripsTripIdReflections,
  usePostTripsTripIdReflectionsDayDate,
  usePutTripsTripIdReflectionsDayDate,
} from '@/shared/api/generated/reflection/reflection';
import type {
  Reflection,
  ReflectionCard,
  ReflectionStats,
} from '@/shared/api/generated/schemas';
import { useGetTripsTripId } from '@/shared/api/generated/trips/trips';
import { seoulDate } from '@/shared/date/seoulDate';

import { DailyReflectionPage } from './DailyReflectionPage';

/**
 * j03 오늘의 회고 페이지 — 훅(`useDailyReflection`·여행 조회)을 목으로 갈아 끼워 **페이지 배선만** 본다(node 버킷).
 * 실제 HTTP 로 보는 흐름은 `DailyReflectionPage.integration.test.tsx`(msw). 관점마다 describe 하나(옛 파일 하나).
 *
 * 옛 파일마다 목 모양이 달랐다 — jest.mock 은 파일 맨 위로 끌어올려져 파일 전체에 한 번만 걸리므로
 * 관점별 차이는 아래 장치로 가른다:
 *  - `useDailyReflection`: 기본은 빈 jest.fn(각 테스트가 mockReturnValue 로 답을 정한다). 회고 카드 묶음만
 *    beforeEach 에서 **실물 훅**으로 바꿔 생성 reflection 훅 목 위에서 돌린다.
 *  - 화면(`DailyReflectionScreen`): 실물을 그대로 그리되 jest.fn 으로 한 겹 감싸, 공유 묶음이 페이지가 넘긴
 *    props 를 `mock.calls` 로 읽는다(옛 공유 파일은 null 스텁이었다 — 스텁 스위치를 빼도 green 이라 실측 뒤 걷었다).
 *  - 위치 권한(`expo-location`): 기본은 값 없음(undefined) = 옛 무목 파일이 받던 jest-expo 기본과 같다 →
 *    페이지가 "모름"으로 둔다. 지도 사유 묶음만 granted/denied 를 정한다. (j01 `TripRecordsPage` 와 기본값이 다르다 —
 *    거긴 같은 undefined 가 catch 로 떨어져 일반 모드.)
 *  - 매 테스트 뒤 최상위 afterEach 가 이 값들을 되돌린다. (개념) `jest.clearAllMocks()` 는 호출 기록만 지우고
 *    `mockReturnValue` 는 남긴다 — 앞 describe 의 답이 뒤 describe 로 새지 않게 `mockReset()` 으로 지운다.
 */

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn(() => true),
    back: jest.fn(),
  },
}));

jest.mock('@/features/reflection/model/useDailyReflection', () => ({
  useDailyReflection: jest.fn(),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTripsTripId: jest.fn(),
}));

jest.mock('@/shared/api/generated/reflection/reflection', () => ({
  useGetTripsTripIdReflections: jest.fn(),
  usePostTripsTripIdReflectionsDayDate: jest.fn(),
  usePutTripsTripIdReflectionsDayDate: jest.fn(),
}));

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...args: unknown[]) =>
    mockGetForeground(...args),
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForeground(...args),
}));

// 화면은 실물 — jest.fn 한 겹은 페이지가 넘긴 props 를 mock.calls 로 읽으려는 것뿐이다(공유 묶음).
// 팩토리 안에서 JSX 를 쓰면 babel 이 바깥 변수(_jsx)를 참조해 호이스팅 검사에 걸린다 → createElement.
jest.mock('./DailyReflectionScreen', () => {
  const actual = jest.requireActual<typeof import('./DailyReflectionScreen')>(
    './DailyReflectionScreen'
  );
  return {
    ...actual,
    DailyReflectionScreen: jest.fn((props: object) =>
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('react').createElement(actual.DailyReflectionScreen, props)
    ),
  };
});

const PAST_TODAY = '2026-09-26';
/** 소요시간 표기 탐지기(INV-3) — reflectionStructure G6 과 같은 식. */
const DURATION_TEXT = /(소요|\d+\s*분|\d+\s*시간)/;
function card(subtitle: string): ReflectionCard {
  return {
    templateId: 'backend.rule.daily.v1',
    format: 'CARD',
    title: subtitle,
    subtitle,
    payload: JSON.stringify({ cover: { title: subtitle, subtitle } }),
  };
}
// jest 는 팩토리 밖 변수를 `mock*` 이름일 때만 허용하므로 지연 래퍼로 참조한다.
const mockGetForeground = jest.fn();
const mockRequestForeground = jest.fn();

afterEach(() => {
  (router.canGoBack as jest.Mock).mockReset().mockReturnValue(true);
  (useDailyReflection as jest.Mock).mockReset();
  (useGetTripsTripId as jest.Mock).mockReset();
  mockGetForeground.mockReset();
  mockRequestForeground.mockReset();
});

describe('얼굴 — 레코드 없음 ≠ 활동 없음, 생성 조건', () => {
  // TRIP-1068 (옛 DailyReflectionPage.faces.test.tsx)
  /**
   * TRIP-1068 · j03 — "레코드 없음 ≠ 활동 없음". 훅이 이렇게 답하면 페이지가 어떤 얼굴을 그리고
   * 생성(`create`)을 몇 번 부르나.
   *
   * 무엇을 보장하나:
   *  - AC-2: 레코드가 있으면 서버 stats 로만 얼굴을 가른다 — 0·0 이면 empty, 나머지는 누락 표기 규칙.
   *    0·0 이어도 사용자가 직접 쓴 수정본이 있으면 그 글을 보인다(AC-9 저장 경로 무회귀, 02a §1-3).
   *  - AC-4: 목록 조회 중, 그리고 목록은 왔지만 훅이 아직 "생성 중"이라 말하지 않는 렌더에서도 pending
   *    이다 — empty 로 접지 않는다. pending 은 본문만 바꾸고 헤더 편집·일차 탭·탭바는 남긴다(Q2).
   *  - AC-1: 생성은 마운트당 한 번 — 다시 그려져도 두 번 쏘지 않는다.
   *  - AC-6·7·8: 미래 날짜·레코드 있음·조회 실패면 만들지 않는다.
   *
   * 훅 2개만 목한다. 목 `create` 는 불려도 훅 상태를 바꾸지 않는다 — "목록 도착 후 발사 전" 렌더를
   * 그대로 붙잡아 두는 장치다(통합 테스트에선 한 act 안에 지나가 관찰할 수 없다).
   */

  const TRIP_ID = 'trip-1068';

  const DAY = '2026-09-24';

  const FUTURE_TODAY = '2026-09-23';

  const WRITTEN = '바다를 보며 천천히 걸은 하루';

  function record(
    stats: Pick<ReflectionStats, 'visitCount' | 'photoCount'>,
    over: Partial<Reflection> = {}
  ): Reflection {
    return {
      dayDate: DAY,
      card: card('서버가 고른 하루'),
      draftCard: card('서버가 고른 하루'),
      editedCard: null,
      source: 'RULE',
      stats: { distanceKm: 3, distanceSource: 'VISIT_LINE', ...stats },
      generatedAt: '2026-09-24T12:00:00Z',
      updatedAt: '2026-09-24T12:00:00Z',
      ...over,
    };
  }

  interface Arrange {
    reflection?: Reflection;
    isPending?: boolean;
    isError?: boolean;
  }

  /** 훅 목을 세팅하고 `create` 목을 돌려준다(생성 상태 필드는 주지 않는다 = 미진행·미실패). */
  function arrange({
    reflection,
    isPending = false,
    isError = false,
  }: Arrange): jest.Mock {
    const create = jest.fn();
    (useGetTripsTripId as jest.Mock).mockReturnValue({
      data: { tripId: TRIP_ID, startDate: '2026-09-24', endDate: '2026-09-25' },
      isPending: false,
      isError: false,
    });
    (useDailyReflection as jest.Mock).mockReturnValue({
      reflection,
      isPending,
      isError,
      refetch: jest.fn(),
      create,
      saveEdit: jest.fn(),
    });
    return create;
  }

  function page(today: string) {
    return <DailyReflectionPage tripId={TRIP_ID} date={DAY} today={today} />;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('AC-2 · 레코드가 있으면 서버 stats 로만 얼굴을 가른다 (결정 3 · BR-U5-34)', () => {
    it('방문 0·사진 0 이면 empty — 빈 원 문구와 "직접 회고 작성"이 보이고 본문은 없다', () => {
      arrange({ reflection: record({ visitCount: 0, photoCount: 0 }) });

      render(page(PAST_TODAY));

      expect(screen.getByTestId('reflection-daily-empty')).toHaveTextContent(
        '이 날 기록된 활동이 없습니다'
      );
      expect(screen.getByTestId('reflection-daily-compose')).toBeOnTheScreen();
      expect(screen.queryByTestId('reflection-daily-narrative')).toBeNull();
    });

    it.each([
      [0, 1],
      [1, 0],
      [3, 0],
      [1, 5],
    ])(
      '방문 %i·사진 %i 이면 data-insufficient — 본문은 있고 "수정" 링크·empty 는 없다',
      (visitCount, photoCount) => {
        arrange({ reflection: record({ visitCount, photoCount }) });

        render(page(PAST_TODAY));

        expect(
          screen.getByTestId('reflection-daily-narrative')
        ).toBeOnTheScreen();
        expect(
          screen.queryByTestId('reflection-daily-narrative-edit')
        ).toBeNull();
        expect(screen.queryByTestId('reflection-daily-empty')).toBeNull();
      }
    );

    it('방문 2·사진 1 이면 default — 서술 카드 "수정" 링크가 있고 empty 는 없다', () => {
      arrange({ reflection: record({ visitCount: 2, photoCount: 1 }) });

      render(page(PAST_TODAY));

      expect(
        screen.getByTestId('reflection-daily-narrative-edit')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('reflection-daily-empty')).toBeNull();
    });

    it('0·0 이어도 사용자가 직접 쓴 수정본이 있으면 empty 로 접지 않고 그 글을 보인다 (AC-9 · BR-U5-36)', () => {
      arrange({
        reflection: record(
          { visitCount: 0, photoCount: 0 },
          { card: card(WRITTEN), editedCard: card(WRITTEN), source: 'BASIC' }
        ),
      });

      render(page(PAST_TODAY));

      expect(screen.queryByTestId('reflection-daily-empty')).toBeNull();
      expect(
        screen.getByTestId('reflection-daily-narrative')
      ).toHaveTextContent(WRITTEN);
    });
  });

  describe('AC-4 · 조회·생성 중에는 pending — empty 로 접지 않는다 (INV-4)', () => {
    it('① 목록을 아직 못 받았으면 pending 이고 empty 는 없으며, 레코드 유무를 모르니 만들지 않는다', () => {
      const create = arrange({ isPending: true });

      render(page(PAST_TODAY));

      expect(screen.getByTestId('reflection-daily-pending')).toBeOnTheScreen();
      expect(screen.queryByTestId('reflection-daily-empty')).toBeNull();
      expect(create).not.toHaveBeenCalled();
    });

    it('③ 목록은 왔고 그 날 레코드가 없으면 생성을 한 번 부르고, 훅이 아직 "생성 중"이라 말하지 않아도 pending 이다', () => {
      const create = arrange({ reflection: undefined });

      render(page(PAST_TODAY));

      expect(create).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('reflection-daily-pending')).toBeOnTheScreen();
      expect(screen.queryByTestId('reflection-daily-empty')).toBeNull();
    });

    it('pending 은 본문만 바꾼다 — 헤더 "편집"·일차 탭·탭바는 남고 하단 CTA 는 없으며, 안내 글자가 비지 않았다 (Q2)', () => {
      arrange({ reflection: undefined });

      render(page(PAST_TODAY));

      const pending = screen.getByTestId('reflection-daily-pending');
      expect(pending).toHaveTextContent(/\S/);
      expect(screen.getByTestId('reflection-daily-edit')).toBeOnTheScreen();
      expect(
        screen.getByTestId('reflection-daily-day-tab-1')
      ).toBeOnTheScreen();
      expect(screen.getByTestId('shell-tabbar-root')).toBeOnTheScreen();
      expect(screen.queryByTestId('reflection-daily-compose')).toBeNull();
      expect(screen.queryByTestId('reflection-daily-confirm')).toBeNull();
    });

    it('pending 화면 전체 글자에 소요시간 표기가 없다 (INV-3)', () => {
      arrange({ reflection: undefined });

      render(page(PAST_TODAY));

      // 앵커 — pending 얼굴이 실제로 그려졌다(빈 화면이라 통과하는 게 아니다).
      expect(screen.getByTestId('reflection-daily-pending')).toBeOnTheScreen();
      expect(screen.root).not.toHaveTextContent(DURATION_TEXT);
    });
  });

  describe('AC-1 · 생성은 마운트당 한 번이다', () => {
    it('오늘 날짜에 레코드가 없으면 생성을 부르고, 다시 그려져도 두 번 부르지 않는다', () => {
      const create = arrange({ reflection: undefined });

      const { rerender } = render(page(DAY));
      rerender(page(DAY));
      rerender(page(DAY));

      expect(create).toHaveBeenCalledTimes(1);
    });
  });

  describe('AC-6 · 미래 날짜는 만들지 않는다 (결정 2)', () => {
    it('보는 날이 오늘보다 뒤면 생성 0회, 기존 empty(중립 문구)이고 pending 이 아니다', () => {
      const create = arrange({ reflection: undefined });

      render(page(FUTURE_TODAY));

      expect(create).not.toHaveBeenCalled();
      expect(screen.getByTestId('reflection-daily-empty')).toHaveTextContent(
        '이 날 기록된 활동이 없습니다'
      );
      expect(screen.queryByTestId('reflection-daily-pending')).toBeNull();
    });
  });

  describe('AC-7 · 그 날 레코드가 이미 있으면 만들지 않는다 (결정 2)', () => {
    it('0·0 레코드가 있어도 생성 0회', () => {
      const create = arrange({
        reflection: record({ visitCount: 0, photoCount: 0 }),
      });

      render(page(PAST_TODAY));

      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('AC-8 · 목록 조회가 실패하면 만들지 않는다', () => {
    it('조회 실패면 생성 0회, error 얼굴이고 pending 이 아니다', () => {
      const create = arrange({ isError: true });

      render(page(PAST_TODAY));

      expect(create).not.toHaveBeenCalled();
      expect(screen.getByTestId('reflection-daily-error')).toBeOnTheScreen();
      expect(screen.queryByTestId('reflection-daily-pending')).toBeNull();
    });
  });
});

describe('회고 카드 — 서버가 고른 card 를 그리고 { card } 로 저장한다(실물 훅)', () => {
  // TRIP-945 (옛 DailyReflectionPage.card.test.tsx)
  /**
   * TRIP-945 · j03 오늘의 회고 — 회고 계약 이전(narrative→card · text→card)을 사용자 흐름으로 잠근다.
   *
   * 무엇을 보장하나:
   *  - AC-1: 본문은 서버가 고른 `card.subtitle` 이다. 클라가 `editedCard ?? draftCard` 를 다시 고르지 않는다.
   *  - AC-3: 편집을 열면 입력칸 초기값도 `card.subtitle`(회고가 없으면 빈 칸).
   *  - AC-4·5: 고쳐 저장하면 PUT 바디는 `{ card }` 한 필드이고, 그 카드의 cover.title 이 비지 않는다.
   *  - AC-6: 규칙 카드를 그린 화면 어디에도 소요시간 표기가 없다(INV-3).
   *
   * 생성 훅 3개만 목하고 페이지·useDailyReflection·화면은 실물로 태운다 — 저장 버튼에서 PUT 바디까지 한 줄.
   */
  beforeEach(() => {
    (useDailyReflection as jest.Mock).mockImplementation(
      jest.requireActual<
        typeof import('@/features/reflection/model/useDailyReflection')
      >('@/features/reflection/model/useDailyReflection').useDailyReflection
    );
  });
  // 옛 파일의 trips 목 기본값 — 여행 조회가 "아직 없음"을 돌려준다(이 묶음은 trip 을 arrange 하지 않는다).
  beforeEach(() => {
    (useGetTripsTripId as jest.Mock).mockImplementation(() => ({
      data: undefined,
      isPending: false,
      isError: false,
    }));
  });

  const TRIP_ID = 'trip-1';

  const DAY = '2026-06-11';

  const RULE_TITLE = '광안리해수욕장 외 3곳';

  const RULE_SUBTITLE =
    '광안리해수욕장·부산시립미술관·해운대시장 외 1곳 을(를) 다녀왔어요. 이동 거리는 약 12.0km 였어요. 사진 6장을 남겼어요.';

  const RULE_SCENES = [
    '광안리해수욕장',
    '부산시립미술관',
    '해운대시장',
    '감천문화마을',
  ].map((name) => ({ layout: 'TEXT', caption: `${name} 을(를) 다녀왔어요.` }));

  const RULE_CARD: ReflectionCard = {
    templateId: 'backend.rule.daily.v1',
    format: 'CARD',
    title: RULE_TITLE,
    subtitle: RULE_SUBTITLE,
    payload: JSON.stringify({
      template_id: 'backend.rule.daily.v1',
      format: 'CARD',
      cover: { title: RULE_TITLE, subtitle: RULE_SUBTITLE },
      scenes: RULE_SCENES,
    }),
  };

  function withSubtitle(subtitle: string): ReflectionCard {
    return { ...RULE_CARD, subtitle };
  }

  /** card 와 제목·장면이 다른 카드 — 저장 바탕이 card 가 아니면 PUT 바디에 이 제목이 실린다. */
  function otherCard(title: string): ReflectionCard {
    return {
      ...RULE_CARD,
      title,
      subtitle: `${title} 문장`,
      payload: JSON.stringify({
        template_id: 'backend.rule.daily.v1',
        format: 'CARD',
        cover: { title, subtitle: `${title} 문장` },
        scenes: [],
      }),
    };
  }

  function reflection(over: Partial<Reflection> = {}): Reflection {
    return {
      dayDate: DAY,
      card: RULE_CARD,
      draftCard: withSubtitle('초안 D'),
      editedCard: null,
      source: 'RULE',
      stats: {
        visitCount: 4,
        distanceKm: 12,
        distanceSource: 'VISIT_LINE',
        photoCount: 6,
      },
      generatedAt: '2026-06-11T09:00:00Z',
      updatedAt: '2026-06-11T10:00:00Z',
      ...over,
    };
  }

  const put = jest.fn();

  function mockApi(items: Reflection[]) {
    (useGetTripsTripIdReflections as jest.Mock).mockReturnValue({
      data: { items },
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    });
    (usePostTripsTripIdReflectionsDayDate as jest.Mock).mockReturnValue({
      mutate: jest.fn(),
    });
    (usePutTripsTripIdReflectionsDayDate as jest.Mock).mockReturnValue({
      mutate: put,
    });
  }

  /** 훅이 캐시를 고치려고 useQueryClient() 를 불러도 렌더가 죽지 않게 Provider 로 감싼다(TRIP-980). */
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={new QueryClient()}>
        {children}
      </QueryClientProvider>
    );
  }

  function renderPage() {
    render(<DailyReflectionPage tripId={TRIP_ID} date={DAY} />, {
      wrapper: Wrapper,
    });
  }

  function saveEdit(text: string) {
    fireEvent.press(screen.getByTestId('reflection-daily-edit'));
    fireEvent.changeText(
      screen.getByTestId('reflection-daily-edit-input'),
      text
    );
    fireEvent.press(screen.getByTestId('reflection-daily-edit-save'));
  }

  /** put.mutate 첫 호출의 인자(= { tripId, dayDate, data }). */
  function putArgs() {
    return put.mock.calls[0][0];
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('AC-1 · 본문은 서버가 고른 card.subtitle 이다 (BR-U5-35)', () => {
    it('card.subtitle 을 본문 칸에 그대로 그린다', () => {
      mockApi([reflection()]);

      renderPage();

      expect(
        screen.getByTestId('reflection-daily-narrative')
      ).toHaveTextContent(RULE_SUBTITLE);
    });

    it('editedCard 가 card 와 달라도 card.subtitle 을 그린다(클라가 표시본을 다시 고르지 않는다)', () => {
      mockApi([reflection({ editedCard: withSubtitle('수정본 E') })]);

      renderPage();

      expect(
        screen.getByTestId('reflection-daily-narrative')
      ).toHaveTextContent(RULE_SUBTITLE);
    });
  });

  describe('AC-3 · 편집 입력칸의 초기값', () => {
    it('편집을 열면 card.subtitle 이 입력칸에 채워진다(editedCard ?? draftCard 를 다시 고르지 않는다)', () => {
      mockApi([reflection({ editedCard: withSubtitle('수정본 E') })]);
      renderPage();

      fireEvent.press(screen.getByTestId('reflection-daily-edit'));

      expect(
        screen.getByTestId('reflection-daily-edit-input')
      ).toHaveDisplayValue(RULE_SUBTITLE);
    });

    it('회고가 없는 지난 날은 생성 중(pending)에도 헤더 "편집"으로 빈 칸 입력을 연다 (TRIP-1068 Q2)', () => {
      mockApi([]);
      renderPage();
      // 전제 앵커 — 레코드 없는 지난 날(실시계 기준 06-11)은 이제 empty 가 아니라 생성 중이다.
      expect(screen.getByTestId('reflection-daily-pending')).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('reflection-daily-edit'));

      expect(
        screen.getByTestId('reflection-daily-edit-input')
      ).toHaveDisplayValue('');
    });
  });

  describe('AC-4 · 저장하면 PUT 바디는 { card } 한 필드다 (결정 2 · PBT-U5-F1)', () => {
    it('원래 카드에서 cover.subtitle 만 고친 카드 문자열을 보낸다(text 필드 없음)', () => {
      mockApi([reflection()]);
      renderPage();

      saveEdit('바다가 좋았다');

      expect(put).toHaveBeenCalledTimes(1);
      const { tripId, dayDate, data } = putArgs();
      expect(tripId).toBe(TRIP_ID);
      expect(dayDate).toBe(DAY);
      expect(Object.keys(data)).toEqual(['card']);
      const parsed = JSON.parse(data.card);
      expect(parsed.cover.subtitle).toBe('바다가 좋았다');
      expect(parsed.cover.title).toBe(RULE_TITLE);
      expect(parsed.scenes).toEqual(RULE_SCENES);
    });

    it('draftCard·editedCard 가 card 와 달라도 저장 바탕은 서버가 고른 card 다(클라가 다시 고르지 않는다)', () => {
      mockApi([
        reflection({
          draftCard: otherCard('초안 제목 D'),
          editedCard: otherCard('수정본 제목 E'),
        }),
      ]);
      renderPage();

      saveEdit('바다가 좋았다');

      const parsed = JSON.parse(putArgs().data.card);
      expect(parsed.cover.title).toBe(RULE_TITLE);
      expect(parsed.scenes).toEqual(RULE_SCENES);
    });
  });

  describe('AC-5 · 회고가 없는 날 직접 써서 저장해도 cover.title 이 채워진다 (BR-U5-36)', () => {
    it('사용자 글의 첫 줄을 제목으로 쓰고 template_id 는 보내지 않는다', () => {
      mockApi([]);
      renderPage();

      saveEdit('직접 쓴 하루\n둘째 줄');

      expect(put).toHaveBeenCalledTimes(1);
      const { data } = putArgs();
      expect(Object.keys(data)).toEqual(['card']);
      const parsed = JSON.parse(data.card);
      expect(parsed.cover.title).toBe('직접 쓴 하루');
      expect(parsed.cover.subtitle).toBe('직접 쓴 하루\n둘째 줄');
      expect(parsed).not.toHaveProperty('template_id');
    });
  });

  describe('AC-6 · 규칙 카드를 그린 화면에 소요시간 표기가 없다 (INV-3)', () => {
    it('화면 전체 글자에 소요·N분·N시간이 없고, 거리 문장은 있다', () => {
      mockApi([reflection()]);

      renderPage();

      expect(screen.root).not.toHaveTextContent(DURATION_TEXT);
      // 긍정 짝 — 규칙 카드 문장이 실제로 그려졌다(빈 화면이라 통과하는 게 아니다).
      expect(screen.root).toHaveTextContent(/12\.0km/);
    });
  });
});

describe('지도 자리 사유 — 위치 권한은 조회만', () => {
  // TRIP-1118 (옛 DailyReflectionPage.mapReason.test.tsx)
  /**
   * TRIP-1118 · j03 지도 자리 사유 — 페이지가 단말 위치 권한을 **조회만** 해서 이유별 사유를 고른다.
   *
   * 무엇을 보장하나:
   *  - AC-1: 권한 허용 · 방문 1곳이면 지도 자리 어디에도 "미동의"가 없다(QA 5회차 #22 실례, INV-4).
   *  - AC-2: 방문 ≤1 이면 권한이 거부여도 few-visits, 거리는 "—".
   *  - AC-3·4·5: 방문 ≥2 에서 거부 → permission / 허용 → no-route / 모름(throw·undetermined·결과 없음) → no-route.
   *  - AC-7: 권한이 도착한 뒤에도 얼굴 진리표는 그대로(방문 2·사진 1 = default, 박스 없음).
   *  - AC-8·9: 세 사유 어느 것도 소요시간 표기가 없고, 사진 0장이면 "사진 없음" 자리는 그대로.
   *  - AC-10: 권한을 다시 묻지 않는다(request 0회, 조회는 1회 이상).
   *
   * ★ 권한은 비동기로 도착하고 첫 렌더는 늘 "모름"이다 — 도착을 기다리지 않고 단언하면 허용을 거부로
   *   잘못 접는 구현도 첫 렌더 결과로 통과한다. 그래서 모든 단언은 `settlePermission()` 또는
   *   `findByTestId` 뒤에 둔다(02a ★1).
   * ★ expo-location 목은 이 파일에만 건다 — 다른 페이지 테스트는 jest-expo 기본 목(결과 undefined =
   *   모름)으로 돈다(TripRecordsPage.integration 수동 체크인 묶음 선례).
   */

  const TRIP_ID = 'trip-1118';

  const DAY = '2026-09-24';

  const ROOT = 'reflection-daily-map-notice';

  const leaf = (reason: Reason) => `${ROOT}-reason-${reason}`;

  type Reason = 'few-visits' | 'permission' | 'no-route';

  type PermissionKind =
    'granted' | 'denied' | 'undetermined' | 'throw' | 'undefined';

  // getForegroundPermissionsAsync 응답(LocationPermissionResponse 부분집합).
  const RESPONSES = {
    granted: { status: 'granted', granted: true, canAskAgain: true },
    denied: { status: 'denied', granted: false, canAskAgain: false },
    // granted:false 지만 "거부"가 아니다 — 한 번도 묻지 않은 상태 = 모름(Seed Q3).
    undetermined: { status: 'undetermined', granted: false, canAskAgain: true },
  } as const;

  function permission(kind: PermissionKind): void {
    if (kind === 'throw')
      mockGetForeground.mockRejectedValue(new Error('권한 조회 실패'));
    else if (kind === 'undefined')
      mockGetForeground.mockResolvedValue(undefined);
    else mockGetForeground.mockResolvedValue(RESPONSES[kind]);
  }

  function record(
    stats: Pick<ReflectionStats, 'visitCount' | 'photoCount'>
  ): Reflection {
    return {
      dayDate: DAY,
      card: card('서버가 고른 하루'),
      draftCard: card('서버가 고른 하루'),
      editedCard: null,
      source: 'RULE',
      stats: { distanceKm: 3, distanceSource: 'VISIT_LINE', ...stats },
      generatedAt: '2026-09-24T12:00:00Z',
      updatedAt: '2026-09-24T12:00:00Z',
    };
  }

  /** 그 날 레코드가 있는 상태로 훅 2개를 세팅한다(위 얼굴 묶음 선례). */
  function arrange(visitCount: number, photoCount: number): void {
    (useGetTripsTripId as jest.Mock).mockReturnValue({
      data: { tripId: TRIP_ID, startDate: '2026-09-24', endDate: '2026-09-25' },
      isPending: false,
      isError: false,
    });
    (useDailyReflection as jest.Mock).mockReturnValue({
      reflection: record({ visitCount, photoCount }),
      isPending: false,
      isError: false,
      refetch: jest.fn(),
      create: jest.fn(),
      saveEdit: jest.fn(),
    });
  }

  function renderPage(): void {
    render(
      <DailyReflectionPage tripId={TRIP_ID} date={DAY} today={PAST_TODAY} />
    );
  }

  /** 권한 조회가 불렸고 그 결과(resolve·reject)가 상태에 반영될 때까지 흘려보낸다(02a §5 실측). */
  async function settlePermission(): Promise<void> {
    await waitFor(() => expect(mockGetForeground).toHaveBeenCalled());
    await act(async () => {});
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetForeground.mockReset();
    mockRequestForeground.mockReset();
  });

  describe('🔴 AC-1 · 권한 허용 · 방문 1곳이면 "미동의"가 없다 (INV-4 · QA 실례)', () => {
    it('지도 자리는 그려지고, 그 글자 어디에도 "미동의"가 없으며 사유는 few-visits 다', async () => {
      permission('granted');
      arrange(1, 0);

      renderPage();
      await settlePermission();

      const box = screen.getByTestId(ROOT);
      expect(box).not.toHaveTextContent(/미동의/);
      expect(screen.getByTestId(leaf('few-visits'))).toBeOnTheScreen();
    });
  });

  describe('🔴 AC-2 · 방문 ≤1 이면 권한이 거부여도 few-visits, 거리 "—" (BR-U5-34)', () => {
    it.each([
      [0, 1],
      [1, 0],
    ])(
      '방문 %i · 사진 %i · 거부 → few-visits, 권한 사유 없음, 거리 "—"',
      async (visitCount, photoCount) => {
        permission('denied');
        arrange(visitCount, photoCount);

        renderPage();
        await settlePermission();

        expect(screen.getByTestId(leaf('few-visits'))).toBeOnTheScreen();
        expect(screen.queryByTestId(leaf('permission'))).toBeNull();
        expect(
          within(screen.getByTestId('reflection-daily-stats')).getByText('—')
        ).toBeOnTheScreen();
      }
    );
  });

  describe('🔴 AC-3 · 방문 ≥2 · 단말 권한 거부 → permission', () => {
    it('거부가 도착하면 권한 사유가 보이고 동선 미지원 사유는 사라진다', async () => {
      permission('denied');
      arrange(2, 0);

      renderPage();

      expect(await screen.findByTestId(leaf('permission'))).toBeOnTheScreen();
      expect(screen.queryByTestId(leaf('no-route'))).toBeNull();
    });
  });

  describe('🔴 AC-4 · 방문 ≥2 · 권한 허용 → no-route (BR-U5-55)', () => {
    it('동선 미지원 사유가 보이고, 옛 일반 문구·권한 사유는 없다', async () => {
      permission('granted');
      arrange(2, 0);

      renderPage();
      await settlePermission();

      expect(screen.getByTestId(leaf('no-route'))).toBeOnTheScreen();
      expect(screen.queryByText('위치 정보를 표시할 수 없어요')).toBeNull();
      expect(screen.queryByTestId(leaf('permission'))).toBeNull();
    });
  });

  describe('🔴 AC-5 · 권한을 모르면 권한 사유를 쓰지 않는다 → no-route', () => {
    it.each<PermissionKind>(['throw', 'undetermined', 'undefined'])(
      '권한 조회 %s → no-route, 권한 사유 없음',
      async (kind) => {
        permission(kind);
        arrange(3, 0);

        renderPage();
        await settlePermission();

        expect(screen.getByTestId(leaf('no-route'))).toBeOnTheScreen();
        expect(screen.queryByTestId(leaf('permission'))).toBeNull();
      }
    );
  });

  describe('🔴 AC-7 · 권한이 도착해도 얼굴 진리표는 그대로 (TRIP-935 R7)', () => {
    it.each<PermissionKind>(['denied', 'granted'])(
      '방문 2 · 사진 1 · %s → default(서술 "수정" 링크) 이고 지도 자리 박스는 없다',
      async (kind) => {
        permission(kind);
        arrange(2, 1);

        renderPage();
        await settlePermission();

        expect(
          screen.getByTestId('reflection-daily-narrative-edit')
        ).toBeOnTheScreen();
        expect(screen.queryByTestId(ROOT)).toBeNull();
      }
    );

    it('방문 1 · 사진 5 · 거부 → data-insufficient("수정" 링크 없음) 이고 사유는 few-visits', async () => {
      permission('denied');
      arrange(1, 5);

      renderPage();
      await settlePermission();

      expect(
        screen.queryByTestId('reflection-daily-narrative-edit')
      ).toBeNull();
      expect(screen.getByTestId(leaf('few-visits'))).toBeOnTheScreen();
    });
  });

  /** 세 사유를 각각 만드는 조합(사진 0 = data-insufficient 얼굴이라 박스가 보인다). */
  const REASON_CASES: [Reason, number, PermissionKind][] = [
    ['few-visits', 1, 'granted'],
    ['permission', 2, 'denied'],
    ['no-route', 2, 'granted'],
  ];

  describe('🔴 AC-8 · 어느 사유든 지도 자리에 소요시간 표기가 없다 (INV-3)', () => {
    it.each(REASON_CASES)(
      '%s 사유(방문 %i · %s) 박스 글자에 소요시간 패턴이 없다',
      async (reason, visitCount, kind) => {
        permission(kind);
        arrange(visitCount, 0);

        renderPage();

        // 앵커 — 그 사유가 실제로 그려졌다(빈 박스라 통과하는 게 아니다).
        expect(await screen.findByTestId(leaf(reason))).toBeOnTheScreen();
        expect(screen.getByTestId(ROOT)).not.toHaveTextContent(DURATION_TEXT);
      }
    );
  });

  describe('🔴 AC-9 · 사진 0장이면 "사진 없음" 자리는 그대로 (hidePhotoGrid 무회귀)', () => {
    it.each(REASON_CASES)(
      '%s 사유(방문 %i · %s)에서도 reflection-daily-photo-empty 가 있다',
      async (reason, visitCount, kind) => {
        permission(kind);
        arrange(visitCount, 0);

        renderPage();

        expect(await screen.findByTestId(leaf(reason))).toBeOnTheScreen();
        expect(
          screen.getByTestId('reflection-daily-photo-empty')
        ).toBeOnTheScreen();
      }
    );
  });

  describe('🔴 AC-10 · 권한은 조회만 하고 다시 묻지 않는다 (결정1)', () => {
    it.each<PermissionKind>(['granted', 'denied'])(
      '%s: 조회(getForegroundPermissionsAsync)는 불리고, 요청(requestForegroundPermissionsAsync)은 0회',
      async (kind) => {
        permission(kind);
        arrange(2, 0);

        renderPage();
        await settlePermission();

        // 앵커 — 권한을 실제로 읽었다(아예 안 읽어서 요청 0회인 게 아니다).
        expect(mockGetForeground).toHaveBeenCalled();
        expect(mockRequestForeground).not.toHaveBeenCalled();
      }
    );
  });
});

describe('"오늘" 칩·지난 날 문구 — KST 실제 오늘', () => {
  // TRIP-980 (옛 DailyReflectionPage.today.test.tsx)
  /**
   * TRIP-980 · j03 회고 — "오늘" 칩과 헤더·empty 문구는 **KST 실제 오늘**로 정한다(사용자 확정 D1·D2).
   *
   * 무엇을 보장하나:
   *  - AC-5: `오늘` 접두는 날짜가 KST 오늘인 일차 탭에만 붙는다. 보고 있는 탭(활성)과 오늘 탭은 따로 정해진다.
   *    today prop 을 안 주면 시계를 KST 로 읽는다(UTC 아님).
   *  - AC-6: 보고 있는 날짜가 오늘이 아니면 헤더 "하루 회고", empty 문구 "이 날 기록된 활동이 없습니다".
   *    오늘이면 기존 "오늘의 회고" / "오늘 기록된 활동이 없습니다".
   *  - AC-7: 지난 날 화면에도 소요시간 표기가 없다(INV-3).
   *  - TRIP-1068 전제: 레코드가 없는 지난 날·오늘은 이제 생성 대상(pending)이라 empty 가 아니다. empty 는
   *    방문 0·사진 0 레코드(결정 3)로 세운다. 일차 탭(AC-5)은 pending 에서도 남는 공통 크롬이라 레코드 없음
   *    그대로 둔다.
   *
   * 페이지와 화면은 실물, 데이터 훅 2개(`useDailyReflection`·`useGetTripsTripId`)만 목한다 — 이 파일은
   * "페이지가 날짜를 비교해 화면에 무엇을 넘기나"만 보고, 네트워크·캐시는 save.integration 이 본다.
   * 여행은 09-24~09-25(탭 2개), 보고 있는 날짜는 늘 09-24(1일차 = 활성).
   */

  const TRIP_ID = 'trip-980';

  const VIEWING = '2026-09-24';

  const BASIC_SUBTITLE = '기록이 없는 하루';

  /** 방문 0·사진 0 레코드 — 얼굴은 empty(TRIP-1068 결정 3). */
  const BASIC_RECORD: Reflection = {
    dayDate: VIEWING,
    card: {
      templateId: 'backend.basic.daily.v1',
      format: 'CARD',
      title: BASIC_SUBTITLE,
      subtitle: BASIC_SUBTITLE,
      payload: JSON.stringify({
        cover: { title: BASIC_SUBTITLE, subtitle: BASIC_SUBTITLE },
      }),
    },
    draftCard: {
      templateId: 'backend.basic.daily.v1',
      format: 'CARD',
      title: BASIC_SUBTITLE,
      subtitle: BASIC_SUBTITLE,
      payload: JSON.stringify({
        cover: { title: BASIC_SUBTITLE, subtitle: BASIC_SUBTITLE },
      }),
    },
    editedCard: null,
    source: 'BASIC',
    stats: {
      visitCount: 0,
      distanceKm: 0,
      distanceSource: 'VISIT_LINE',
      photoCount: 0,
    },
    generatedAt: '2026-09-24T12:00:00Z',
    updatedAt: '2026-09-24T12:00:00Z',
  };

  /** 방문 1·사진 0 레코드 — 얼굴은 data-insufficient(본문이 그려진다). */
  const VISITED_RECORD: Reflection = {
    ...BASIC_RECORD,
    stats: { ...BASIC_RECORD.stats, visitCount: 1 },
  };

  function arrange(reflection: Reflection | undefined) {
    (useGetTripsTripId as jest.Mock).mockReturnValue({
      data: { tripId: TRIP_ID, startDate: '2026-09-24', endDate: '2026-09-25' },
      isPending: false,
      isError: false,
    });
    (useDailyReflection as jest.Mock).mockReturnValue({
      reflection,
      isPending: false,
      isError: false,
      refetch: jest.fn(),
      create: jest.fn(),
      saveEdit: jest.fn(),
    });
  }

  function renderPage(today?: string) {
    render(
      <DailyReflectionPage tripId={TRIP_ID} date={VIEWING} today={today} />
    );
  }

  function tab(day: number) {
    return screen.getByTestId(`reflection-daily-day-tab-${day}`);
  }

  function isSelected(day: number): boolean {
    return tab(day).props.accessibilityState?.selected === true;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('AC-5 · "오늘" 칩은 KST 실제 오늘인 일차에만 붙는다 (D1)', () => {
    it('여행이 끝난 뒤(오늘 09-26) 09-24 를 보면 어느 탭에도 "오늘"이 없고, 1일차는 그대로 활성이다', () => {
      arrange(undefined);

      renderPage('2026-09-26');

      expect(tab(1)).toHaveTextContent('1일차');
      expect(tab(2)).toHaveTextContent('2일차');
      expect(isSelected(1)).toBe(true);
    });

    it('오늘이 09-25 이고 09-24 를 보면 활성은 1일차, "오늘"은 2일차에만 붙는다(활성과 오늘은 따로)', () => {
      arrange(undefined);

      renderPage('2026-09-25');

      expect(isSelected(1)).toBe(true);
      expect(tab(1)).toHaveTextContent('1일차');
      expect(isSelected(2)).toBe(false);
      expect(tab(2)).toHaveTextContent(/오늘/);
      expect(tab(2)).toHaveTextContent(/2일차/);
    });

    it('보고 있는 날이 오늘이면 그 활성 탭에 "오늘"이 붙는다(짝)', () => {
      arrange(undefined);

      renderPage('2026-09-24');

      expect(isSelected(1)).toBe(true);
      expect(tab(1)).toHaveTextContent(/오늘/);
      expect(tab(1)).toHaveTextContent(/1일차/);
      expect(tab(2)).toHaveTextContent('2일차');
    });

    it('today 를 안 주면 기기 시계를 KST 로 읽는다 — UTC 09-24 15:30 은 KST 09-25 라 2일차가 오늘이다', () => {
      jest.useFakeTimers({ now: new Date('2026-09-24T15:30:00Z') });
      // 앵커 — 가짜 시계가 실제로 KST 09-25 를 만든다(UTC 로는 아직 09-24).
      expect(seoulDate(new Date())).toBe('2026-09-25');
      arrange(undefined);

      renderPage();

      expect(tab(2)).toHaveTextContent(/오늘/);
      expect(tab(1)).toHaveTextContent('1일차');
    });
  });

  describe('AC-6 · 지난 날 헤더·empty 문구는 중립이다 (D2)', () => {
    it('지난 날 empty 얼굴(0·0 레코드)은 헤더 "하루 회고", 문구 "이 날 기록된 활동이 없습니다"다', () => {
      arrange(BASIC_RECORD);

      renderPage('2026-09-26');

      expect(screen.getByText('하루 회고')).toBeOnTheScreen();
      expect(screen.queryByText('오늘의 회고')).toBeNull();
      expect(screen.getByTestId('reflection-daily-empty')).toHaveTextContent(
        '이 날 기록된 활동이 없습니다'
      );
    });

    it('지난 날 data 얼굴도 헤더가 "하루 회고"다', () => {
      arrange(VISITED_RECORD);

      renderPage('2026-09-26');

      expect(screen.getByText('하루 회고')).toBeOnTheScreen();
      expect(screen.queryByText('오늘의 회고')).toBeNull();
    });

    it('보고 있는 날이 오늘이면(0·0 레코드) "오늘의 회고" / "오늘 기록된 활동이 없습니다"를 유지한다(짝)', () => {
      arrange(BASIC_RECORD);

      renderPage('2026-09-24');

      expect(screen.getByText('오늘의 회고')).toBeOnTheScreen();
      expect(screen.queryByText('하루 회고')).toBeNull();
      expect(screen.getByTestId('reflection-daily-empty')).toHaveTextContent(
        '오늘 기록된 활동이 없습니다'
      );
    });
  });

  describe('AC-7 · 지난 날 화면에 소요시간 표기가 없다 (INV-3)', () => {
    it('지난 날 data 얼굴 전체 글자에 소요·N분·N시간이 없고, 본문은 그려진다', () => {
      arrange(VISITED_RECORD);

      renderPage('2026-09-26');

      expect(screen.root).not.toHaveTextContent(DURATION_TEXT);
      expect(
        screen.getByTestId('reflection-daily-narrative')
      ).toHaveTextContent(BASIC_SUBTITLE);
    });
  });
});

describe('‹ 와 「확인」 — 히스토리 없으면 기록 탭', () => {
  // TRIP-1119 (옛 DailyReflectionPage.back.test.tsx)
  /**
   * TRIP-1119 · j03 오늘의 회고 — 페이지가 ‹ 와 「확인」을 어디로 보내나.
   *
   * 무엇을 보장하나:
   *  - AC1: 히스토리가 있으면(`canGoBack()`=true) ‹ 는 `router.back()` 1회.
   *  - AC2: 히스토리가 없으면(푸시 딥링크 콜드 스타트) ‹ 는 기록 탭 `replace('/(tabs)/records')` 1회 —
   *    아무것도 안 부르면 침묵 실패(INV-4). error 얼굴에서도 ‹ 는 재시도가 아니라 나가기다.
   *  - AC6(결정 1): data 얼굴 「확인」도 같은 폴백. 히스토리가 있으면 예전처럼 back, error 얼굴의
   *    "다시 시도"는 이동 없이 재조회 그대로(경계).
   *
   * 훅 2개와 expo-router 만 목하고 화면은 실물로 태운다(`.faces.test.tsx` 동형).
   * ★ `jest.clearAllMocks()` 는 `mockReturnValue` 를 지우지 않는다 — 그래서 모든 케이스가 `arrange` 에서
   *   `canGoBack` 반환값을 직접 정한다(앞 케이스의 false 가 새지 않게).
   */

  const TRIP_ID = 'trip-1119';

  const DAY = '2026-09-24';

  const RECORDS_TAB = '/(tabs)/records';

  type PageFace =
    'default' | 'data-insufficient' | 'empty' | 'error' | 'pending';

  function record(
    stats: Pick<ReflectionStats, 'visitCount' | 'photoCount'>
  ): Reflection {
    return {
      dayDate: DAY,
      card: card('서버가 고른 하루'),
      draftCard: card('서버가 고른 하루'),
      editedCard: null,
      source: 'RULE',
      stats: { distanceKm: 3, distanceSource: 'VISIT_LINE', ...stats },
      generatedAt: '2026-09-24T12:00:00Z',
      updatedAt: '2026-09-24T12:00:00Z',
    };
  }

  /** 얼굴별 훅 응답(`.faces.test.tsx` 에서 각 얼굴이 나오는 것으로 확인된 입력). */
  const HOOK_FOR_FACE: Record<
    PageFace,
    { reflection?: Reflection; isPending: boolean; isError: boolean }
  > = {
    default: {
      reflection: record({ visitCount: 2, photoCount: 1 }),
      isPending: false,
      isError: false,
    },
    'data-insufficient': {
      reflection: record({ visitCount: 1, photoCount: 0 }),
      isPending: false,
      isError: false,
    },
    empty: {
      reflection: record({ visitCount: 0, photoCount: 0 }),
      isPending: false,
      isError: false,
    },
    error: { reflection: undefined, isPending: false, isError: true },
    pending: { reflection: undefined, isPending: true, isError: false },
  };

  /** 훅·router 목을 세팅하고 `refetch` 목을 돌려준다. `canGoBack` 은 매번 명시(★). */
  function arrange(face: PageFace, canGoBack: boolean): jest.Mock {
    const refetch = jest.fn();
    (router.canGoBack as jest.Mock).mockReturnValue(canGoBack);
    (useGetTripsTripId as jest.Mock).mockReturnValue({
      data: { tripId: TRIP_ID, startDate: '2026-09-24', endDate: '2026-09-25' },
      isPending: false,
      isError: false,
    });
    (useDailyReflection as jest.Mock).mockReturnValue({
      ...HOOK_FOR_FACE[face],
      refetch,
      create: jest.fn(),
      saveEdit: jest.fn(),
    });
    return refetch;
  }

  function renderPage() {
    render(
      <DailyReflectionPage tripId={TRIP_ID} date={DAY} today={PAST_TODAY} />
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const LEAVE_FACES: PageFace[] = [
    'default',
    'data-insufficient',
    'empty',
    'pending',
  ];

  describe('AC1 · 히스토리가 있으면 ‹ 는 이전 화면으로 돌아간다', () => {
    it.each(LEAVE_FACES)(
      '%s: canGoBack()=true 에서 ‹ → router.back() 1회, replace 0회',
      (face) => {
        arrange(face, true);
        renderPage();

        fireEvent.press(screen.getByTestId('reflection-daily-back'));

        expect(router.back).toHaveBeenCalledTimes(1);
        expect(router.replace).not.toHaveBeenCalled();
      }
    );
  });

  describe('AC2 · 히스토리가 없으면 ‹ 는 기록 탭으로 간다 (INV-4 · 딥링크 콜드 스타트)', () => {
    it.each(LEAVE_FACES)(
      "%s: canGoBack()=false 에서 ‹ → replace('/(tabs)/records') 1회, back 0회",
      (face) => {
        arrange(face, false);
        renderPage();

        fireEvent.press(screen.getByTestId('reflection-daily-back'));

        expect(router.replace).toHaveBeenCalledTimes(1);
        expect(router.replace).toHaveBeenCalledWith(RECORDS_TAB);
        expect(router.back).not.toHaveBeenCalled();
      }
    );

    it('error 얼굴에서도 ‹ 는 재시도가 아니라 기록 탭으로 나간다', () => {
      const refetch = arrange('error', false);
      renderPage();

      fireEvent.press(screen.getByTestId('reflection-daily-back'));

      expect(router.replace).toHaveBeenCalledWith(RECORDS_TAB);
      expect(refetch).not.toHaveBeenCalled();
    });
  });

  describe('AC6 · data 얼굴 「확인」도 같은 폴백을 탄다 (결정 1)', () => {
    it.each<PageFace>(['default', 'data-insufficient'])(
      "%s: 히스토리 없이 「확인」 → replace('/(tabs)/records') 1회, back 0회",
      (face) => {
        arrange(face, false);
        renderPage();

        fireEvent.press(screen.getByTestId('reflection-daily-confirm'));

        expect(router.replace).toHaveBeenCalledTimes(1);
        expect(router.replace).toHaveBeenCalledWith(RECORDS_TAB);
        expect(router.back).not.toHaveBeenCalled();
      }
    );

    it.each<PageFace>(['default', 'data-insufficient'])(
      '%s: 히스토리가 있으면 「확인」 → back 1회, replace 0회 (무회귀)',
      (face) => {
        arrange(face, true);
        renderPage();

        fireEvent.press(screen.getByTestId('reflection-daily-confirm'));

        expect(router.back).toHaveBeenCalledTimes(1);
        expect(router.replace).not.toHaveBeenCalled();
      }
    );

    it('error 얼굴 "다시 시도"는 히스토리가 없어도 이동 없이 재조회 1회다 (경계)', () => {
      const refetch = arrange('error', false);
      renderPage();

      fireEvent.press(screen.getByTestId('reflection-daily-retry'));

      expect(refetch).toHaveBeenCalledTimes(1);
      expect(router.replace).not.toHaveBeenCalled();
      expect(router.back).not.toHaveBeenCalled();
    });
  });
});

describe('공유 배선 없음', () => {
  // TRIP-762 AC-11 (옛 DailyReflectionPage.share.test.tsx)
  /**
   * TRIP-762 · AC-11 — j03 오늘의 회고 헤더 **공유 게이트·배선 제거**(구 TRIP-574 공유 게이트 폐기).
   *
   * 라이브 j03 에 공유가 0 이라, 페이지가 `useGetTripsTripId(...).status==='ENDED'` 로 공유를
   * 판정해 화면에 `canShare`/`onShare` 로 내리던 배선을 **제거**한다. 화면을 감싼 jest.fn 으로
   * 페이지가 넘기는 props 를 본다(화면 자체는 실물로 그려진다 — 파일 머리 목 설명).
   *
   * 무엇을 보장하나(승인 계약):
   *  - 🔴 페이지가 화면에 `onShare` 를 넘기지 않는다(공유 배선 제거 — 현행은 함수를 넘기므로 red).
   *  - 🔴 페이지가 화면에 `canShare` 를 넘기지 않는다(status 게이트 제거).
   *  - 긍정 짝 — 화면은 여전히 배선된다(narrative 등 완성 VM 이 넘어온다 — 페이지가 안 깨졌다는 앵커).
   *
   * (개념) 화면을 감싼 `jest.fn` → `mock.calls[0][0]` 이 전달 props · `toBeUndefined()` = 그
   *   prop 자체가 안 넘어왔음을 단언(공유 배선 부재).
   */
  // 옛 파일의 trips 목 기본값 — 여행 조회가 "아직 없음"을 돌려준다(이 묶음은 trip 을 arrange 하지 않는다).
  beforeEach(() => {
    (useGetTripsTripId as jest.Mock).mockImplementation(() => ({
      data: undefined,
      isPending: false,
      isError: false,
    }));
  });

  function mockDaily() {
    (useDailyReflection as jest.Mock).mockReturnValue({
      reflection: undefined,
      isPending: false,
      isError: false,
      refetch: jest.fn(),
      create: jest.fn(),
      saveEdit: jest.fn(),
    });
  }

  function capturedProps() {
    return (DailyReflectionScreen as unknown as jest.Mock).mock.calls[0][0];
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('🔴 AC-11 · 페이지가 공유를 화면에 배선하지 않는다(게이트 제거)', () => {
    it('onShare·canShare 를 넘기지 않고, 화면은 여전히 배선된다', () => {
      mockDaily();

      render(<DailyReflectionPage tripId="trip-1" date="2026-06-11" />);

      const props = capturedProps();
      // 부정 — 공유 배선 제거.
      expect(props.onShare).toBeUndefined();
      expect(props.canShare).toBeUndefined();
      // 긍정 짝 — 화면은 완성 VM 으로 배선된다(페이지가 안 깨졌다).
      expect(props.narrative).toBeDefined();
    });
  });
});
