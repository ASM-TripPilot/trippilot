import { render, screen } from '@testing-library/react-native';

import { useDailyReflection } from '@/features/reflection/model/useDailyReflection';
import type {
  Reflection,
  ReflectionCard,
  ReflectionStats,
} from '@/shared/api/generated/schemas';
import { useGetTripsTripId } from '@/shared/api/generated/trips/trips';

import { DailyReflectionPage } from './DailyReflectionPage';

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

const TRIP_ID = 'trip-1068';
const DAY = '2026-09-24';
const PAST_TODAY = '2026-09-26';
const FUTURE_TODAY = '2026-09-23';
const WRITTEN = '바다를 보며 천천히 걸은 하루';
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
    expect(screen.getByTestId('reflection-daily-narrative')).toHaveTextContent(
      WRITTEN
    );
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
    expect(screen.getByTestId('reflection-daily-day-tab-1')).toBeOnTheScreen();
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
