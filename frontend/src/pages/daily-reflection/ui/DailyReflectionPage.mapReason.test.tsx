import {
  act,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { useDailyReflection } from '@/features/reflection/model/useDailyReflection';
import type {
  Reflection,
  ReflectionCard,
  ReflectionStats,
} from '@/shared/api/generated/schemas';
import { useGetTripsTripId } from '@/shared/api/generated/trips/trips';

import { DailyReflectionPage } from './DailyReflectionPage';

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
 *   모름)으로 돈다(TripRecordsPage.manualCheckin.integration 선례).
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

// jest 는 팩토리 밖 변수를 `mock*` 이름일 때만 허용하므로 지연 래퍼로 참조한다.
const mockGetForeground = jest.fn();
const mockRequestForeground = jest.fn();
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...args: unknown[]) =>
    mockGetForeground(...args),
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForeground(...args),
}));

const TRIP_ID = 'trip-1118';
const DAY = '2026-09-24';
const PAST_TODAY = '2026-09-26';
const ROOT = 'reflection-daily-map-notice';
const leaf = (reason: Reason) => `${ROOT}-reason-${reason}`;
/** 소요시간 표기 탐지기(INV-3) — reflectionStructure G6 과 같은 식. */
const DURATION_TEXT = /(소요|\d+\s*분|\d+\s*시간)/;

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
  else if (kind === 'undefined') mockGetForeground.mockResolvedValue(undefined);
  else mockGetForeground.mockResolvedValue(RESPONSES[kind]);
}

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

/** 그 날 레코드가 있는 상태로 훅 2개를 세팅한다(DailyReflectionPage.faces.test 선례). */
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

    expect(screen.queryByTestId('reflection-daily-narrative-edit')).toBeNull();
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
