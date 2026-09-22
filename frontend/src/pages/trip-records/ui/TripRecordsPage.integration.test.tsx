import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { TripRecordsPage } from './TripRecordsPage';

/**
 * 🔴 TRIP-759 · AC-1·AC-2·AC-3 — j01 방문 기록 페이지 **실 라우트 실데이터 렌더**(완료조건).
 *
 * 무엇을 보장하나(관측 가능한 결과만 — 화면의 새 prop 형태는 박제하지 않는다):
 *  - AC-1  일자 탭이 `Day${n}` 이 아니라 `${n}일차` 로 뜬다(formatDayLabel 배선).
 *  - AC-2  완료 방문 카드의 사진 자리에 PhotoThumbStrip 이 배선된다(`record-trip-photo-add` = 실배선 신호).
 *  - AC-3  완료 방문 카드의 메모 자리에 MemoInline 이 배선된다(`record-trip-memo-input`).
 *  - AC-3(seed-once) 카드 전환 시 타이핑한 메모 초안이 다음 방문으로 새지 않는다(key={visitCheckId}).
 *
 * ★왜 페이지 통합인가: 카드측 슬롯 계약은 VisitRecordCard.wiring.test 가 이미 잠갔다. 남은 완료조건은
 *   "페이지가 실제로 슬롯을 실데이터로 조립하는가" — 실 쿼리(MSW)로 렌더해야만 보인다.
 * ★정적↔실배선 판별: 카드 정적 스캐폴딩(사진 자리 View·메모 자리 Text)은 **testID 가 없다**. 실배선한
 *   PhotoThumbStrip·MemoInline 만 `record-trip-photo-add`·`record-trip-memo-input` 을 소유한다 →
 *   이 testID present = "실 컴포넌트가 슬롯에 들어감"(글리프 fill 사각 회피 계열, 색 아닌 testID 로 판정).
 * ★seed-once(key): MemoInline 은 `useState(text ?? '')` 로 초안을 **마운트 1회** 심는다. 메모 읽기
 *   소스가 없어(VisitCheck 에 memo 필드 없음) "저장 메모 표시"로는 못 잠근다 — **타이핑 초안이 day 전환에
 *   새 나느냐**로 관측한다. key 가 방문 id 면 위치0 방문이 바뀔 때 리마운트돼 초안이 ''로 다시 심긴다.
 *   (한계: 기존 카드 맵이 이미 `key={card.visitCheckId}` 라, 슬롯을 그 안에 넣으면 배선과 동시 green 일 수
 *    있다 — 그래도 배선 부재로 red-first 이고 장래 키 회귀를 막는 그물이다. 02a §4-★4.)
 *
 * (개념) `render(ui,{wrapper})`=QueryClient provider 로 감싸 렌더 · `findByTestId`=비동기 등장 대기 후
 *   조회(쿼리 완료까지) · `within(el).getByText`=그 서브트리 안에서만 완전일치 검색(활성일 귀속 헤더가
 *   같은 `1일차` 를 또 그리므로 탭으로 스코프) · `fireEvent.changeText`=입력 이벤트 · `.props.value`=제어값.
 */

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 't1';

// 스토리지·라우터는 페이지 마운트가 건드리므로 목킹(visitCheck 통합 선례). 라우터는 press 전엔 안 불리나
// import 해소·메서드 접근 안전을 위해 3함수 제공.
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-router', () => ({
  router: {
    canGoBack: jest.fn(() => false),
    back: jest.fn(),
    replace: jest.fn(),
  },
}));

// 지도 히어로가 네이티브 지도(Kakao/Naver)를 태우므로 관찰 목으로 갈아끼운다(TripRecordsScreen.test 선례).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** 슬롯 1개짜리 일자 — 이름 조인용 poiId·nameKo 만 채우면 충분(나머지는 스키마 필수 최소값). */
function daySlot(poiId: string, nameKo: string) {
  return {
    poiId,
    nameKo,
    startAt: '10:00:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [] as string[],
  };
}

function itinerary() {
  return {
    itineraryId: 'it1',
    tripId: TRIP_ID,
    status: 'CONFIRMED',
    solveMode: 'FULL',
    generationMode: 'AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: [
      { date: '2026-08-20', slots: [daySlot('p1', '광안리 해변')] },
      { date: '2026-08-21', slots: [daySlot('p2', '부산시립미술관')] },
      { date: '2026-08-22', slots: [daySlot('p3', '○○ 카페')] },
    ],
  };
}

/** 완료 방문(arrived+completed) 1건 — 완료 카드라야 사진/메모 슬롯이 붙는다(AC-2 "완료 방문 카드"). */
function completedVisit(visitCheckId: string, day: string, poiId: string) {
  return {
    visitCheckId,
    slotKey: `${day}#${poiId}`,
    poiId,
    arrivedAt: `${day}T14:20:00`,
    completedAt: `${day}T15:20:00`,
    skippedAt: null,
    source: 'MANUAL',
    spontaneous: false,
    updatedAt: `${day}T15:20:00`,
  };
}

/** day 파라미터로 갈리는 방문 목록 — seed-once 테스트가 day 전환으로 위치0 방문을 바꾼다. */
const VISITS_BY_DAY: Record<string, ReturnType<typeof completedVisit>[]> = {
  '2026-08-20': [completedVisit('v-a', '2026-08-20', 'p1')],
  '2026-08-21': [completedVisit('v-b', '2026-08-21', 'p2')],
  '2026-08-22': [],
};

function photo() {
  return {
    visitPhotoMetaId: 'ph1',
    localAssetId: 'asset-1',
    deviceId: 'device-1',
    takenAt: null,
    exifLat: null,
    exifLng: null,
    sortOrder: 0,
  };
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  setAccessToken('a');
  // 페이지가 마운트에 쏘는 GET 전부 + 카드 photos 를 등록(onUnhandledRequest:'error' 라 누락 시 크래시).
  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    ),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, ({ params }) =>
      HttpResponse.json({
        visits: VISITS_BY_DAY[params.day as string] ?? [],
      })
    ),
    http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])),
    http.get(`${BASE}/trips/:tripId/visits/:visitCheckId/photos`, () =>
      HttpResponse.json({ items: [photo()], count: 1 })
    )
  );
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});
afterAll(() => server.close());

describe('🔴 AC-1 · 일자 탭 = "${n}일차"(Day${n} 폐기)', () => {
  it('탭 3개가 1일차·2일차·3일차 로 뜨고, 옛 Day1 라벨은 없다', async () => {
    render(<TripRecordsPage tripId={TRIP_ID} />, { wrapper });

    // 준비/실행 — itinerary 3일이 도착하면 탭 3개가 마운트된다.
    const tab0 = await screen.findByTestId('record-trip-day-tab-2026-08-20');
    const tab1 = screen.getByTestId('record-trip-day-tab-2026-08-21');
    const tab2 = screen.getByTestId('record-trip-day-tab-2026-08-22');

    // 단언 — 각 탭 서브트리 안에서 한국어 라벨(within 으로 귀속 헤더의 동일 문자열과 분리).
    expect(within(tab0).getByText('1일차')).toBeTruthy();
    expect(within(tab1).getByText('2일차')).toBeTruthy();
    expect(within(tab2).getByText('3일차')).toBeTruthy();

    // 부정 — 옛 영문 라벨은 사라진다(구현 전엔 present 라 red).
    expect(screen.queryByText('Day1')).toBeNull();
  });
});

describe('🔴 AC-2·AC-3 · 완료 방문 카드에 사진/메모 슬롯이 실배선된다', () => {
  it('record-trip-photo-add(PhotoThumbStrip)·record-trip-memo-input(MemoInline) 이 실데이터 렌더에서 뜬다', async () => {
    render(<TripRecordsPage tripId={TRIP_ID} />, { wrapper });

    // 준비/실행 — 활성일(첫날) 완료 방문(v-a) 카드가 쿼리 완료 후 그려진다.
    await screen.findByText('광안리 해변');

    // 단언 — 정적 스캐폴딩엔 없는 실배선 testID 가 present(= 실 컴포넌트가 슬롯에 들어감).
    expect(await screen.findByTestId('record-trip-photo-add')).toBeTruthy();
    expect(screen.getByTestId('record-trip-memo-input')).toBeTruthy();
  });
});

describe('🔴 AC-3(seed-once) · 메모 초안이 카드 전환에 새지 않는다(key={visitCheckId})', () => {
  it('day1 메모에 타이핑 후 day2 로 전환하면 새 카드 메모는 빈 값이다', async () => {
    render(<TripRecordsPage tripId={TRIP_ID} />, { wrapper });

    // 준비 — 첫날(광안리) 완료 카드의 메모에 초안을 타이핑한다.
    await screen.findByText('광안리 해변');
    fireEvent.changeText(
      screen.getByTestId('record-trip-memo-input'),
      '초안 텍스트'
    );

    // 실행 — 둘째날 탭으로 전환한다(위치0 방문이 v-a → v-b 로 바뀐다).
    fireEvent.press(screen.getByTestId('record-trip-day-tab-2026-08-21'));
    await screen.findByText('부산시립미술관');

    // 단언 — 새 방문 메모는 리마운트로 초기화돼 빈 값(초안이 새면 '초안 텍스트' 가 남아 red).
    expect(screen.getByTestId('record-trip-memo-input').props.value).toBe('');
  });
});
