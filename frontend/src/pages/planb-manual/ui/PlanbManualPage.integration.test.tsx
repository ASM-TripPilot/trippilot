import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { PlanbManualPage } from './PlanbManualPage';
import type {
  Itinerary,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-443 · planb-manual 배선 승인 테스트 — 라우트가 넘긴 variant→얼굴, GET→편집 days, [저장]→PUT
 * 을 태우는 심판. `ManualPlanPage.integration.test.tsx`(h19)와 대칭이되 GET+PUT(생성 POST 없음).
 *
 * 무엇을 보장하나:
 *  - 🔴 **I1(★봉합)**: variant 기본(i15)엔 폴백/누락 배너가 없다 — 루트 존재 짝 + 배너 testID 부재.
 *  - 🔴 **I2(param→face)**: variant='error' 를 화면에 흘려 i22 누락 배너가 뜬다(하드코딩/드롭 차단).
 *  - 🔴 **I3(저장 배선)**: [저장] press → PUT 이 {tripId, data:{days:[...]}} 로 나간다.
 *
 * 범위 밖(명시): 저장 onSuccess→머지→배지 재렌더 왕복은 mergeValidationFlags.test(순수)+
 *   ManualEditScreen.test(render 데이터 추종)의 합성으로 커버. 복구 트리거 배선은 Q4 정본 공백 →
 *   심판 밖(후속). [시각 입력] 시트 실제 열림은 6-b 실기(바텀시트 함정).
 *
 * jest.mock 팩토리는 파일 맨 위로 호이스팅돼 바깥 변수를 못 본다 — 이름이 mock 으로 시작하는 변수만 예외.
 */

let mockItinerary: Itinerary | undefined;

const mockMutate = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();

// GET(편집 days 시드) + PUT(저장) 훅 seam — 그 아래 codegen 은 계약 테스트 몫.
jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTripsTripIdItinerary: () => ({
    data: mockItinerary,
    isPending: mockItinerary === undefined,
    isError: false,
  }),
  usePutTripsTripIdItinerary: () => ({
    mutate: mockMutate,
    isPending: false,
    isError: false,
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  router: { push: mockPush, back: mockBack },
}));

// TRIP-577 · 드래그 리스트는 reanimated 네이티브 런타임 의존 → 수동 목 활성(카드 렌더 + onDragEnd 를
// 호스트 View prop 으로 노출, 02a ★3·§5-B). 구현 전엔 셸이 slots.map 이라 무해(아무도 import 안 함).
jest.mock('react-native-draggable-flatlist');

const TRIP_ID = 't1';

/** 비고정 슬롯 1개짜리 일정 — 저장 봉투·얼굴 판정의 최소 픽스처. */
const ITINERARY: Itinerary = {
  itineraryId: 'it1',
  tripId: TRIP_ID,
  status: 'PLANNED',
  solveMode: 'MINIMAL',
  generationMode: 'MANUAL',
  isFallback: false,
  generationState: 'COMPLETE',
  days: [
    {
      date: '2026-06-11',
      slots: [
        {
          poiId: 'poi-a',
          startAt: '13:00:00',
          endAt: '14:30:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          nameKo: '부산시립미술관',
          tags: [],
        },
      ],
    },
  ],
};

/** 4슬롯 1일자 — [A 비고정, F isFixed(호텔), B 비고정, C 비고정]. 재정렬·고정 재고정 심판용(I4). */
function multiSlot(
  poiId: string,
  over: Partial<ItineraryDaysItemSlotsItem> = {}
): ItineraryDaysItemSlotsItem {
  return {
    poiId,
    startAt: '09:00:00',
    endAt: '10:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo: poiId,
    tags: [],
    ...over,
  };
}

const MULTI_DATE = '2026-06-11';
const M_A = multiSlot('poi-a');
const M_F = multiSlot('poi-f', { isFixed: true, startAt: '17:30:00' });
const M_B = multiSlot('poi-b', { startAt: '11:00:00' });
const M_C = multiSlot('poi-c', { startAt: '13:00:00' });

const ITINERARY_MULTI: Itinerary = {
  ...ITINERARY,
  days: [{ date: MULTI_DATE, slots: [M_A, M_F, M_B, M_C] }],
};

beforeEach(() => {
  mockItinerary = ITINERARY;
  mockMutate.mockClear();
  mockPush.mockClear();
  mockBack.mockClear();
});

describe('🔴 I1 · ★봉합 — variant 기본(i15)엔 폴백/누락 배너가 없다', () => {
  it('루트가 뜨고(짝) 누락 배너 testID 는 없다', () => {
    render(<PlanbManualPage tripId={TRIP_ID} />);

    // 루트 존재 짝 — 화면이 그 픽스처로 실제 렌더됐다(오타 testID 공허통과 차단).
    expect(screen.getByTestId('planb-manual-root')).toBeOnTheScreen();

    // MANUAL 은 isFallback=false(선택) — 폴백/누락 배너는 어느 계약으로도 안 뜬다.
    expect(screen.queryByTestId('planb-manual-missing-data')).toBeNull();
  });
});

describe('🔴 I2 · param→face — variant=error 면 i22 누락 배너를 흘린다', () => {
  it('페이지가 variant 를 화면에 전달해 누락 배너가 뜬다', () => {
    render(<PlanbManualPage tripId={TRIP_ID} variant="error" />);

    expect(screen.getByTestId('planb-manual-missing-data')).toBeOnTheScreen();
  });
});

describe('🔴 I3 · 저장 배선 — [저장]이 편집 봉투를 PUT 한다', () => {
  it('save press 시 mutate 가 {tripId, data:{days}} 로 1회 나간다', () => {
    render(<PlanbManualPage tripId={TRIP_ID} variant="error" />);

    fireEvent.press(screen.getByTestId('planb-manual-save'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const vars = mockMutate.mock.calls[0][0] as {
      tripId: string;
      data?: { days?: unknown };
    };
    expect(vars.tripId).toBe(TRIP_ID);
    expect(Array.isArray(vars.data?.days)).toBe(true);
  });
});

// ── TRIP-577 회귀 심판(신설) — 드래그 재정렬·시각 반영 실배선 ─────────────────────
/** 저장 봉투에서 활성 일자(days[0]) 슬롯의 poiId 순서를 뽑는다. */
function savedDay0PoiIds(): string[] {
  const vars = mockMutate.mock.calls[0][0] as {
    data: { days: { slots: { poiId: string }[] }[] };
  };
  return vars.data.days[0].slots.map((s) => s.poiId);
}

const A_KEY = `${ITINERARY.days[0].date}#poi-a`; // 기본 픽스처 단일 슬롯 키

describe('🔴 I4 · AC-1 — 드래그 재정렬 → PUT days 순서(고정 재고정)', () => {
  it('onDragEnd({data:[C,A,F,B]}) → 저장 시 [C,F,A,B](reorderKeepingFixed) 순서로 PUT 한다', () => {
    mockItinerary = ITINERARY_MULTI;
    render(<PlanbManualPage tripId={TRIP_ID} />);

    // 제스처는 못 태우니 목 호스트의 onDragEnd 를 직접 발화 — "C 를 맨 앞으로" 시뮬(02a §5-B).
    const list = screen.getByTestId('planb-manual-list');
    act(() => {
      (list.props as { onDragEnd: (p: unknown) => void }).onDragEnd({
        data: [M_C, M_A, M_F, M_B],
        from: 3,
        to: 0,
      });
    });

    fireEvent.press(screen.getByTestId('planb-manual-save'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    // reorderKeepingFixed([A,F,B,C],[C,A,F,B]) = [C,F,A,B] — 고정 F 는 idx1 유지, 비고정만 새 순서(02a §5-C 실행).
    expect(savedDay0PoiIds()).toEqual(['poi-c', 'poi-f', 'poi-a', 'poi-b']);

    const vars = mockMutate.mock.calls[0][0] as { tripId: string };
    expect(vars.tripId).toBe(TRIP_ID);
  });
});

describe('🔴 I5 · AC-3 — [시각 입력] 적용 → 카드가 실제 시각을 반영(루트 짝)', () => {
  it('적용 전 "--:-- · 도착 시각 직접 입력" → 시작 10 적용 후 카드가 10:00 을 보인다', () => {
    render(<PlanbManualPage tripId={TRIP_ID} variant="error" />);

    // 적용 전(현행 폴백) — 카드가 도착 시각 재입력을 유도한다(선제green).
    expect(screen.getByTestId('planb-manual-root')).toBeOnTheScreen();
    expect(screen.getByTestId(`planb-manual-slot-${A_KEY}`)).toHaveTextContent(
      /도착 시각 직접 입력/
    );

    // 시트 열기 → 시작 시각을 13→10 으로 바꿔 적용(시드값과 달라야 "병합값을 읽는다"가 증명됨).
    fireEvent.press(screen.getByTestId(`planb-manual-time-input-${A_KEY}`));
    fireEvent.press(screen.getByTestId('planb-manual-time-start-h-10'));
    fireEvent.press(screen.getByTestId('planb-manual-time-apply'));

    // 적용 후 — 카드가 병합된 실제 시각을 그린다(--:-- 아님).
    expect(screen.getByTestId('planb-manual-root')).toBeOnTheScreen();
    const card = screen.getByTestId(`planb-manual-slot-${A_KEY}`);
    expect(card).toHaveTextContent(/10:00/);
    expect(card).not.toHaveTextContent(/도착 시각 직접 입력/);
  });
});

describe('🟢 I6 · AC-5 회귀 — 라운드트립(onApply→draft→PUT startAt) [선제green·뮤테이션 실측 대상]', () => {
  it('시각 적용 후 저장하면 PUT 봉투 slot.startAt 이 적용값(10:00:00)으로 실린다', () => {
    render(<PlanbManualPage tripId={TRIP_ID} variant="error" />);

    fireEvent.press(screen.getByTestId(`planb-manual-time-input-${A_KEY}`));
    fireEvent.press(screen.getByTestId('planb-manual-time-start-h-10'));
    fireEvent.press(screen.getByTestId('planb-manual-time-apply'));

    fireEvent.press(screen.getByTestId('planb-manual-save'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const vars = mockMutate.mock.calls[0][0] as {
      tripId: string;
      data: { days: { slots: { startAt: string }[] }[] };
    };
    expect(vars.tripId).toBe(TRIP_ID);
    // 라운드트립은 TRIP-443 이 이미 배선(경고-2 "누르는 테스트만 0") — 표시 배선과 무관하게 PUT 은 옳다.
    expect(vars.data.days[0].slots[0].startAt).toBe('10:00:00');
  });
});
