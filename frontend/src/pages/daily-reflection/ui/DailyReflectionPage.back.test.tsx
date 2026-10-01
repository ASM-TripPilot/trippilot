import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { useDailyReflection } from '@/features/reflection/model/useDailyReflection';
import type {
  Reflection,
  ReflectionCard,
  ReflectionStats,
} from '@/shared/api/generated/schemas';
import { useGetTripsTripId } from '@/shared/api/generated/trips/trips';

import { DailyReflectionPage } from './DailyReflectionPage';

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

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn(),
    back: jest.fn(),
  },
}));

jest.mock('@/features/reflection/model/useDailyReflection', () => ({
  useDailyReflection: jest.fn(),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTripsTripId: jest.fn(),
}));

const TRIP_ID = 'trip-1119';
const DAY = '2026-09-24';
const PAST_TODAY = '2026-09-26';
const RECORDS_TAB = '/(tabs)/records';

type PageFace = 'default' | 'data-insufficient' | 'empty' | 'error' | 'pending';

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
