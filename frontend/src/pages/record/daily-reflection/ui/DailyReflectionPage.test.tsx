import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { router } from 'expo-router';

import { basicNarrative } from '../model/reflectionFallback';
import { statsCard } from '../model/statsCard';
import { useDailyReflection } from '../model/useDailyReflection';
import type {
  Reflection,
  ReflectionCard,
  ReflectionStats,
} from '@/shared/api/index.schemas';
import { useGetTripsTripId } from '@/shared/api/index.hooks';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import { seoulDate } from '@/shared/lib/seoulDate';
import { shellTabHref } from '@/shared/ui/BottomTabBar';
import {
  flushOsAnswer,
  holdReduceMotionOn,
} from '@/test-support/barMotionProbe';

import { DailyReflectionPage } from './DailyReflectionPage';

/**
 * j03 오늘의 회고 페이지 — 훅(`useDailyReflection`·여행 조회)을 목으로 갈아 끼워 **페이지 배선만** 본다(node 버킷).
 * 실제 HTTP 로 보는 흐름(생성·저장·회고 카드 title/scenes·pending/error/미래 날짜의 POST 횟수)은
 * `DailyReflectionPage.integration.test.tsx`(msw)가 정본이다 — 옛 hookMock 의 「회고 카드」·「공유 배선 없음」
 * 묶음과 「얼굴」의 AC-4 ①③·AC-6·7·8 은 뮤테이션 확인 뒤 지웠다(TRIP-1354). 여기는 훅 목이어야 한 렌더로 박을 수 있는
 * 관점만 남는다: 서버 stats 별 얼굴 표, 미치환 템플릿, pending 크롬, 마운트당 한 번 생성, 지도 자리 사유,
 * 오늘 칩, 뒤로 폴백(하단 바 뒤로 — TRIP-1584 에서 헤더 ‹ 를 대체), 하단 바 기록 칸.
 *
 *  - `useDailyReflection`: 빈 jest.fn(각 테스트가 mockReturnValue 로 답을 정한다).
 *  - 위치 권한(`expo-location`): 기본은 값 없음(undefined) → 페이지가 "모름"으로 둔다. 지도 사유 묶음만 granted/denied 를 정한다.
 *  - 매 테스트 뒤 최상위 afterEach 가 이 값들을 되돌린다. (개념) `jest.clearAllMocks()` 는 호출 기록만 지우고
 *    `mockReturnValue` 는 남긴다 — 앞 describe 의 답이 뒤 describe 로 새지 않게 `mockReset()` 으로 지운다.
 */

jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    router: ['push', 'replace', 'back', 'dismissTo', 'canGoBack'],
  })
);

jest.mock('../model/useDailyReflection', () => ({
  useDailyReflection: jest.fn(),
}));

jest.mock('../model/useReflectionPhotos', () => ({
  useReflectionPhotos: jest.fn(() => []),
}));

// TRIP-1584 — 하단 바가 `useTripSummary` 를 읽는다. 이 파일엔 QueryClient 가 없어 스텁(조회 중)으로 막는다.
jest.mock('@/features/reflection/model/useTripSummary', () => ({
  useTripSummary: jest.fn(() => ({
    envelope: undefined,
    summary: undefined,
    source: undefined,
    isPending: true,
    isError: false,
    refetch: jest.fn(),
  })),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTripsTripId: jest.fn(),
}));

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...args: unknown[]) =>
    mockGetForeground(...args),
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForeground(...args),
}));

const PAST_TODAY = '2026-09-26';
const BAR = 'reflection-daily-bottom-bar';
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

  // TRIP-1425 · Q-111 — 옛 계약(여행 전체 지역·기간으로 치환)을 뒤집었다: 템플릿뿐이면 stats 문장, 섞이면 그날 값.
  describe('TRIP-1212 · TRIP-1425 · 회고 표지 템플릿 — 템플릿뿐이면 stats 문장, 섞이면 그날 값', () => {
    const TEMPLATE = '{region} · {start_date}~{end_date}';

    /** 여행 조회 목을 덮는다(arrange 의 기본 여행 뒤에 부른다). */
    function tripWith(over: Record<string, unknown>) {
      (useGetTripsTripId as jest.Mock).mockReturnValue({
        data: {
          tripId: TRIP_ID,
          startDate: '2026-09-24',
          endDate: '2026-09-25',
          destinations: [{ seq: 1, region: '부산', nights: 1 }],
          ...over,
        },
        isPending: false,
        isError: false,
      });
    }

    it('템플릿뿐이면 본문은 stats 문장이고 편집 시드는 빈칸이다 — 여행 끝 날짜·기간·중괄호가 없다 (AC-1·AC-2)', () => {
      const stats: ReflectionStats = {
        visitCount: 2,
        photoCount: 1,
        distanceKm: 3,
        distanceSource: 'VISIT_LINE',
      };
      arrange({ reflection: record(stats, { card: card(TEMPLATE) }) });
      tripWith({});

      render(page(PAST_TODAY));

      const body = screen.getByTestId('reflection-daily-narrative');
      expect(body).toHaveTextContent(basicNarrative(statsCard(stats)));
      expect(body).not.toHaveTextContent(/2026-09-25/);
      expect(body).not.toHaveTextContent(/\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}/);
      expect(body).not.toHaveTextContent(/[{}]/);
      fireEvent.press(screen.getByTestId('reflection-daily-narrative-edit'));
      expect(
        screen.getByTestId('reflection-daily-edit-input').props.value
      ).toBe('');
    });

    it('여행 정보가 없어도 템플릿뿐이면 중괄호 없는 stats 문장이다(빈 본문 아님)', () => {
      arrange({
        reflection: record(
          { visitCount: 2, photoCount: 1 },
          { card: card(TEMPLATE) }
        ),
      });
      (useGetTripsTripId as jest.Mock).mockReturnValue({
        data: undefined,
        isPending: true,
        isError: false,
      });

      render(page(PAST_TODAY));

      const text = screen.getByTestId('reflection-daily-narrative');
      expect(text).not.toHaveTextContent(/[{}]/);
      expect(text).toHaveTextContent(/방문 2곳/);
    });

    it('섞인 문장은 그날 지역·그날 날짜로 채운다 — 2일차는 제주·09-25 (AC-3 · BR-U5-27·31)', () => {
      // 2일차로 재야 "첫 여행지"·"여행 시작일"을 쓰는 구현이 갈린다(02a ★4).
      arrange({
        reflection: record(
          { visitCount: 2, photoCount: 1 },
          { card: card('{region}에서 보낸 {start_date}') }
        ),
      });
      tripWith({
        endDate: '2026-09-26',
        destinations: [
          { seq: 1, region: '부산', nights: 1 },
          { seq: 2, region: '제주', nights: 2 },
        ],
      });

      render(
        <DailyReflectionPage
          tripId={TRIP_ID}
          date="2026-09-25"
          today={PAST_TODAY}
        />
      );

      expect(
        screen.getByTestId('reflection-daily-narrative')
      ).toHaveTextContent('제주에서 보낸 2026-09-25');
      fireEvent.press(screen.getByTestId('reflection-daily-narrative-edit'));
      expect(
        screen.getByTestId('reflection-daily-edit-input').props.value
      ).toBe('제주에서 보낸 2026-09-25');
    });

    it('{visit_count}·{photo_count} 는 기록된 stats 로 채우고, 채울 수 없는 {poi:…} 문장은 빠진다 — 깨진 문장 없음 (TRIP-1497)', () => {
      arrange({
        reflection: record(
          { visitCount: 3, photoCount: 2 },
          {
            card: card(
              '오늘 {visit_count}곳을 다녀왔어요. {poi:1.name}에서 사진 {photo_count}장을 남겼어요.'
            ),
          }
        ),
      });
      tripWith({});

      render(page(PAST_TODAY));

      const body = screen.getByTestId('reflection-daily-narrative');
      expect(body).toHaveTextContent('오늘 3곳을 다녀왔어요.');
      expect(body).not.toHaveTextContent(/[{}]/);
      expect(body).not.toHaveTextContent('남겼어요');
    });

    it('섞인 문장의 {start_date}~{end_date} 는 그날 날짜 한 번이다 (AC-4)', () => {
      arrange({
        reflection: record(
          { visitCount: 2, photoCount: 1 },
          { card: card('{start_date}~{end_date}의 바다') }
        ),
      });
      tripWith({});

      render(page(PAST_TODAY));

      expect(
        screen.getByTestId('reflection-daily-narrative')
      ).toHaveTextContent('2026-09-24의 바다');
    });
  });

  describe('AC-4 · 조회·생성 중에는 pending — empty 로 접지 않는다 (INV-4)', () => {
    it('pending 은 본문만 바꾼다 — 헤더 "편집"·일차 탭·하단 바는 남고 하단 CTA 는 없으며, 안내 글자가 비지 않았다 (Q2)', () => {
      arrange({ reflection: undefined });

      render(page(PAST_TODAY));

      const pending = screen.getByTestId('reflection-daily-pending');
      expect(pending).toHaveTextContent(/\S/);
      expect(screen.getByTestId('reflection-daily-edit')).toBeOnTheScreen();
      expect(
        screen.getByTestId('reflection-daily-day-tab-1')
      ).toBeOnTheScreen();
      expect(screen.getByTestId(BAR)).toBeOnTheScreen();
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

  describe('TRIP-1202 · 일차 탭은 스택을 쌓지 않는다(replace)', () => {
    it('2일차 탭 → 그날 경로로 replace 1회, push 0회', () => {
      arrange(undefined);
      renderPage('2026-09-26');

      fireEvent.press(tab(2));

      expect(router.replace).toHaveBeenCalledTimes(1);
      expect(router.replace).toHaveBeenCalledWith(
        `/trips/${TRIP_ID}/records/reflection/2026-09-25`
      );
      expect(router.push).not.toHaveBeenCalled();
    });
  });

  // TRIP-1425 · Q-113·114 — 아직 오지 않은 날은 회고를 만들지 않는다(TRIP-1068 결정) → 칩도 누를 수 없다.
  describe('TRIP-1425 · 아직 오지 않은 날 칩은 누를 수 없다', () => {
    /** 3일 여행(09-24~09-26)으로 덮는다 — 보는 날은 늘 09-24(1일차), 레코드 없음. */
    function arrangeThreeDays() {
      arrange(undefined);
      (useGetTripsTripId as jest.Mock).mockReturnValue({
        data: {
          tripId: TRIP_ID,
          startDate: '2026-09-24',
          endDate: '2026-09-26',
        },
        isPending: false,
        isError: false,
      });
    }

    function isDisabled(day: number): unknown {
      return tab(day).props.accessibilityState?.disabled;
    }

    it('오늘이 1일차면 2·3일차 칩은 비활성이고, 1일차는 활성(선택) 그대로다 (AC-8)', () => {
      arrangeThreeDays();

      renderPage('2026-09-24');

      expect(isDisabled(2)).toBe(true);
      expect(isDisabled(3)).toBe(true);
      expect(isDisabled(1)).not.toBe(true);
      expect(isSelected(1)).toBe(true);
    });

    it('2·3일차 칩을 눌러도 화면을 바꾸지 않는다 — replace 0회 (AC-7)', () => {
      arrangeThreeDays();
      renderPage('2026-09-24');

      fireEvent.press(tab(2));
      fireEvent.press(tab(3));

      expect(router.replace).not.toHaveBeenCalled();
    });

    it('오늘 칩은 누를 수 있고 내일 칩만 막힌다 — 경계는 오늘 다음 날부터 (AC-10)', () => {
      arrangeThreeDays();
      renderPage('2026-09-25');

      fireEvent.press(tab(2));

      expect(isDisabled(2)).not.toBe(true);
      expect(isDisabled(3)).toBe(true);
      expect(router.replace).toHaveBeenCalledTimes(1);
      expect(router.replace).toHaveBeenCalledWith(
        `/trips/${TRIP_ID}/records/reflection/2026-09-25`
      );
    });
  });
});

describe('바 뒤로(기록 탭)와 error 얼굴 「다시 시도」', () => {
  // TRIP-1119 (옛 DailyReflectionPage.back.test.tsx)
  /**
   * TRIP-1119 · j03 오늘의 회고 — 페이지가 뒤로를 어디로 보내나. (TRIP-1591: 하단 「확인」은 없앴다 — 나가는 길은 바 뒤로 하나.)
   *
   * 무엇을 보장하나:
   *  - AC1(TRIP-1591): 바 뒤로는 히스토리 유무와 무관하게 기록 탭으로 `dismissTo` 1회 — 이전 화면(back)이 아니다.
   *    error 얼굴에서도 재시도가 아니라 나가기다.
   *  - AC6: error 얼굴의 "다시 시도"는 히스토리가 없어도 이동 없이 재조회 그대로(경계).
   *
   * 훅 2개와 expo-router 만 목하고 화면은 실물로 태운다(`.faces.test.tsx` 동형).
   * ★ `jest.clearAllMocks()` 는 `mockReturnValue` 를 지우지 않는다 — 그래서 모든 케이스가 `arrange` 에서
   *   `canGoBack` 반환값을 직접 정한다(앞 케이스의 false 가 새지 않게).
   */

  const TRIP_ID = 'trip-1119';

  const DAY = '2026-09-24';

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

  // TRIP-1591 — 바 뒤로는 히스토리와 무관하게 기록 탭으로 걷어낸다(실제 스택 결과는 recordBarStack). 「확인」(아래 AC6)은 그대로 이전 화면이다.
  describe('AC1 · 바 뒤로는 히스토리가 있든 없든 기록 탭으로 dismissTo 한다 (TRIP-1591)', () => {
    beforeEach(holdReduceMotionOn); // 동작 줄이기 켜짐 — 바 뒤로가 모션 없이 즉시 이동한다(모션은 RecordNavBar 테스트가 잰다)

    // 히스토리 값(두 번째 칸)은 일부러 섞었다 — 어느 얼굴이든 어느 쪽 값이든 같은 길이어야 한다. error 얼굴은 재시도가 아니라 나가기다.
    it.each<[PageFace, boolean]>([
      ['default', true],
      ['data-insufficient', false],
      ['empty', true],
      ['pending', false],
      ['error', true],
    ])(
      '%s (canGoBack=%s): 바 뒤로 → dismissTo(기록 탭) 1회, back·replace·재조회 0회',
      async (face, history) => {
        const refetch = arrange(face, history);
        renderPage();
        await flushOsAnswer();

        fireEvent.press(screen.getByTestId(`${BAR}-back`));

        expect(router.dismissTo).toHaveBeenCalledTimes(1);
        expect(router.dismissTo).toHaveBeenCalledWith(shellTabHref('records'));
        expect(router.back).not.toHaveBeenCalled();
        expect(router.replace).not.toHaveBeenCalled();
        expect(refetch).not.toHaveBeenCalled();
      }
    );
  });

  // TRIP-1591 — data 얼굴 「확인」은 없앴다(화면 테스트가 부재를 잠근다). 남은 CTA 는 error 얼굴 「다시 시도」뿐이다.
  describe('AC6 · error 얼굴 「다시 시도」는 이동이 아니라 재조회다', () => {
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

describe('🔴 TRIP-1584 · 5칸 복제 탭바(옛 TRIP-1262 dismissTo) 대신 3칸 바 — 기록 칸은 이 날짜를 싣고 간다', () => {
  // 문맥 없는 이 테스트에선 스택에 j01 이 없다고 보므로 push — dismissTo 선택은 recordBarStack 이 잰다.
  beforeEach(() => {
    jest.clearAllMocks();
    resetPressGuard();
  });

  it('탭바는 없고, 기록 칸 press → push(/trips/{id}/records?day={date}) 1회', () => {
    (useGetTripsTripId as jest.Mock).mockReturnValue({
      data: {
        tripId: 'trip-1262',
        startDate: '2026-09-24',
        endDate: '2026-09-25',
      },
      isPending: false,
      isError: false,
    });
    (useDailyReflection as jest.Mock).mockReturnValue({
      reflection: undefined,
      isPending: true,
      isError: false,
      refetch: jest.fn(),
      create: jest.fn(),
      saveEdit: jest.fn(),
    });

    render(
      <DailyReflectionPage
        tripId="trip-1262"
        date="2026-09-24"
        today={PAST_TODAY}
      />
    );
    expect(screen.queryByTestId('shell-tabbar-root')).toBeNull();

    fireEvent.press(screen.getByTestId(`${BAR}-tab-records`));

    expect((router.push as jest.Mock).mock.calls).toEqual([
      ['/trips/trip-1262/records?day=2026-09-24'],
    ]);
    expect(router.dismissTo).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
