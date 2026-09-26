import { render, screen } from '@testing-library/react-native';

import { useDailyReflection } from '@/features/reflection/model/useDailyReflection';
import type { Reflection } from '@/shared/api/generated/schemas';
import { useGetTripsTripId } from '@/shared/api/generated/trips/trips';
import { seoulDate } from '@/shared/date/seoulDate';

import { DailyReflectionPage } from './DailyReflectionPage';

/**
 * TRIP-980 · j03 회고 — "오늘" 칩과 헤더·empty 문구는 **KST 실제 오늘**로 정한다(사용자 확정 D1·D2).
 *
 * 무엇을 보장하나:
 *  - AC-5: `오늘` 접두는 날짜가 KST 오늘인 일차 탭에만 붙는다. 보고 있는 탭(활성)과 오늘 탭은 따로 정해진다.
 *    today prop 을 안 주면 시계를 KST 로 읽는다(UTC 아님).
 *  - AC-6: 보고 있는 날짜가 오늘이 아니면 헤더 "하루 회고", empty 문구 "이 날 기록된 활동이 없습니다".
 *    오늘이면 기존 "오늘의 회고" / "오늘 기록된 활동이 없습니다".
 *  - AC-7: 지난 날 화면에도 소요시간 표기가 없다(INV-3).
 *
 * 페이지와 화면은 실물, 데이터 훅 2개(`useDailyReflection`·`useGetTripsTripId`)만 목한다 — 이 파일은
 * "페이지가 날짜를 비교해 화면에 무엇을 넘기나"만 보고, 네트워크·캐시는 save.integration 이 본다.
 * 여행은 09-24~09-25(탭 2개), 보고 있는 날짜는 늘 09-24(1일차 = 활성).
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

const TRIP_ID = 'trip-980';
const VIEWING = '2026-09-24';
const BASIC_SUBTITLE = '기록이 없는 하루';
/** 소요시간 표기 탐지기(INV-3) — reflectionStructure G6 · card.test 와 같은 식. */
const DURATION_TEXT = /(소요|\d+\s*분|\d+\s*시간)/;

/** 방문 0·사진 0 레코드 — 얼굴은 data-insufficient. */
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
  render(<DailyReflectionPage tripId={TRIP_ID} date={VIEWING} today={today} />);
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
  it('지난 날 empty 얼굴은 헤더 "하루 회고", 문구 "이 날 기록된 활동이 없습니다"다', () => {
    arrange(undefined);

    renderPage('2026-09-26');

    expect(screen.getByText('하루 회고')).toBeOnTheScreen();
    expect(screen.queryByText('오늘의 회고')).toBeNull();
    expect(screen.getByTestId('reflection-daily-empty')).toHaveTextContent(
      '이 날 기록된 활동이 없습니다'
    );
  });

  it('지난 날 data 얼굴도 헤더가 "하루 회고"다', () => {
    arrange(BASIC_RECORD);

    renderPage('2026-09-26');

    expect(screen.getByText('하루 회고')).toBeOnTheScreen();
    expect(screen.queryByText('오늘의 회고')).toBeNull();
  });

  it('보고 있는 날이 오늘이면 "오늘의 회고" / "오늘 기록된 활동이 없습니다"를 유지한다(짝)', () => {
    arrange(undefined);

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
    arrange(BASIC_RECORD);

    renderPage('2026-09-26');

    expect(screen.root).not.toHaveTextContent(DURATION_TEXT);
    expect(screen.getByTestId('reflection-daily-narrative')).toHaveTextContent(
      BASIC_SUBTITLE
    );
  });
});
