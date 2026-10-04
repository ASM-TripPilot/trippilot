/**
 * @jest-environment ./src/test-support/deviceTimeZoneEnvironment.cjs
 */
import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { Linking } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { router } from 'expo-router';

import { PlusGlyph } from '@/features/record';
import { server } from '@/mocks/server';
import type { VisitPhoto } from '@/shared/api/index.schemas';
import { getGetTripsTripIdVisitsVisitCheckIdPhotosQueryKey } from '@/shared/api/index.hooks';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import { WHEEL_CELL_HEIGHT } from '@/shared/ui/WheelPicker';
import { flushNotifications } from '@/test-support/flushNotifications';
import { isInsideSheet, renderedText } from '@/test-support/sheetTree';
import { tripRecordsTrip } from '@/test-support/tripRecordsTrip';

import { TripRecordsPage } from './TripRecordsPage';

/**
 * j01 방문 기록 페이지 — 실 페이지 + 실제 HTTP(msw) 로 본 사용자 관측 결과. 관점마다 describe 하나(옛 파일 하나).
 * 뷰 혼자 그리는 렌더 계약은 `TripRecordsView.test.tsx`.
 *
 * 파일 공용 장치(합치며 한 곳으로 모은 것):
 *  - 맨 위 `@jest-environment` docblock — 기기 시간대를 바꾸는 테스트 환경. **파일 첫 주석이어야 먹는다.**
 *    `__setDeviceTimeZone` 을 실제로 부르는 것은 시각 정비 묶음(LA 시계)뿐이고, 그 묶음이 afterEach 에서 되돌린다.
 *  - msw 서버 기동·정지와 요청 관찰자(`request:start` → observedHits)는 최상위 한 번. 관찰자를 묶음마다 걸면
 *    같은 요청이 여러 번 쌓인다. observedHits 리셋은 쓰는 묶음의 beforeEach 몫.
 *  - 위치 권한(`expo-location`)은 `mockGetForeground` 하나로 받는다. 기본은 값 없음(undefined) = 옛 무목 파일이
 *    받던 jest-expo 기본과 같다 → 페이지가 catch 로 떨어져 일반 모드. 권한을 정하는 묶음은 자기 beforeEach 에서 정한다.
 *  - 사진·설치 식별자 목은 사진 묶음만 `mockPhotoSeam = true` 로 켠다. 끄면 실물 모듈로 넘긴다.
 *  - guardPress 창·push 기록·위치 권한·사진 스위치는 모듈 전역이라 최상위 afterEach 에서 되돌린다.
 */

// 스토리지·라우터는 페이지 마운트가 건드리므로 목킹(visitCheck 통합 선례). push 는 [방문 추가] 이동 관측용.
// TRIP-1157: 배럴이 idSet·stringValue·installId 도 재수출한다 — 통째로 갈아끼우면 그 함수들이 지워지므로 실물을 펼친 뒤 토큰 함수만 덮는다.
jest.mock('@/shared/storage', () => ({
  ...jest.requireActual('@/shared/storage'),
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-router', () => {
  const router = {
    canGoBack: jest.fn(() => false),
    back: jest.fn(),
    replace: jest.fn(),
    push: jest.fn(),
  };
  return { router, useRouter: () => router };
});

// 지도 히어로가 네이티브 지도(Kakao/Naver)를 태우므로 관찰 목으로 갈아끼운다(TripRecordsScreen.test 선례).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...args: unknown[]) =>
    mockGetForeground(...args),
}));

// 사진 묶음 스위치 — true 면 앨범·주소 해석을 목으로, false 면 실물 모듈로 넘긴다.
let mockPhotoSeam = false;
jest.mock('@/shared/photo', () => {
  const actual =
    jest.requireActual<typeof import('@/shared/photo')>('@/shared/photo');
  return {
    pickPhotoAsset: () =>
      mockPhotoSeam ? mockPick() : actual.pickPhotoAsset(),
    resolvePhotoUri: (id: string) =>
      mockPhotoSeam ? mockResolveUri(id) : actual.resolvePhotoUri(id),
  };
});

jest.mock('@/shared/storage/installId', () => {
  const actual = jest.requireActual<
    typeof import('@/shared/storage/installId')
  >('@/shared/storage/installId');
  return {
    getInstallId: () =>
      mockPhotoSeam ? mockGetInstallId() : actual.getInstallId(),
  };
});

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 't1';
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
// 위치 권한 seam — 기본은 값 없음(undefined). 권한을 정하는 묶음이 beforeEach 에서 mockResolvedValue 로 정하고, 최상위 afterEach 가 되돌린다.
const mockGetForeground = jest.fn();
declare const __setDeviceTimeZone: (tz: string | undefined) => void;
const DAY = '2026-08-20';
let observedHits: string[] = [];
// getForegroundPermissionsAsync 응답(LocationPermissionResponse 부분집합) — granted 만 모드 판정에 쓴다.
const DENIED = {
  status: 'denied',
  granted: false,
  canAskAgain: false,
} as const;
const GRANTED = {
  status: 'granted',
  granted: true,
  canAskAgain: true,
} as const;
// 사용자 가시 카피 = 계약(brief §화면·IO 실측). MANUAL_NOTICE 는 법 문구 "(좌표 자동기록 비활성)" 을 담는다.
const MANUAL_NOTICE =
  '수동 체크인 · 방문한 곳을 직접 선택해 기록하세요 (좌표 자동기록 비활성)';
const hitCount = (needle: string) =>
  observedHits.filter((hit) => hit === needle).length;
const mockPick = jest.fn();
const mockResolveUri = jest.fn();
const mockGetInstallId = jest.fn();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});
afterEach(() => {
  resetPressGuard();
  jest.mocked(router.push).mockClear();
  mockGetForeground.mockReset();
  mockPhotoSeam = false;
});

afterAll(() => server.close());

describe('기본 — 일자 탭·사진/메모 슬롯·[방문 추가]·메모 초안', () => {
  // TRIP-759 · TRIP-1072 (옛 TripRecordsPage.integration.test.tsx)
  /**
   * 🔴 TRIP-759 · AC-1·AC-2·AC-3 — j01 방문 기록 페이지 **실 라우트 실데이터 렌더**(완료조건).
   *
   * 무엇을 보장하나(관측 가능한 결과만 — 화면의 새 prop 형태는 박제하지 않는다):
   *  - AC-1  일자 탭이 `Day${n}` 이 아니라 `${n}일차` 로 뜬다(formatDayLabel 배선).
   *  - AC-2  완료 방문 카드의 사진 자리에 PhotoThumbStrip 이 배선된다(`record-trip-photo-strip` = 실배선 신호).
   *  - TRIP-1070 AC-4 — 사진 선택이 배선돼 `+` 타일(`record-trip-photo-add`)이 다시 선다(TRIP-939 B-7 숨김 해제).
   *  - TRIP-1072 AC-1~3 — [방문 추가]는 오늘 탭에만 서고, 누르면 장소 피커로 (tripId·활성 일자)를 실어 1회 간다.
   *  - AC-3  완료 방문 카드의 메모 자리에 MemoInline 이 배선된다(`record-trip-memo-input`).
   *  - AC-3(seed-once) 카드 전환 시 타이핑한 메모 초안이 다음 방문으로 새지 않는다(key={visitCheckId}).
   *
   * ★왜 페이지 통합인가: 카드측 슬롯 계약은 VisitRecordCard.wiring.test 가 이미 잠갔다. 남은 완료조건은
   *   "페이지가 실제로 슬롯을 실데이터로 조립하는가" — 실 쿼리(MSW)로 렌더해야만 보인다.
   * ★정적↔실배선 판별: 카드 정적 스캐폴딩(사진 자리 View·메모 자리 Text)은 **testID 가 없다**. 실배선한
   *   PhotoThumbStrip·MemoInline 만 `record-trip-photo-strip`·`record-trip-memo-input` 을 소유한다 →
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

  beforeEach(() => {
    setAccessToken('a');
    // 페이지가 마운트에 쏘는 GET 전부 + 카드 photos 를 등록(onUnhandledRequest:'error' 라 누락 시 크래시).
    server.use(
      // TRIP-1085 — 페이지가 시트 헤더 여행명을 GET /trips/{tripId} 로 얻는다.
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(tripRecordsTrip())
      ),
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
    // guardPress 창은 모듈 전역 — 앞 테스트의 press 가 다음 테스트 첫 press 를 먹지 않게 닫는다.
    resetPressGuard();
    jest.mocked(router.push).mockClear();
  });

  describe('🔴 AC-1 · 일자 탭 = "${n}일차"(Day${n} 폐기)', () => {
    it('탭 3개가 1일차·2일차·3일차 로 뜨고, 옛 Day1 라벨은 없다', async () => {
      render(<TripRecordsPage tripId={TRIP_ID} />, { wrapper });

      // 준비/실행 — itinerary 3일이 도착하면 탭 3개가 마운트된다. TRIP-1085 — 옛 일자 탭
      // `record-trip-day-tab-{date}` 은 셸 일차 칩 `sheet-daychip-{index}`(0부터)로 옮겨 갔다.
      const tab0 = await screen.findByTestId('sheet-daychip-0');
      const tab1 = screen.getByTestId('sheet-daychip-1');
      const tab2 = screen.getByTestId('sheet-daychip-2');

      // 단언 — 각 탭 서브트리 안에서 한국어 라벨(within 으로 귀속 헤더의 동일 문자열과 분리).
      expect(within(tab0).getByText('1일차')).toBeTruthy();
      expect(within(tab1).getByText('2일차')).toBeTruthy();
      expect(within(tab2).getByText('3일차')).toBeTruthy();

      // 부정 — 옛 영문 라벨은 사라진다(구현 전엔 present 라 red).
      expect(screen.queryByText('Day1')).toBeNull();
    });
  });

  describe('🔴 AC-2·AC-3 · 완료 방문 카드에 사진/메모 슬롯이 실배선된다', () => {
    it('record-trip-photo-strip(PhotoThumbStrip)·record-trip-memo-input(MemoInline)·사진 추가 + 타일이 실데이터 렌더에서 뜬다', async () => {
      render(<TripRecordsPage tripId={TRIP_ID} />, { wrapper });

      // 준비/실행 — 활성일(첫날) 완료 방문(v-a) 카드가 쿼리 완료 후 그려진다.
      await screen.findByText('광안리 해변');

      // 단언 — 정적 스캐폴딩엔 없는 실배선 testID 가 present(= 실 컴포넌트가 슬롯에 들어감).
      expect(await screen.findByTestId('record-trip-photo-strip')).toBeTruthy();
      expect(screen.getByTestId('record-trip-memo-input')).toBeTruthy();
      // TRIP-1070 AC-4 — 사진 선택이 배선돼 `+` 타일이 선다(누른 뒤 거동은 아래 사진 묶음이 본다).
      expect(screen.getByTestId('record-trip-photo-add')).toBeTruthy();
    });
  });

  describe('🔴 TRIP-1072 AC-1~3 · [방문 추가]는 오늘 탭에만, 누르면 장소 피커로 간다', () => {
    const ADD = 'record-trip-spontaneous-add';

    it('B6-a: 활성 일자가 오늘이면 [방문 추가] 버튼이 선다 (AC-1)', async () => {
      // 준비·실행 — 오늘 = 첫날(활성 기본 일자).
      render(<TripRecordsPage tripId={TRIP_ID} today="2026-08-20" />, {
        wrapper,
      });
      await screen.findByText('광안리 해변');

      // 단언 — 버튼과 라벨.
      expect(
        within(screen.getByTestId(ADD)).getByText('방문 추가')
      ).toBeTruthy();
    });

    it.each([
      ['지난 날', '2026-08-21'],
      ['미래 날', '2026-08-19'],
    ])(
      'B6-b: 활성 일자(1일차)가 %s 탭이면 버튼이 없다 (AC-2)',
      async (_label, today) => {
        render(<TripRecordsPage tripId={TRIP_ID} today={today} />, { wrapper });

        // 앵커 — 카드는 그려졌다(부재 단언이 로딩 중에 공짜로 통과하지 않게).
        await screen.findByText('광안리 해변');
        expect(screen.queryByTestId(ADD)).toBeNull();
      }
    );

    it('B6-c: 지난 탭엔 없다가 오늘 탭으로 옮기면 서고, 누르면 그 날짜로 피커에 간다 (AC-2·AC-3)', async () => {
      // 준비 — 오늘 = 2일차. 활성 기본은 1일차(지난 날).
      render(<TripRecordsPage tripId={TRIP_ID} today="2026-08-21" />, {
        wrapper,
      });
      await screen.findByText('광안리 해변');
      expect(screen.queryByTestId(ADD)).toBeNull();

      // 실행 — 오늘 탭으로 옮기고 버튼을 누른다.
      fireEvent.press(screen.getByTestId('sheet-daychip-1'));
      await screen.findByText('부산시립미술관');
      fireEvent.press(screen.getByTestId(ADD));

      // 단언 — tripId·활성 일자를 실어 1회 이동.
      expect(jest.mocked(router.push).mock.calls).toEqual([
        ['/trips/t1/records/add-visit?day=2026-08-21'],
      ]);
    });

    it('B6-d: 버튼을 연타해도 피커 이동은 1회다 (AC-3)', async () => {
      render(<TripRecordsPage tripId={TRIP_ID} today="2026-08-20" />, {
        wrapper,
      });
      await screen.findByText('광안리 해변');

      // 실행 — 같은 순간 두 번.
      const button = screen.getByTestId(ADD);
      fireEvent.press(button);
      fireEvent.press(button);

      // 단언 — push 는 한 번.
      expect(jest.mocked(router.push).mock.calls).toEqual([
        ['/trips/t1/records/add-visit?day=2026-08-20'],
      ]);
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
      fireEvent.press(screen.getByTestId('sheet-daychip-1'));
      await screen.findByText('부산시립미술관');

      // 단언 — 새 방문 메모는 리마운트로 초기화돼 빈 값(초안이 새면 '초안 텍스트' 가 남아 red).
      expect(screen.getByTestId('record-trip-memo-input').props.value).toBe('');
    });
  });
});

describe('셸 조립 — 전면 지도 + 바텀시트·핀·일차 칩·‹', () => {
  // TRIP-1085 (옛 TripRecordsPage.mapSheet.integration.test.tsx)
  /**
   * 🔴 TRIP-1085 · j01 방문 기록 **페이지**가 셸(전면 지도 + 바텀시트)로 조립된다 — 실 쿼리(MSW) 렌더.
   *
   * 무엇을 보장하나:
   *  - MS1 (AC-1)   페이지가 새 뷰(`record-trip-view`)를 그리고, 지도는 셸 것 하나 · 탭바 없음 · 카드는 시트 안.
   *  - MS2·3 (AC-12) 시트 헤더 = "여행명 · N일차 · M월 D일(요일) · N곳". 여행명은 GET /trips/{tripId} 에서 온다.
   *                  그 조회가 실패하면 여행명 조각만 빠지고 오류 표면은 없다(INV-4).
   *  - MS4~6 (AC-10·11 · 결정 3(c)) 핀 = 그날 계획 슬롯 순서. slotKey 로 맞춘 방문이 **도착했고 건너뛰지
   *                  않았으면** 체크 핀(`done`), 아니면 번호 핀(`upcoming`). 즉석 방문은 핀이 없다. 같은 장소의
   *                  즉석 방문이 계획 핀을 체크하지 않는다(poiId 가 아니라 slotKey). 핀 전부 맞추기·지도 잠금.
   *  - MS7 (AC-2)   셸 일차 칩을 누르면 그날 기록을 조회하고 카드·핀이 그날 것으로 바뀐다.
   *  - MS8 (AC-3)   ‹(`sheet-daychip-back`)는 뒤로 갈 곳이 있을 때만 back 한다.
   *
   * ★핀은 `toEqual` 정확 일치 — `kind` 가 붙으면 지도가 기록 마커족(사진·점선)으로 그려 Figma 체크/번호 핀이
   *   아니게 된다. `objectContaining` 이면 그 회귀가 통과한다.
   * ⚠️ 지도 목은 prop 전달까지만 본다 — 핀 모양·경로선·fitPins 실제 카메라는 6-b.
   *
   * (개념) `getByTestId('map-root').props.pins` = 목이 지도에 넘어간 핀 배열을 그대로 보여 준다 ·
   *   `waitFor(() => 단언)` = 단언이 통과할 때까지 잠깐씩 다시 시도(쿼리 도착 대기).
   * 3동작: 준비(2일 일정 + 날짜별 방문 + 여행) → 실행(렌더·칩·뒤로) → 단언(헤더 글자·핀 배열·요청·콜백).
   */

  const DAY1 = '2026-08-20';

  const DAY2 = '2026-08-21';

  /** 좌표가 있는 계획 슬롯(스키마 필수 최소값 + lat/lng). */
  function slot(poiId: string, nameKo: string, lat: number, lng: number) {
    return {
      poiId,
      nameKo,
      startAt: '10:00:00',
      endAt: '11:00:00',
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      tags: [] as string[],
      lat,
      lng,
    };
  }

  const P1 = { lat: 35.1532, lng: 129.1187 };

  const P2 = { lat: 35.1555, lng: 129.1216 };

  const P3 = { lat: 35.156, lng: 129.1174 };

  const P5 = { lat: 35.1, lng: 129.03 };

  const P6 = { lat: 35.101, lng: 129.032 };

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
        {
          date: DAY1,
          slots: [
            slot('p1', '광안리 해변', P1.lat, P1.lng),
            slot('p2', '부산시립미술관', P2.lat, P2.lng),
            slot('p3', '○○ 카페', P3.lat, P3.lng),
          ],
        },
        {
          date: DAY2,
          slots: [
            slot('p5', '◇◇ 시장', P5.lat, P5.lng),
            slot('p6', '△△ 공원', P6.lat, P6.lng),
          ],
        },
      ],
    };
  }

  interface VisitSpec {
    id: string;
    day: string;
    poiId: string;
    /** 계획 방문이면 `${day}#${poiId}`, 즉석 방문이면 null. */
    planned: boolean;
    arrived?: boolean;
    completed?: boolean;
    skipped?: boolean;
  }

  function visit({
    id,
    day,
    poiId,
    planned,
    arrived,
    completed,
    skipped,
  }: VisitSpec) {
    return {
      visitCheckId: id,
      slotKey: planned ? `${day}#${poiId}` : null,
      poiId,
      arrivedAt: arrived ? `${day}T05:20:00Z` : null,
      completedAt: completed ? `${day}T06:20:00Z` : null,
      skippedAt: skipped ? `${day}T07:00:00Z` : null,
      source: 'MANUAL',
      spontaneous: !planned,
      updatedAt: `${day}T07:00:00Z`,
    };
  }

  /** 기본 1일차 — p1 도착 · p2 완료 · p3 기록 없음 · 계획에 없던 p9 즉석 도착. */
  function defaultDay1() {
    return [
      visit({ id: 'v1', day: DAY1, poiId: 'p1', planned: true, arrived: true }),
      visit({
        id: 'v2',
        day: DAY1,
        poiId: 'p2',
        planned: true,
        arrived: true,
        completed: true,
      }),
      visit({
        id: 'v-sp',
        day: DAY1,
        poiId: 'p9',
        planned: false,
        arrived: true,
      }),
    ];
  }

  let visitsByDay: Record<string, ReturnType<typeof visit>[]> = {};

  let dayHits: string[] = [];

  let tripHits = 0;

  const pinsOnMap = () => screen.getByTestId('map-root').props.pins;

  beforeEach(() => {
    setAccessToken('a');
    mockGetForeground.mockResolvedValue({
      status: 'granted',
      granted: true,
      canAskAgain: true,
    });
    visitsByDay = {
      [DAY1]: defaultDay1(),
      [DAY2]: [
        visit({
          id: 'v5',
          day: DAY2,
          poiId: 'p5',
          planned: true,
          arrived: true,
          completed: true,
        }),
      ],
    };
    dayHits = [];
    tripHits = 0;
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => {
        tripHits += 1;
        return HttpResponse.json(tripRecordsTrip('부산 여행', TRIP_ID));
      }),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      ),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, ({ params }) => {
        const day = params.day as string;
        dayHits.push(day);
        return HttpResponse.json({ visits: visitsByDay[day] ?? [] });
      }),
      http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])),
      http.get(`${BASE}/trips/:tripId/visits/:visitCheckId/photos`, () =>
        HttpResponse.json({ items: [], count: 0 })
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
    resetPressGuard();
    // 호출 기록까지 지운다 — MS8b 의 "canGoBack 을 물었다" 단언이 앞 테스트 호출로 공허해지지 않게.
    jest.mocked(router.canGoBack).mockReset().mockReturnValue(false);
    jest.mocked(router.back).mockClear();
  });

  describe('🔴 TRIP-1085 AC-1 · 페이지가 전면 지도 + 바텀시트로 열린다', () => {
    it('MS1 새 뷰가 서고, 지도는 셸 것 하나 · 하단 탭바 없음 · 카드는 시트 안이다', async () => {
      render(<TripRecordsPage tripId={TRIP_ID} today={DAY1} />, { wrapper });

      const card = await screen.findByTestId('record-trip-visit-card-v1');
      expect(screen.getByTestId('record-trip-view')).toBeOnTheScreen();
      expect(screen.getAllByTestId('map-root')).toHaveLength(1);
      expect(screen.queryByTestId('shell-tabbar-root')).toBeNull();
      expect(isInsideSheet(card)).toBe(true);
    });
  });

  describe('🔴 TRIP-1085 AC-12 · 시트 헤더 한 줄', () => {
    it('MS2 여행명이 오면 "부산 여행 · 1일차 · 8월 20일(목) · 4곳"(카드 3 + 계획 행 1)', async () => {
      render(<TripRecordsPage tripId={TRIP_ID} today={DAY1} />, { wrapper });

      await screen.findByTestId('record-trip-visit-card-v1');
      await waitFor(() =>
        expect(
          screen.getByTestId('record-trip-sheet-header')
        ).toHaveTextContent('부산 여행 · 1일차 · 8월 20일(목) · 4곳')
      );
    });

    it('MS3 여행 조회가 실패하면 여행명 조각만 빠지고 오류 표면은 없다 (INV-4)', async () => {
      server.use(
        http.get(`${BASE}/trips/:tripId`, () => {
          tripHits += 1;
          return HttpResponse.json(
            { error: { code: 'INTERNAL', message: 'boom' } },
            { status: 500 }
          );
        })
      );

      render(<TripRecordsPage tripId={TRIP_ID} today={DAY1} />, { wrapper });

      // 앵커 — 여행 요청이 실제로 나가 실패했고 카드도 그려졌다(로딩 중의 공허 통과 차단).
      await screen.findByTestId('record-trip-visit-card-v1');
      await waitFor(() => expect(tripHits).toBeGreaterThanOrEqual(1));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });

      expect(screen.getByTestId('record-trip-sheet-header')).toHaveTextContent(
        '1일차 · 8월 20일(목) · 4곳'
      );
      expect(screen.queryByTestId('record-trip-error')).toBeNull();
    });
  });

  describe('🔴 TRIP-1085 AC-10·AC-11 · 방문 기준 핀 (결정 3(c))', () => {
    it('MS4 도착 2곳은 체크 핀, 미방문은 번호 핀(제자리 번호), 즉석 방문은 핀 없음 · fitPins · 잠금', async () => {
      render(<TripRecordsPage tripId={TRIP_ID} today={DAY1} />, { wrapper });

      await screen.findByTestId('record-trip-visit-card-v-sp');
      await waitFor(() =>
        expect(pinsOnMap()).toEqual([
          { number: 1, ...P1, state: 'done' },
          { number: 2, ...P2, state: 'done' },
          { number: 3, ...P3, state: 'upcoming' },
        ])
      );
      const map = screen.getByTestId('map-root');
      expect(map.props.fitPins).toBe(true);
      expect(map.props.viewOnly).toBe(false);
    });

    it.each([
      ['도착 전에 건너뜀', false],
      ['도착한 뒤 건너뜀', true],
    ])('MS5 %s 계획 방문은 번호 핀(upcoming)이다', async (_label, arrived) => {
      visitsByDay[DAY1] = [
        visit({
          id: 'v1',
          day: DAY1,
          poiId: 'p1',
          planned: true,
          arrived: true,
        }),
        visit({
          id: 'v2',
          day: DAY1,
          poiId: 'p2',
          planned: true,
          arrived,
          skipped: true,
        }),
      ];

      render(<TripRecordsPage tripId={TRIP_ID} today={DAY1} />, { wrapper });

      await screen.findByTestId('record-trip-visit-card-v2');
      await waitFor(() =>
        expect(pinsOnMap()).toEqual([
          { number: 1, ...P1, state: 'done' },
          { number: 2, ...P2, state: 'upcoming' },
          { number: 3, ...P3, state: 'upcoming' },
        ])
      );
    });

    it('MS6 같은 장소(p3)의 즉석 도착은 계획 핀을 체크하지 않는다 — slotKey 로 맞춘다', async () => {
      visitsByDay[DAY1] = [
        visit({
          id: 'v1',
          day: DAY1,
          poiId: 'p1',
          planned: true,
          arrived: true,
        }),
        visit({
          id: 'v-sp3',
          day: DAY1,
          poiId: 'p3',
          planned: false,
          arrived: true,
        }),
      ];

      render(<TripRecordsPage tripId={TRIP_ID} today={DAY1} />, { wrapper });

      await screen.findByTestId('record-trip-visit-card-v-sp3');
      await waitFor(() =>
        expect(pinsOnMap()).toEqual([
          { number: 1, ...P1, state: 'done' },
          { number: 2, ...P2, state: 'upcoming' },
          { number: 3, ...P3, state: 'upcoming' },
        ])
      );
    });
  });

  describe('🔴 TRIP-1085 AC-2 · 셸 일차 칩으로 날을 바꾼다', () => {
    it('MS7 2일차 칩을 누르면 그날 기록을 조회하고 카드·핀이 2일차 것으로 바뀐다', async () => {
      render(<TripRecordsPage tripId={TRIP_ID} today={DAY1} />, { wrapper });
      await screen.findByTestId('record-trip-visit-card-v1');

      fireEvent.press(screen.getByTestId('sheet-daychip-1'));

      expect(
        await screen.findByTestId('record-trip-visit-card-v5')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('record-trip-visit-card-v1')).toBeNull();
      expect(dayHits).toContain(DAY2);
      await waitFor(() =>
        expect(pinsOnMap()).toEqual([
          { number: 1, ...P5, state: 'done' },
          { number: 2, ...P6, state: 'upcoming' },
        ])
      );
      expect(screen.getByTestId('sheet-daychip-1')).toBeSelected();
    });
  });

  describe('🔴 TRIP-1085 AC-3 · ‹ 는 뒤로 갈 곳이 있을 때만 back', () => {
    it('MS8a canGoBack 이 true 면 sheet-daychip-back 을 누를 때 back 이 1회 불린다', async () => {
      jest.mocked(router.canGoBack).mockReturnValue(true);
      render(<TripRecordsPage tripId={TRIP_ID} today={DAY1} />, { wrapper });
      await screen.findByTestId('record-trip-visit-card-v1');

      fireEvent.press(screen.getByTestId('sheet-daychip-back'));

      expect(router.back).toHaveBeenCalledTimes(1);
    });

    it('MS8b canGoBack 이 false 면 back 을 부르지 않는다', async () => {
      render(<TripRecordsPage tripId={TRIP_ID} today={DAY1} />, { wrapper });
      await screen.findByTestId('record-trip-visit-card-v1');

      fireEvent.press(screen.getByTestId('sheet-daychip-back'));

      expect(router.canGoBack).toHaveBeenCalled();
      expect(router.back).not.toHaveBeenCalled();
    });
  });
});

describe('시각·건너뛰기·메모 정비 — 서울 시계(기기 LA)', () => {
  // TRIP-1069 · TRIP-1080 (옛 TripRecordsPage.j01Records.integration.test.tsx)
  /**
   * TRIP-1069 · j01 방문 기록 정비 — **실 페이지 + 실제 HTTP(MSW)** 로 본 사용자 관측 결과.
   *
   * 무엇을 보장하나:
   *  - 시각은 서울 시계로 보인다(AC-1·AC-3). 카드는 도착 이른 순, 도착 없는 카드는 끝(AC-20).
   *  - 도착한 카드엔 '시각 수정' 버튼이 있고, 누르면 시트가 서울 시각·장소명으로 열린다(AC-4). 건너뛴
   *    카드·아직 서버에 없는 낙관 카드엔 없다(AC-5·D7).
   *  - 저장하면 PATCH 본문엔 바꾼 필드 + expectedUpdatedAt 뿐이고, 시각은 "원본 서울 날짜 + 고른 서울
   *    HH:mm" 의 UTC 순간이다(AC-6·AC-7). 충돌·실패는 화면에 알린다(AC-9, INV-4).
   *  - 도착만 한 카드에서도 메모가 실제로 저장되고, 눌러도 반응 없는 +·메모 글자는 어디에도 없다
   *    (AC-12·AC-13·AC-15). 건너뛴 카드는 라벨만 있다(AC-14). TRIP-1070 — 도착한 카드의 사진 추가 `+` 는
   *    배선된 버튼이라 폴백 집계에서 뺀다(도착 카드에만 있고 건너뛴 카드엔 없다).
   *  - 건너뛰기는 확인을 거친다 — 확정 전 요청 0회, 실패는 다이얼로그 안에 알린다(AC-16~18).
   *  - 시트·다이얼로그 어디에도 체류 시간이 없다(AC-25 · INV-3).
   *
   * 왜 이렇게 테스트하나:
   *  - 기기 시간대를 **LA 로 바꿔** 돈다. LA 기기에서 13:42Z 는 문자열 자르기=13:42, 기기 시계=06:42,
   *    서울=22:42 — 셋이 다 달라 어느 오구현도 통과하지 못한다(로컬 개발기는 KST 라 그냥 돌리면 통과).
   *  - 서버 상태를 `serverVisits` 한 곳에 둔다. PATCH·skip 핸들러가 그것을 고치고 GET 이 그것을 돌려줘서,
   *    무효화 뒤 재조회가 "서버값"을 읽는다(충돌 뒤 카드가 서버값인지 볼 수 있다).
   *  - 바텀시트 목은 children 을 무조건 그린다 → "시트가 열렸다" = 페이지가 조건부로 마운트했다. 그래서
   *    누르기 전엔 없다는 앵커를 둔다. 실제 열림·딤·다이얼로그 덮임은 6-b 실기(AC-11·AC-19).
   *
   * (개념) `within(카드).getByText('22:42')` = 그 카드 안에서만 완전 일치 Text 검색 ·
   *   `findBy*` = 나타날 때까지 기다렸다 조회 · `waitFor(fn)` = fn 이 통과할 때까지 반복 ·
   *   `server.events.on('request:start')` = 실제로 나간 요청을 "메서드 경로" 로 기록하는 관찰자.
   */
  // 이 묶음의 옛 라우터 목엔 push 가 없어, 페이지가 push 를 부르면 TypeError 로 red 였다. 합친 파일은 push 있는
  // 목을 물려받으므로 그 그물을 부재 단언으로 남긴다(1147 경고-1과 같은 자리). afterEach 안 expect 가 실패하면
  // 방금 끝난 테스트가 실패로 표시된다.
  afterEach(() => {
    expect(jest.mocked(router.push)).not.toHaveBeenCalled();
  });

  const CONFLICT_COPY = '다른 기기에서 먼저 수정됐어요';

  const FAILED_COPY = '방문 시각을 저장하지 못했어요';

  const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요|체류)/;

  const PLACES: Record<string, string> = {
    p1: '광안리 해변',
    p2: '부산시립미술관',
    p3: '웨이브온 커피',
    p4: '○○ 카페',
  };

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
        {
          date: DAY,
          slots: Object.entries(PLACES).map(([poiId, nameKo]) => ({
            poiId,
            nameKo,
            startAt: '10:00:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            tags: [] as string[],
          })),
        },
      ],
    };
  }

  type Visit = {
    visitCheckId: string;
    slotKey: string;
    poiId: string;
    arrivedAt: string | null;
    completedAt: string | null;
    skippedAt: string | null;
    source: 'MANUAL';
    spontaneous: boolean;
    updatedAt: string;
  };

  function visit(
    visitCheckId: string,
    poiId: string,
    times: Partial<
      Pick<Visit, 'arrivedAt' | 'completedAt' | 'skippedAt' | 'updatedAt'>
    >
  ): Visit {
    return {
      visitCheckId,
      slotKey: `${DAY}#${poiId}`,
      poiId,
      arrivedAt: null,
      completedAt: null,
      skippedAt: null,
      source: 'MANUAL',
      spontaneous: false,
      updatedAt: '2026-08-20T07:00:00.000Z',
      ...times,
    };
  }

  /** 완료(부산시립미술관) — 서울 14:20 도착 · 15:20 완료. */
  const V_DONE = () =>
    visit('v-done', 'p2', {
      arrivedAt: '2026-08-20T05:20:00Z',
      completedAt: '2026-08-20T06:20:00Z',
    });

  /** 도착만(광안리) — 서울 14:20 도착. */
  const V_IN = () => visit('v-in', 'p1', { arrivedAt: '2026-08-20T05:20:00Z' });

  /** 도착 후 건너뜀(웨이브온). */
  const V_SKIPPED = () =>
    visit('v-sk', 'p3', {
      arrivedAt: '2026-08-20T05:00:00Z',
      skippedAt: '2026-08-20T05:10:00Z',
    });

  let serverVisits: Visit[] = [];

  let patchBodies: Record<string, unknown>[] = [];

  let memoBodies: unknown[] = [];

  const hits = (suffix: string) =>
    observedHits.filter((hit) => hit.endsWith(suffix)).length;

  const SKIP_HIT = (id: string) => `/trips/${TRIP_ID}/visits/${id}/skip`;

  function renderPage() {
    render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });
  }

  const cardOf = (id: string) =>
    screen.getByTestId(`record-trip-visit-card-${id}`);

  const cell = (field: 'arrived' | 'completed', unit: 'h' | 'm', v: string) =>
    `record-trip-visit-time-${field}-${unit}-${v}`;

  /** 카드의 '시각 수정'을 눌러 시트가 뜰 때까지 기다린다. */
  async function openSheet(id: string) {
    await screen.findByTestId(`record-trip-visit-card-${id}`);
    fireEvent.press(
      within(cardOf(id)).getByTestId(`record-trip-visit-time-edit-${id}`)
    );
    return screen.findByTestId('record-trip-visit-time-sheet');
  }

  beforeEach(() => {
    __setDeviceTimeZone('America/Los_Angeles');
    setAccessToken('a');
    mockGetForeground.mockReset();
    mockGetForeground.mockResolvedValue({
      status: 'granted',
      granted: true,
      canAskAgain: true,
    });
    serverVisits = [];
    observedHits = [];
    patchBodies = [];
    memoBodies = [];
    server.use(
      // TRIP-1085 — 페이지가 시트 헤더 여행명을 GET /trips/{tripId} 로 얻는다.
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(tripRecordsTrip())
      ),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      ),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: serverVisits })
      ),
      http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])),
      http.get(`${BASE}/trips/:tripId/visits/:visitCheckId/photos`, () =>
        HttpResponse.json({ items: [], count: 0 })
      ),
      http.put(
        `${BASE}/trips/:tripId/visits/:visitCheckId/memo`,
        async ({ request }) => {
          const body = (await request.json()) as { text: string };
          memoBodies.push(body);
          return HttpResponse.json({
            text: body.text,
            updatedAt: '2026-08-20T08:00:00.000Z',
          });
        }
      ),
      http.patch(
        `${BASE}/trips/:tripId/visits/:visitCheckId`,
        async ({ request, params }) => {
          const body = (await request.json()) as Record<string, unknown>;
          patchBodies.push(body);
          const { expectedUpdatedAt: _ignored, ...times } = body;
          serverVisits = serverVisits.map((v) =>
            v.visitCheckId === params.visitCheckId
              ? { ...v, ...times, updatedAt: '2026-08-20T09:00:00.000Z' }
              : v
          );
          return HttpResponse.json(
            serverVisits.find((v) => v.visitCheckId === params.visitCheckId)
          );
        }
      ),
      http.post(
        `${BASE}/trips/:tripId/visits/:visitCheckId/skip`,
        ({ params }) => {
          serverVisits = serverVisits.map((v) =>
            v.visitCheckId === params.visitCheckId
              ? { ...v, skippedAt: '2026-08-20T06:00:00Z' }
              : v
          );
          return HttpResponse.json(
            serverVisits.find((v) => v.visitCheckId === params.visitCheckId)
          );
        }
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
    __setDeviceTimeZone(undefined);
  });

  describe('앵커 — 기기 시간대가 LA 로 바뀌었다', () => {
    it('2026-08-20T13:42Z 가 기기 시계로는 6시로 읽힌다', () => {
      expect(new Date('2026-08-20T13:42:00Z').getHours()).toBe(6);
    });
  });

  describe('AC-1·AC-3 · 카드 시각은 서울 시계다', () => {
    it('13:42Z → 22:42, 소수 자리 붙은 13:44:05.123456Z → 22:44 (자른 값·기기 시계 값은 어디에도 없다)', async () => {
      serverVisits = [
        visit('v1', 'p1', {
          arrivedAt: '2026-08-20T13:42:00Z',
          completedAt: '2026-08-20T14:10:00Z',
        }),
        visit('v2', 'p2', { arrivedAt: '2026-08-20T13:44:05.123456Z' }),
      ];

      renderPage();
      await screen.findByTestId('record-trip-visit-card-v2');

      expect(within(cardOf('v1')).getByText('22:42')).toBeOnTheScreen();
      expect(within(cardOf('v2')).getByText('22:44')).toBeOnTheScreen();
      for (const wrong of ['13:42', '06:42', '13:44', '06:44']) {
        expect(screen.queryByText(wrong)).toBeNull();
      }
    });
  });

  describe('AC-20 · 카드는 도착 이른 순, 도착 없는 카드는 끝', () => {
    it('서버가 [13:44, 13:42, 도착 없는 건너뜀] 으로 주면 화면은 [13:42, 13:44, 건너뜀] 이다', async () => {
      serverVisits = [
        visit('v2', 'p2', { arrivedAt: '2026-08-20T13:44:00Z' }),
        visit('v1', 'p1', {
          arrivedAt: '2026-08-20T13:42:00Z',
          completedAt: '2026-08-20T14:00:00Z',
        }),
        visit('v3', 'p3', { skippedAt: '2026-08-20T13:50:00Z' }),
      ];

      renderPage();
      await screen.findByTestId('record-trip-visit-card-v3');

      const order = screen
        .getAllByTestId(/^record-trip-visit-card-/)
        .map((node) => node.props.testID);
      expect(order).toEqual([
        'record-trip-visit-card-v1',
        'record-trip-visit-card-v2',
        'record-trip-visit-card-v3',
      ]);
    });
  });

  describe('AC-4 · 시각 수정 → 시트가 서울 시각·장소명으로 열린다', () => {
    it('완료 카드의 "시각 수정"(버튼 역할)을 누르면 14:20·15:20 이 선택되고 부제가 장소명이다', async () => {
      serverVisits = [V_DONE()];

      renderPage();
      await screen.findByTestId('record-trip-visit-card-v-done');
      // 앵커 — 누르기 전엔 시트가 없다(목은 마운트되면 항상 "열린" 상태라 마운트 여부가 곧 열림).
      expect(screen.queryByTestId('record-trip-visit-time-sheet')).toBeNull();

      const edit = within(cardOf('v-done')).getByTestId(
        'record-trip-visit-time-edit-v-done'
      );
      expect(edit.props.accessibilityRole).toBe('button');
      fireEvent.press(edit);

      expect(
        await screen.findByTestId('record-trip-visit-time-sheet')
      ).toBeOnTheScreen();
      expect(screen.getByTestId(cell('arrived', 'h', '14'))).toBeSelected();
      expect(screen.getByTestId(cell('arrived', 'm', '20'))).toBeSelected();
      expect(screen.getByTestId(cell('completed', 'h', '15'))).toBeSelected();
      expect(screen.getByTestId(cell('completed', 'm', '20'))).toBeSelected();
      expect(
        screen.getByTestId('record-trip-visit-time-place')
      ).toHaveTextContent('부산시립미술관');
    });
  });

  describe('AC-5·AC-14 · D4 · 건너뛴 카드는 라벨만', () => {
    it('건너뛴 카드엔 시각 수정·건너뛰기·메모·사진이 없고 "건너뜀" 라벨이 있다', async () => {
      serverVisits = [V_IN(), V_SKIPPED()];

      renderPage();
      await screen.findByTestId('record-trip-visit-card-v-sk');
      // 짝 앵커 — 도착만 한 카드엔 시각 수정이 있다(부재 단언이 공허하지 않게).
      await waitFor(() =>
        expect(
          within(cardOf('v-in')).getByTestId('record-trip-visit-time-edit-v-in')
        ).toBeOnTheScreen()
      );

      const skipped = cardOf('v-sk');
      expect(
        within(skipped).queryByTestId('record-trip-visit-time-edit-v-sk')
      ).toBeNull();
      expect(
        within(skipped).queryByTestId('record-visit-skip-v-sk')
      ).toBeNull();
      expect(
        within(skipped).queryByTestId('record-trip-memo-input')
      ).toBeNull();
      expect(
        within(skipped).queryByTestId('record-trip-photo-strip')
      ).toBeNull();
      expect(
        within(
          within(skipped).getByTestId('record-visit-skipped-label-v-sk')
        ).getByText('건너뜀')
      ).toBeOnTheScreen();
    });
  });

  describe('D7 · 서버에 아직 없는 낙관 카드엔 시각 수정이 없다', () => {
    it('계획 행 "방문 체크" 응답 대기 중 낙관 카드엔 없고, 응답으로 실 카드가 되면 선다', async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.post(`${BASE}/trips/:tripId/visits`, async () => {
          await gate;
          return HttpResponse.json(
            visit('v-p4', 'p4', { arrivedAt: '2026-08-20T05:00:00Z' }),
            { status: 201 }
          );
        })
      );

      renderPage();
      fireEvent.press(
        await screen.findByTestId(`record-trip-plan-check-${DAY}#p4`)
      );

      // 낙관 순간 — 카드는 섰지만(앵커) 시각 수정은 없다(누르면 PATCH 가 없는 id 로 간다).
      const optimistic = await screen.findByTestId(
        'record-trip-visit-card-optimistic:p4'
      );
      expect(
        within(optimistic).queryByTestId(
          'record-trip-visit-time-edit-optimistic:p4'
        )
      ).toBeNull();

      // 짝 — 응답이 오면 실 카드엔 선다("영원히 끔" 오구현 차단).
      release();
      await screen.findByTestId('record-trip-visit-card-v-p4');
      await waitFor(() =>
        expect(
          within(cardOf('v-p4')).getByTestId('record-trip-visit-time-edit-v-p4')
        ).toBeOnTheScreen()
      );
    });
  });

  describe('AC-6·AC-7 · 저장 → PATCH 본문', () => {
    it('도착 시만 13 으로 → 본문 키는 arrivedAt·expectedUpdatedAt 뿐, 04:20Z 순간, 그 뒤 시트가 닫히고 카드는 13:20', async () => {
      serverVisits = [
        visit('v-done', 'p2', {
          arrivedAt: '2026-08-20T05:20:00Z',
          // 초·소수가 붙은 완료 — 분이 안 바뀌었으니 실리면 안 된다(AC-7).
          completedAt: '2026-08-20T06:00:59.999Z',
          updatedAt: '2026-08-20T06:01:00.000Z',
        }),
      ];

      renderPage();
      await openSheet('v-done');
      fireEvent.press(screen.getByTestId(cell('arrived', 'h', '13')));
      fireEvent.press(screen.getByTestId('record-trip-visit-time-save'));

      await waitFor(() => expect(patchBodies).toHaveLength(1));
      const body = patchBodies[0]!;
      expect(Object.keys(body).sort()).toEqual([
        'arrivedAt',
        'expectedUpdatedAt',
      ]);
      expect(body.arrivedAt).toMatch(/Z$/);
      expect(Date.parse(body.arrivedAt as string)).toBe(
        Date.parse('2026-08-20T04:20:00Z')
      );
      expect(body.expectedUpdatedAt).toBe('2026-08-20T06:01:00.000Z');

      await waitFor(() =>
        expect(screen.queryByTestId('record-trip-visit-time-sheet')).toBeNull()
      );
      await waitFor(() =>
        expect(within(cardOf('v-done')).getByText('13:20')).toBeOnTheScreen()
      );
      // D6 — 성공은 안내 없이 시트 닫힘으로 충분하다.
      expect(screen.queryByTestId('record-trip-visit-time-result')).toBeNull();
      expect(patchBodies).toHaveLength(1);
    });

    it('서울 01:30(UTC 전날 16:30) 방문 — 카드는 01:30, 분만 45 로 저장하면 전날 16:45Z 순간이다', async () => {
      serverVisits = [
        visit('v-early', 'p1', { arrivedAt: '2026-08-19T16:30:00Z' }),
      ];

      renderPage();
      await screen.findByTestId('record-trip-visit-card-v-early');
      expect(within(cardOf('v-early')).getByText('01:30')).toBeOnTheScreen();

      await openSheet('v-early');
      expect(screen.getByTestId(cell('arrived', 'h', '01'))).toBeSelected();
      expect(screen.getByTestId(cell('arrived', 'm', '30'))).toBeSelected();
      fireEvent.press(screen.getByTestId(cell('arrived', 'm', '45')));
      fireEvent.press(screen.getByTestId('record-trip-visit-time-save'));

      await waitFor(() => expect(patchBodies).toHaveLength(1));
      expect(Date.parse(patchBodies[0]!.arrivedAt as string)).toBe(
        Date.parse('2026-08-19T16:45:00Z')
      );
      expect(patchBodies[0]).not.toHaveProperty('completedAt');
    });
  });

  describe('AC-9 · 저장 결과 안내', () => {
    it('409 VISIT_CONFLICT → "다른 기기에서 먼저 수정됐어요" + 카드는 재조회한 서버값(13:00)', async () => {
      serverVisits = [V_IN()];
      server.use(
        http.patch(`${BASE}/trips/:tripId/visits/:visitCheckId`, () => {
          // 그사이 다른 기기가 도착을 서울 13:00 으로 고쳐 두었다.
          serverVisits = [
            visit('v-in', 'p1', {
              arrivedAt: '2026-08-20T04:00:00Z',
              updatedAt: '2026-08-20T08:30:00.000Z',
            }),
          ];
          return HttpResponse.json(
            { error: { code: 'VISIT_CONFLICT', message: 'stale' } },
            { status: 409 }
          );
        })
      );

      renderPage();
      await openSheet('v-in');
      fireEvent.press(screen.getByTestId(cell('arrived', 'h', '13')));
      fireEvent.press(screen.getByTestId('record-trip-visit-time-save'));

      expect(
        await screen.findByTestId('record-trip-visit-time-result')
      ).toHaveTextContent(CONFLICT_COPY);
      await waitFor(() =>
        expect(within(cardOf('v-in')).getByText('13:00')).toBeOnTheScreen()
      );
    });

    it.each([
      [
        '404',
        () =>
          HttpResponse.json(
            { error: { code: 'VISIT_NOT_FOUND', message: 'gone' } },
            { status: 404 }
          ),
      ],
      ['네트워크', () => HttpResponse.error()],
    ])(
      '%s 실패 → "방문 시각을 저장하지 못했어요" + 카드는 원래 14:20 으로 돌아온다',
      async (_label, respond) => {
        serverVisits = [V_IN()];
        server.use(
          http.patch(`${BASE}/trips/:tripId/visits/:visitCheckId`, respond)
        );

        renderPage();
        await openSheet('v-in');
        fireEvent.press(screen.getByTestId(cell('arrived', 'h', '13')));
        fireEvent.press(screen.getByTestId('record-trip-visit-time-save'));

        expect(
          await screen.findByTestId('record-trip-visit-time-result')
        ).toHaveTextContent(FAILED_COPY);
        await waitFor(() =>
          expect(within(cardOf('v-in')).getByText('14:20')).toBeOnTheScreen()
        );
        expect(within(cardOf('v-in')).queryByText('13:20')).toBeNull();
      }
    );
  });

  describe('AC-12·AC-13·AC-15 · 메모 실배선 + 무반응 폴백 0', () => {
    it('도착만 한 카드에서 메모를 쓰고 포커스를 빼면 PUT memo 1회, 페이지 어디에도 정적 +·메모 글자가 없다', async () => {
      serverVisits = [V_DONE(), V_IN(), V_SKIPPED()];

      renderPage();
      await screen.findByTestId('record-trip-visit-card-v-in');
      const memo = await waitFor(() =>
        within(cardOf('v-in')).getByTestId('record-trip-memo-input')
      );

      fireEvent.changeText(memo, '파도 소리가 좋았다');
      // TRIP-1078 — 저장 경로는 blur 하나(실기 iOS multiline 은 submitEditing 을 안 낸다).
      fireEvent(memo, 'blur');

      await waitFor(() => expect(memoBodies).toHaveLength(1));
      expect(memoBodies[0]).toMatchObject({ text: '파도 소리가 좋았다' });
      expect(hits(`/visits/v-in/memo`)).toBe(1);

      // AC-13·AC-15 — 계획 행(○○ 카페)까지 선 페이지 전체에서 정적 폴백 0.
      expect(
        screen.getByTestId(`record-trip-plan-row-${DAY}#p4`)
      ).toBeOnTheScreen();
      expect(screen.queryByText('메모를 남겨보세요')).toBeNull();
      // TRIP-1072 — 오늘 탭엔 [방문 추가] 버튼이 같은 ＋ 글리프를 그린다(Figma 1557:1799).
      // TRIP-1070 — 도착 카드의 사진 추가 타일(record-trip-photo-add)도 배선된 ＋ 다. 두 버튼 밖의 ＋ 만 센다.
      const wiredPlusOwners = [
        screen.getByTestId('record-trip-spontaneous-add'),
        ...screen.getAllByTestId('record-trip-photo-add'),
      ];
      const plusOutsideWired = screen
        .UNSAFE_queryAllByType(PlusGlyph)
        .filter((glyph) => {
          for (let node = glyph.parent; node; node = node.parent) {
            if (wiredPlusOwners.includes(node)) return false;
          }
          return true;
        });
      expect(plusOutsideWired).toHaveLength(0);
      // 사진 추가 타일은 도착한 카드(완료·관람 중)에만 있고, 건너뛴 카드엔 없다.
      expect(
        within(cardOf('v-done')).getByTestId('record-trip-photo-add')
      ).toBeOnTheScreen();
      expect(
        within(cardOf('v-in')).getByTestId('record-trip-photo-add')
      ).toBeOnTheScreen();
      expect(
        within(cardOf('v-sk')).queryByTestId('record-trip-photo-add')
      ).toBeNull();
    });
  });

  describe('AC-16·AC-17 · 건너뛰기는 확인을 거친다', () => {
    it('누르면 다이얼로그만 뜨고(요청 0), 취소하면 닫히고(요청 0), 확정하면 skip 1회 뒤 건너뜀 라벨', async () => {
      serverVisits = [V_IN()];

      renderPage();
      await screen.findByTestId('record-trip-visit-card-v-in');
      const skip = within(cardOf('v-in')).getByTestId('record-visit-skip-v-in');
      expect(skip.props.accessibilityRole).toBe('button');
      expect(skip).toHaveTextContent('건너뛰기');

      // 실행 ① — 누르면 확인 다이얼로그만.
      fireEvent.press(skip);
      expect(
        await screen.findByTestId('record-visit-skip-dialog')
      ).toBeOnTheScreen();
      expect(hits(SKIP_HIT('v-in'))).toBe(0);
      // 확정 전엔 낙관 건너뜀도 없다(먼저 skip 을 부르고 다이얼로그를 띄우는 오구현 차단).
      expect(
        screen.queryByTestId('record-visit-skipped-label-v-in')
      ).toBeNull();

      // 실행 ② — 취소.
      fireEvent.press(screen.getByTestId('record-visit-skip-dialog-cancel'));
      await waitFor(() =>
        expect(screen.queryByTestId('record-visit-skip-dialog')).toBeNull()
      );
      expect(hits(SKIP_HIT('v-in'))).toBe(0);

      // 실행 ③ — 다시 눌러 확정.
      fireEvent.press(
        within(cardOf('v-in')).getByTestId('record-visit-skip-v-in')
      );
      fireEvent.press(
        await screen.findByTestId('record-visit-skip-dialog-confirm')
      );

      await waitFor(() => expect(hits(SKIP_HIT('v-in'))).toBe(1));
      await waitFor(() =>
        expect(screen.queryByTestId('record-visit-skip-dialog')).toBeNull()
      );
      expect(
        await screen.findByTestId('record-visit-skipped-label-v-in')
      ).toBeOnTheScreen();
    });
  });

  describe('AC-18 · 건너뛰기 실패는 다이얼로그 안에 알린다', () => {
    it.each([
      [
        '409',
        () =>
          HttpResponse.json(
            { error: { code: 'VISIT_CONFLICT', message: 'conflict' } },
            { status: 409 }
          ),
      ],
      [
        '404',
        () =>
          HttpResponse.json(
            { error: { code: 'VISIT_NOT_FOUND', message: 'gone' } },
            { status: 404 }
          ),
      ],
      ['네트워크', () => HttpResponse.error()],
    ])(
      '%s → 오류 문구가 다이얼로그 안에 서고 다이얼로그는 남는다',
      async (_label, respond) => {
        serverVisits = [V_IN()];
        server.use(
          http.post(`${BASE}/trips/:tripId/visits/:visitCheckId/skip`, respond)
        );

        renderPage();
        await screen.findByTestId('record-trip-visit-card-v-in');
        fireEvent.press(
          within(cardOf('v-in')).getByTestId('record-visit-skip-v-in')
        );
        fireEvent.press(
          await screen.findByTestId('record-visit-skip-dialog-confirm')
        );

        const dialog = await screen.findByTestId('record-visit-skip-dialog');
        await waitFor(() =>
          expect(
            within(dialog).getByTestId('record-visit-skip-dialog-error')
          ).toBeOnTheScreen()
        );
        expect(hits(SKIP_HIT('v-in'))).toBe(1);
      }
    );
  });

  /**
   * 5-b 보강(03b W1) — 확정한 뒤 응답이 오기 전에는 다이얼로그를 닫을 수 없다.
   * 이 창에서 [취소]가 먹으면 요청은 계속 가서 실제로 건너뛰어지는데 사용자는 취소했다고 믿고, 늦게 온 결과가
   * 그사이 연 다른 카드의 다이얼로그를 덮는다(대상 뒤바뀜). 계약: 대기 중 [취소]는 비활성 + 눌러도 무변화.
   * 비활성은 `toBeDisabled`(조상도 본다) 대신 버튼 자신의 `accessibilityState.disabled` 로 읽는다.
   * 응답은 promise 로 묶어 대기 창을 붙잡는다(D7 의 gate 선례).
   */
  describe('5-b 보강 W1 · 건너뛰기 응답 대기 중엔 다이얼로그를 닫을 수 없다', () => {
    it('확정 뒤 응답 전 [취소]는 비활성이고 눌러도 다이얼로그가 남는다 — 실패 응답이 오면 오류와 함께 다시 닫을 수 있다', async () => {
      serverVisits = [V_IN()];
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.post(
          `${BASE}/trips/:tripId/visits/:visitCheckId/skip`,
          async () => {
            await gate;
            return HttpResponse.error();
          }
        )
      );

      renderPage();
      await screen.findByTestId('record-trip-visit-card-v-in');
      fireEvent.press(
        within(cardOf('v-in')).getByTestId('record-visit-skip-v-in')
      );
      // 짝 앵커 — 확정 전 [취소]는 살아 있다(항상 비활성인 오구현 차단).
      expect(
        (await screen.findByTestId('record-visit-skip-dialog-cancel')).props
          .accessibilityState?.disabled
      ).not.toBe(true);

      fireEvent.press(screen.getByTestId('record-visit-skip-dialog-confirm'));
      await waitFor(() => expect(hits(SKIP_HIT('v-in'))).toBe(1));

      // 대기 창 — [취소]는 비활성이고, 눌러도 다이얼로그가 닫히지 않는다.
      const cancel = screen.getByTestId('record-visit-skip-dialog-cancel');
      expect(cancel.props.accessibilityState?.disabled).toBe(true);
      fireEvent.press(cancel);
      expect(screen.getByTestId('record-visit-skip-dialog')).toBeOnTheScreen();

      // 응답(실패)이 오면 다이얼로그 안에 오류가 서고, 이제 [취소]로 닫을 수 있다.
      release();
      expect(
        await screen.findByTestId('record-visit-skip-dialog-error')
      ).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId('record-visit-skip-dialog-cancel'));
      await waitFor(() =>
        expect(screen.queryByTestId('record-visit-skip-dialog')).toBeNull()
      );
      expect(hits(SKIP_HIT('v-in'))).toBe(1);
    });
  });

  /**
   * 5-b 보강(03b N2) — 서버에 아직 없는 낙관 카드는 건너뛰기·완료도 누를 수 없다(D7 을 시각 수정 밖으로 넓힘).
   * 낙관 id 로 skip·complete 가 나가면 404 가 되고, 완료 쪽은 실패가 삼켜진다.
   */
  describe('5-b 보강 N2 · 낙관 카드엔 건너뛰기·완료 체크가 없다', () => {
    it('계획 행 "방문 체크" 응답 대기 중 낙관 카드엔 없고, 응답으로 실 카드가 되면 둘 다 선다', async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.post(`${BASE}/trips/:tripId/visits`, async () => {
          await gate;
          return HttpResponse.json(
            visit('v-p4', 'p4', { arrivedAt: '2026-08-20T05:00:00Z' }),
            { status: 201 }
          );
        })
      );

      renderPage();
      fireEvent.press(
        await screen.findByTestId(`record-trip-plan-check-${DAY}#p4`)
      );

      const optimistic = await screen.findByTestId(
        'record-trip-visit-card-optimistic:p4'
      );
      expect(
        within(optimistic).queryByTestId('record-visit-skip-optimistic:p4')
      ).toBeNull();
      expect(
        within(optimistic).queryByTestId(
          'record-visit-check-active-optimistic:p4'
        )
      ).toBeNull();

      // 짝 — 실 카드엔 둘 다 선다("낙관이 아니어도 끔" 오구현 차단).
      release();
      await screen.findByTestId('record-trip-visit-card-v-p4');
      await waitFor(() => {
        expect(
          within(cardOf('v-p4')).getByTestId('record-visit-skip-v-p4')
        ).toBeOnTheScreen();
        expect(
          within(cardOf('v-p4')).getByTestId('record-visit-check-active-v-p4')
        ).toBeOnTheScreen();
      });
    });
  });

  describe('AC-25 · INV-3 — 시트·다이얼로그 어디에도 체류 시간이 없다', () => {
    it('시트를 연 화면과 건너뛰기 다이얼로그를 연 화면 모두 N분·N시간·소요·체류 0건', async () => {
      serverVisits = [V_DONE(), V_IN(), V_SKIPPED()];

      renderPage();
      await openSheet('v-done');
      // TRIP-1085 — 셸 list 경로에선 `JSON.stringify(screen.toJSON())` 가 순환 참조로 죽는다(FlatList 가
      // 헤더·푸터 엘리먼트를 호스트 props 로 흘린다). 화면의 Text 글자만 모아 본다.
      const withSheet = renderedText(screen.UNSAFE_root);
      expect(withSheet).toContain('부산시립미술관');
      expect(DURATION_TEXT.test(withSheet)).toBe(false);

      fireEvent.press(screen.getByTestId('record-trip-visit-time-cancel'));
      fireEvent.press(
        within(cardOf('v-in')).getByTestId('record-visit-skip-v-in')
      );
      await screen.findByTestId('record-visit-skip-dialog');
      const withDialog = renderedText(screen.UNSAFE_root);
      expect(DURATION_TEXT.test(withDialog)).toBe(false);
    });
  });

  /**
   * TRIP-1080 · 시트를 딤으로 닫아도 다시 열리고, 다른 카드로 바꾸면 그 카드 값으로 열린다.
   *
   * 왜: 라이브러리가 딤 탭으로 시트를 닫아도 페이지의 "편집 중" 상태가 그대로면 '시각 수정'을 다시 눌러도
   * 아무 일도 안 일어난다(INV-4 무반응). 또 시트가 떠 있는 채 다른 카드를 누르면, 시트는 처음 받은 값만
   * 기억하므로(`useState` 초깃값은 첫 마운트에서만 읽힌다) 이전 카드 시각이 그대로 보인다.
   *
   * 무엇을 보장하나:
   *  - P1·P2 닫힘 신호 뒤 시트가 사라지고, 같은 카드·다른 카드 어느 쪽을 눌러도 그 카드 시각으로 다시 뜬다.
   *  - P3 시트가 떠 있는 채 다른 카드를 누르면 그 카드 시각으로 바뀐다(`key` 리마운트의 유일한 심판).
   *  - P4 휠을 현재 위치에 멈추고 저장하면 PATCH 가 안 나가고, 휠로 바꿔 저장하면 PATCH 1회로 반영된다.
   *
   * ⚠️ `fireEvent(시트, 'close')` 는 딤 탭의 대역이다 — `onClose` 를 못 찾으면 조용히 끝나므로, "닫힌 뒤
   *   부재"를 다시 누르기 **전에** 먼저 본다(02a ★6). 실제 딤 탭은 6-b 실기.
   *
   * 3동작 뼈대: 준비=두 카드 서버 상태 → 실행=열기·닫힘 신호·다른 카드 탭·휠 정지·저장 → 단언=시트 개수·선택 셀·PATCH 본문.
   */
  describe('🔴 TRIP-1080 · 시트 닫힘·재오픈·카드 전환·휠 저장', () => {
    const SHEET = 'record-trip-visit-time-sheet';
    /** 도착만(광안리) — 서울 10:05. A(V_DONE, 14:20·15:20)와 시·분이 모두 다르다. */
    const V_B = () => visit('v-b', 'p1', { arrivedAt: '2026-08-20T01:05:00Z' });

    const pressEdit = (id: string) =>
      fireEvent.press(
        within(cardOf(id)).getByTestId(`record-trip-visit-time-edit-${id}`)
      );
    const settleArrivedHour = (index: number) =>
      fireEvent(
        screen.getByTestId('record-trip-visit-time-arrived-h-wheel'),
        'momentumScrollEnd',
        {
          nativeEvent: {
            contentOffset: { x: 0, y: index * WHEEL_CELL_HEIGHT },
          },
        }
      );

    it('P1 · AC-5 — 딤으로 닫은 뒤 같은 카드를 다시 누르면 시트가 1개로 다시 뜨고 14:20 이 선택돼 있다', async () => {
      serverVisits = [V_DONE(), V_B()];
      renderPage();
      await openSheet('v-done');

      fireEvent(screen.getByTestId(SHEET), 'close');
      // 앵커 — 먼저 닫혔어야 "다시 열림"이 뜻을 가진다.
      expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen();

      pressEdit('v-done');

      expect(screen.getAllByTestId(SHEET).length).toBe(1);
      expect(screen.getByTestId(cell('arrived', 'h', '14'))).toBeSelected();
      expect(screen.getByTestId(cell('arrived', 'm', '20'))).toBeSelected();
    });

    it('P2 · AC-5 짝 — 딤으로 닫은 뒤 다른 카드를 누르면 그 카드 시각(10:05)으로 뜬다', async () => {
      serverVisits = [V_DONE(), V_B()];
      renderPage();
      await openSheet('v-done');

      fireEvent(screen.getByTestId(SHEET), 'close');
      expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen();

      pressEdit('v-b');

      expect(screen.getAllByTestId(SHEET).length).toBe(1);
      expect(screen.getByTestId(cell('arrived', 'h', '10'))).toBeSelected();
      expect(screen.getByTestId(cell('arrived', 'm', '05'))).toBeSelected();
    });

    it('P3 · AC-6 — 시트가 떠 있는 채 다른 카드를 누르면 시트는 1개, 그 카드 시각(10:05)이고 이전 카드(14:20)는 아니다', async () => {
      serverVisits = [V_DONE(), V_B()];
      renderPage();
      await openSheet('v-done');
      expect(screen.getByTestId(cell('arrived', 'h', '14'))).toBeSelected();

      pressEdit('v-b');

      expect(screen.getAllByTestId(SHEET).length).toBe(1);
      expect(screen.getByTestId(cell('arrived', 'h', '10'))).toBeSelected();
      expect(screen.getByTestId(cell('arrived', 'm', '05'))).toBeSelected();
      expect(screen.getByTestId(cell('arrived', 'h', '14'))).not.toBeSelected();
      expect(screen.getByTestId(cell('arrived', 'm', '20'))).not.toBeSelected();
    });

    it('P4 · AC-2·AC-7·AC-9 — 현재 위치에서 멈춘 저장은 PATCH 0, 휠로 13 에 멈춘 저장은 PATCH 1회(04:20Z)', async () => {
      serverVisits = [V_DONE()];
      renderPage();

      // ① 무변경 — 도착 시 휠이 현재 값(14)에서 멈춘 채 저장. 시트는 닫힌다(무반응 아님).
      await openSheet('v-done');
      settleArrivedHour(14);
      fireEvent.press(screen.getByTestId('record-trip-visit-time-save'));
      await waitFor(() =>
        expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen()
      );

      // ② 진짜 변경 — 다시 열어 13 에서 멈추고 저장.
      await openSheet('v-done');
      settleArrivedHour(13);
      fireEvent.press(screen.getByTestId('record-trip-visit-time-save'));

      await waitFor(() => expect(patchBodies.length).toBeGreaterThanOrEqual(1));
      // 순서 앵커 — ①이 헛 PATCH 를 냈다면 ②보다 먼저 도착해 여기서 2개다(02a ★8).
      expect(patchBodies.length).toBe(1);
      const body = patchBodies[0]!;
      expect(Date.parse(body.arrivedAt as string)).toBe(
        Date.parse('2026-08-20T04:20:00Z')
      );
      await waitFor(() =>
        expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen()
      );
    });
  });
});

describe('수동 체크인 모드 — 권한 없음 → 배너·「방문 체크」 → arrive', () => {
  // TRIP-761 (옛 TripRecordsPage.manualCheckin.integration.test.tsx)
  /**
   * 🔴 TRIP-761 · AC-1·AC-2·AC-3·AC-4·AC-5 — j01 manual-checkin **모드 seam + arrive 배선**(완료조건).
   *
   * 위치 권한이 없으면(수동 체크인 모드) 페이지가 expo-location 권한을 읽어 `manualCheckin` 을 화면·카드로
   * 내리고, UPCOMING 카드의 "방문 체크" press 를 `arrive({source:'MANUAL', poiId})` 로 배선한다.
   *
   * 무엇을 보장하나(관측 가능한 결과만):
   *  - 🔴 AC-1·AC-3·AC-4  denied → 배너·⊘ 배지·"방문 체크" pill 이 실 라우트에서 뜬다(모드 판정=페이지).
   *  - 🔴 AC-2  denied → 안내문이 manual 카피(법 문구 "(좌표 자동기록 비활성)" 포함)로 교체되고 default 는 사라진다.
   *  - 🟢 AC-1·AC-3·AC-4 무회귀  granted → 세 표면 전부 부재 + 안내문은 현행 default(일반 모드 무변경).
   *  - 🔴 AC-5  denied + pill press → POST /trips/:tripId/visits 가 `{slotKey, source:'MANUAL', poiId}` 로 **정확히 1회**
   *            나간다(TRIP-1021 — 슬롯 키를 빼면 즉석 방문으로 기록되는 버그를 본문 정확 일치로 잡는다).
   *
   * ★모드 seam(02a §4-★6): 페이지가 `getForegroundPermissionsAsync`(LocationPage 선례)를 읽어 `!granted` 면
   *   manual 모드로 판정. integration 은 그 목의 반환값(denied/granted)으로 모드를 강제한다(프리뷰는 prop 직접).
   * ★arrive=재사용(02a §4-★4): "방문 체크"는 새 HTTP 가 아니라 기존 `postTripsTripIdVisits`(arrive) 를 쓴다 —
   *   POST 본문의 `source:'MANUAL'` 을 정확 단언한다(`ArriveRequestSource.MANUAL` 스키마 실존, BR-U4-36).
   *   arrive 는 무효화 대신 응답으로 낙관 레코드를 교체하므로 POST 는 1회뿐(useVisitCheck 비대칭).
   * ★별 파일(02a §4-★9): 기존 `TripRecordsPage.integration.test.tsx`(759, expo-location 목 없음)를 안 건드린다 —
   *   expo-location 목은 파일 전역이라 얹으면 blast-radius 가 커진다. 신 파일로 격리(무회귀 명료).
   * ★카드 소스(02a §4-★8): UPCOMING 카드는 **방문 쿼리**의 세 timestamp null 레코드(v-up)에서 온다(itinerary
   *   슬롯 아님) — 픽스처가 그날 UPCOMING 방문 1건을 넣어야 ○○ 카페 카드·pill 이 뜬다.
   *
   * (개념) `getForegroundPermissionsAsync`=권한을 "다시 묻지 않고 현재 상태만 조회"(LocationPage 선례) ·
   *   `findByTestId`=비동기 등장 대기 후 조회(권한 effect + 쿼리 완료까지) · `objectContaining({...})`=본문의
   *   부분집합 일치(slotKey 등 추가 필드 허용, seed §3-a 는 source·poiId 만 확정) · `waitFor`=조건 만족까지 폴링.
   */
  // 이 묶음의 옛 라우터 목엔 push 가 없어, 페이지가 push 를 부르면 TypeError 로 red 였다. 합친 파일은 push 있는
  // 목을 물려받으므로 그 그물을 부재 단언으로 남긴다(1147 경고-1과 같은 자리). afterEach 안 expect 가 실패하면
  // 방금 끝난 테스트가 실패로 표시된다.
  afterEach(() => {
    expect(jest.mocked(router.push)).not.toHaveBeenCalled();
  });

  const DEFAULT_NOTICE = '오늘의 동선 · 방문한 곳을 사진과 메모로 남겨요';

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
      days: [{ date: DAY, slots: [daySlot('p3', '○○ 카페')] }],
    };
  }

  /** 미방문(UPCOMING) 방문 1건 — 세 timestamp null → 카드가 UPCOMING 으로 파생돼 "방문 체크" pill 진입점이 된다. */
  function upcomingVisit() {
    return {
      visitCheckId: 'v-up',
      slotKey: `${DAY}#p3`,
      poiId: 'p3',
      arrivedAt: null,
      completedAt: null,
      skippedAt: null,
      source: null,
      spontaneous: false,
      updatedAt: `${DAY}T00:00:00`,
    };
  }

  /** POST /visits 응답 — arrive 가 낙관 레코드를 이걸로 교체한다(무효화 없음). */
  function createdVisit() {
    return {
      visitCheckId: 'v-created',
      slotKey: `${DAY}#p3`,
      poiId: 'p3',
      arrivedAt: `${DAY}T14:20:00`,
      completedAt: null,
      skippedAt: null,
      source: 'MANUAL',
      spontaneous: false,
      updatedAt: `${DAY}T14:20:00`,
    };
  }

  /** POST /visits 로 나간 본문을 쌓는다 — AC-5 arrive 인자 트립와이어. */
  const postBodies: unknown[] = [];

  beforeEach(() => {
    setAccessToken('a');
    postBodies.length = 0;
    mockGetForeground.mockReset();
    // 페이지가 마운트에 쏘는 GET 전부 + arrive POST 를 등록(onUnhandledRequest:'error' 라 누락 시 크래시).
    server.use(
      // TRIP-1085 — 페이지가 시트 헤더 여행명을 GET /trips/{tripId} 로 얻는다.
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(tripRecordsTrip())
      ),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      ),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: [upcomingVisit()] })
      ),
      http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])),
      // TRIP-1069 D3 — 도착한 카드도 사진·메모 컨테이너로 그려져 카드마다 사진 목록을 조회한다.
      http.get(`${BASE}/trips/:tripId/visits/:visitCheckId/photos`, () =>
        HttpResponse.json({ items: [], count: 0 })
      ),
      http.post(`${BASE}/trips/:tripId/visits`, async ({ request }) => {
        postBodies.push(await request.json());
        return HttpResponse.json(createdVisit());
      })
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  describe('🔴 TRIP-761 · AC-1·AC-3·AC-4 · denied → manual 모드 표면이 뜬다', () => {
    it('C-mode-denied · 배너·⊘ 배지·"방문 체크" pill 이 실 라우트에서 present', async () => {
      mockGetForeground.mockResolvedValue(DENIED);

      render(<TripRecordsPage tripId={TRIP_ID} />, { wrapper });

      // 준비/실행 — 권한 effect + 방문 쿼리가 끝나면 배너가 마운트된다.
      expect(await screen.findByTestId('record-gps-banner')).toBeTruthy();

      // 단언 — 세 manual 표면이 함께 뜬다(모드가 화면·카드로 하향).
      expect(screen.getByTestId('record-map-gps-off')).toBeTruthy();
      // 배너(권한 effect)와 pill(방문 쿼리)은 도착 시점이 달라 pill 은 따로 기다린다 — CI 에서 레이스 실측.
      expect(
        await screen.findByTestId('record-visit-manual-check-v-up')
      ).toBeTruthy();
    });
  });

  describe('🔴 TRIP-761 · AC-2 · denied → 안내문 manual 카피로 교체', () => {
    it('C-mode-notice · manual 카피가 뜨고 default 는 사라진다(상호배타)', async () => {
      mockGetForeground.mockResolvedValue(DENIED);

      render(<TripRecordsPage tripId={TRIP_ID} />, { wrapper });

      // 실행 — manual 모드로 전환되면 안내문이 바뀐다.
      expect(await screen.findByText(MANUAL_NOTICE)).toBeTruthy();

      // 단언 — 법 문구를 담은 manual 카피가 뜨고, 현행 default 는 부재.
      expect(screen.queryByText(DEFAULT_NOTICE)).toBeNull();
    });
  });

  describe('🟢 TRIP-761 · AC-1·AC-3·AC-4 무회귀 · granted → 일반 모드', () => {
    it('C-mode-granted · manual 표면 전부 부재 + 안내문은 현행 default', async () => {
      mockGetForeground.mockResolvedValue(GRANTED);

      render(<TripRecordsPage tripId={TRIP_ID} />, { wrapper });

      // 실행 — 방문 카드가 그려질 때까지 대기(그 시점엔 권한 effect 도 flush 됐다).
      await screen.findByText('○○ 카페');

      // 단언 — granted 는 manual 모드가 아니므로 세 표면이 전부 없고, 안내문은 일반 default.
      expect(screen.queryByTestId('record-gps-banner')).toBeNull();
      expect(screen.queryByTestId('record-map-gps-off')).toBeNull();
      expect(screen.queryByTestId('record-visit-manual-check-v-up')).toBeNull();
      expect(screen.getByText(DEFAULT_NOTICE)).toBeTruthy();
    });
  });

  describe('🔴 TRIP-761 · AC-5 · "방문 체크" press → arrive({source:MANUAL}) POST', () => {
    it('C-arrive · POST /trips/:tripId/visits 가 {slotKey, source:"MANUAL", poiId:"p3"} 로 정확히 1회 나간다 (TRIP-1021 맹점 ①)', async () => {
      mockGetForeground.mockResolvedValue(DENIED);

      render(<TripRecordsPage tripId={TRIP_ID} />, { wrapper });

      // 준비 — manual 모드 UPCOMING 카드의 pill 이 뜰 때까지 대기.
      const pill = await screen.findByTestId('record-visit-manual-check-v-up');

      // 실행 — pill press → onPressManualCheck(poiId) → arrive({source:'MANUAL', poiId}) → POST.
      fireEvent.press(pill);

      // 단언 — POST 가 정확히 1회, 본문은 카드의 슬롯 키까지 실은 수동 도착 **정확히**(TRIP-1021 맹점 ①:
      // 슬롯 키가 빠지면 서버가 "계획에 없던 곳" 즉석 방문으로 기록한다 — 옛 objectContaining 은 그걸 통과시켰다).
      await waitFor(() => expect(postBodies).toHaveLength(1));
      expect(postBodies[0]).toEqual({
        slotKey: `${DAY}#p3`,
        source: 'MANUAL',
        poiId: 'p3',
      });
    });
  });
});

describe('계획 행 — 조인·「방문 체크」 도착·조회 실패·오늘만·재시도', () => {
  // TRIP-1021 (옛 TripRecordsPage.planRows.integration.test.tsx)
  /**
   * TRIP-1021 #086 · AC-10·AC-11·AC-13·AC-14 — j01 계획 행의 **조인과 도착 배선**(실제 HTTP).
   *
   * 무엇을 보장하나:
   *  - R1  그날 방문 0건이면 빈 상태 안내 + 계획 슬롯마다 행. 수동 모드 부제(법 문구)는 그대로 있다.
   *  - R2  수동 모드에서 계획 행 "방문 체크" → `POST /visits` 본문이 `{slotKey, poiId, source:'MANUAL'}`
   *        **정확히**(슬롯 키가 빠지면 서버가 "계획에 없던 곳" 즉석 방문으로 기록한다 — 브리프 맹점 ①).
   *        완료(`/complete`)는 0회(도착 없이 완료만 남길 수 없다, BR-U5-05).
   *  - R3  도착한 슬롯의 행만 사라지고 방문 카드가 생긴다. 다른 계획 행은 남고, 빈 상태 안내는 사라진다.
   *  - R4  위치 권한이 있어도 오늘 탭이면 "방문 체크"가 서고 도착을 올린다(TRIP-1069 결정 1(c) — 옛 "없다"를
   *        뒤집음). R4b 권한이 있어도 지난 날 탭엔 없다.
   *  - R5  연타해도 POST 는 1회(AC-11 "1회").
   *  - (5-c 수정 루프 1) R6 기록 조회 실패면 빈 상태 안내 대신 오류 표면 + [다시 시도]가 재조회한다(경고5) ·
   *        R7 로딩 중엔 빈 상태 안내가 없다(경고5) · R8·R9 "방문 체크"는 선택 일자가 실제 오늘일 때만 —
   *        미래·지난 날 탭은 행만 있고 버튼 없음(경고6) · R10 도착 실패 뒤 다시 누르면 요청이 다시 나간다(경고4).
   *
   * `today` 는 페이지의 오늘 주입 seam 이다(LiveItineraryPage 선례, 기본 = seoulDate(new Date())). R1~R5 도
   * `today={DAY}` 를 준다 — 안 주면 실제 오늘과 픽스처 날짜가 달라 "방문 체크"가 날짜 게이트에 막힌다.
   *
   * 왜 통합 버킷인가: "레코드 없는 슬롯만 행으로"라는 조인과 실제로 나간 본문이 심판 대상이다 — 훅을
   * 목킹하면 그 조인이 테스트의 가정이 된다(형제 manualCheckin 통합 선례).
   */
  // 이 묶음의 옛 라우터 목엔 push 가 없어, 페이지가 push 를 부르면 TypeError 로 red 였다. 합친 파일은 push 있는
  // 목을 물려받으므로 그 그물을 부재 단언으로 남긴다(1147 경고-1과 같은 자리). afterEach 안 expect 가 실패하면
  // 방금 끝난 테스트가 실패로 표시된다.
  afterEach(() => {
    expect(jest.mocked(router.push)).not.toHaveBeenCalled();
  });

  const KEY_P3 = `${DAY}#p3`;

  const KEY_P4 = `${DAY}#p4`;

  const rowId = (slotKey: string) => `record-trip-plan-row-${slotKey}`;

  const checkId = (slotKey: string) => `record-trip-plan-check-${slotKey}`;

  function daySlot(poiId: string, nameKo: string, startAt: string) {
    return {
      poiId,
      nameKo,
      startAt,
      endAt: startAt,
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
        {
          date: DAY,
          slots: [
            daySlot('p3', '○○ 카페', '10:00:00'),
            daySlot('p4', '△△ 미술관', '13:00:00'),
          ],
        },
      ],
    };
  }

  /** POST /visits 응답 — record 훅은 이 레코드로 낙관 레코드를 교체한다(무효화 없음). */
  function createdVisitP4() {
    return {
      visitCheckId: 'v-p4',
      slotKey: KEY_P4,
      poiId: 'p4',
      arrivedAt: `${DAY}T14:20:00`,
      completedAt: null,
      skippedAt: null,
      source: 'MANUAL',
      spontaneous: false,
      updatedAt: `${DAY}T14:20:00`,
    };
  }

  let postBodies: unknown[] = [];

  beforeEach(() => {
    setAccessToken('a');
    postBodies = [];
    observedHits = [];
    mockGetForeground.mockReset();
    server.use(
      // TRIP-1085 — 페이지가 시트 헤더 여행명을 GET /trips/{tripId} 로 얻는다.
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(tripRecordsTrip())
      ),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      ),
      // 그날 방문 0건 — 계획 2곳이 전부 행이 된다.
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: [] })
      ),
      http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])),
      // TRIP-1069 D3 — 도착한 카드도 사진·메모 컨테이너로 그려져 카드마다 사진 목록을 조회한다.
      http.get(`${BASE}/trips/:tripId/visits/:visitCheckId/photos`, () =>
        HttpResponse.json({ items: [], count: 0 })
      ),
      http.post(`${BASE}/trips/:tripId/visits`, async ({ request }) => {
        postBodies.push(await request.json());
        return HttpResponse.json(createdVisitP4(), { status: 201 });
      })
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  describe('TripRecordsPage · 계획 행 조인 (TRIP-1021 AC-10·AC-13)', () => {
    it('R1 방문 0건 → 빈 상태 안내 + 계획 2곳 행, 수동 모드 부제(법 문구)도 그대로 있다', async () => {
      mockGetForeground.mockResolvedValue(DENIED);

      render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });

      expect(await screen.findByTestId(rowId(KEY_P3))).toBeOnTheScreen();
      expect(screen.getByTestId(rowId(KEY_P4))).toBeOnTheScreen();
      expect(screen.getAllByTestId('record-trip-empty')).toHaveLength(1);
      expect(await screen.findByText(MANUAL_NOTICE)).toBeOnTheScreen();
    });
  });

  describe('TripRecordsPage · 계획 행 "방문 체크" → 도착 (TRIP-1021 AC-11·AC-14)', () => {
    it('R2 수동 모드 → 행 "방문 체크"가 {slotKey, poiId, MANUAL} 로 POST 1회, 완료 요청은 0회', async () => {
      mockGetForeground.mockResolvedValue(DENIED);

      render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });
      fireEvent.press(await screen.findByTestId(checkId(KEY_P4)));

      await waitFor(() => expect(postBodies).toHaveLength(1));
      expect(postBodies[0]).toEqual({
        slotKey: KEY_P4,
        poiId: 'p4',
        source: 'MANUAL',
      });
      expect(observedHits.filter((hit) => hit.endsWith('/complete'))).toEqual(
        []
      );
    });

    it('R3 도착한 슬롯의 행만 사라지고 방문 카드가 생긴다 — 다른 행은 남고 빈 상태 안내는 사라진다', async () => {
      mockGetForeground.mockResolvedValue(DENIED);

      render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });
      fireEvent.press(await screen.findByTestId(checkId(KEY_P4)));

      expect(
        await screen.findByTestId('record-trip-visit-card-v-p4')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId(rowId(KEY_P4))).toBeNull();
      expect(screen.getByTestId(rowId(KEY_P3))).toBeOnTheScreen();
      expect(screen.queryByTestId('record-trip-empty')).toBeNull();
    });

    // TRIP-1069 결정 1(c)·AC-22 — 옛 R4("권한이 있으면 없다")를 뒤집었다. 권한이 있어도 오늘 탭이면 손으로
    // 체크할 수 있다. 짝 R4b 가 "권한 있음이면 항상 켬" 오구현(지난 날에도 켬)을 막는다.
    it('R4 위치 권한이 있어도 오늘 탭 계획 행엔 "방문 체크"가 서고, 누르면 {slotKey, poiId, MANUAL} 로 POST 1회', async () => {
      mockGetForeground.mockResolvedValue(GRANTED);

      render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });
      await waitFor(() => expect(mockGetForeground).toHaveBeenCalled());

      expect(await screen.findByTestId(checkId(KEY_P3))).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId(checkId(KEY_P4)));

      await waitFor(() => expect(postBodies).toHaveLength(1));
      expect(postBodies[0]).toEqual({
        slotKey: KEY_P4,
        poiId: 'p4',
        source: 'MANUAL',
      });
      expect(screen.queryByTestId('record-gps-banner')).toBeNull();
    });

    it('R4b 위치 권한이 있어도 지난 날 탭 계획 행엔 "방문 체크"가 없다 (AC-23)', async () => {
      mockGetForeground.mockResolvedValue(GRANTED);

      // 오늘 = 다음 날 → 첫 탭(DAY)은 지난 날이다.
      render(<TripRecordsPage tripId={TRIP_ID} today="2026-08-21" />, {
        wrapper,
      });

      // 짝 앵커 — 행 2개는 떴다(그 시점엔 권한 effect 도 flush 됐다).
      expect(await screen.findByTestId(rowId(KEY_P3))).toBeOnTheScreen();
      expect(screen.getByTestId(rowId(KEY_P4))).toBeOnTheScreen();
      await waitFor(() => expect(mockGetForeground).toHaveBeenCalled());
      expect(screen.queryAllByTestId(/^record-trip-plan-check-/)).toHaveLength(
        0
      );
    });

    it('R5 "방문 체크"를 연타해도 POST 는 1회뿐이다', async () => {
      mockGetForeground.mockResolvedValue(DENIED);

      render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });
      const check = await screen.findByTestId(checkId(KEY_P4));

      // 같은 참조를 연달아 — 캐시 갱신의 재렌더는 미뤄져 두 번째 press 때도 버튼이 트리에 남는다(02a ★1).
      fireEvent.press(check);
      fireEvent.press(check);

      // 응답으로 교체된 카드가 뜬 뒤에 센다(두 번째 요청이 늦게 찍히는 것까지 포함, 02a ★2).
      // 두 번 나가면 같은 낙관 id 두 개가 한 응답으로 함께 교체돼 같은 카드가 둘 선다 — 그래서 카드도 센다.
      await waitFor(() =>
        expect(
          screen.queryAllByTestId('record-trip-visit-card-v-p4').length
        ).toBeGreaterThan(0)
      );
      expect(
        observedHits.filter(
          (hit) => hit === `POST /api/v1/trips/${TRIP_ID}/visits`
        )
      ).toHaveLength(1);
      expect(screen.getAllByTestId('record-trip-visit-card-v-p4')).toHaveLength(
        1
      );
    });
  });

  const VISITS_GET = `GET /api/v1/trips/${TRIP_ID}/visits/days/${DAY}`;

  const POST_VISITS = `POST /api/v1/trips/${TRIP_ID}/visits`;

  describe('TripRecordsPage · 기록 조회 실패·로딩 (TRIP-1021 5-c 경고5)', () => {
    it('R6 기록 조회가 실패하면 "아직 방문 기록이 없어요" 대신 오류 표면 — [다시 시도]가 재조회하고 성공하면 카드가 뜬다', async () => {
      mockGetForeground.mockResolvedValue(DENIED);
      server.use(
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({ code: 'INTERNAL' }, { status: 500 })
        )
      );

      render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });

      expect(await screen.findByTestId('record-trip-error')).toBeOnTheScreen();
      expect(screen.queryByTestId('record-trip-empty')).toBeNull();
      expect(hitCount(VISITS_GET)).toBe(1);

      // 서버가 회복됐다 — 이후 조회는 p4 도착 레코드를 준다(나중에 등록한 핸들러가 이긴다, 02a ★17).
      server.use(
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
          HttpResponse.json({ visits: [createdVisitP4()] })
        )
      );
      fireEvent.press(screen.getByTestId('record-trip-error-retry'));

      expect(
        await screen.findByTestId('record-trip-visit-card-v-p4')
      ).toBeOnTheScreen();
      expect(hitCount(VISITS_GET)).toBe(2);
      expect(screen.queryByTestId('record-trip-error')).toBeNull();
    });

    it('R7 기록이 로딩 중이면 빈 상태 안내가 없고, 0건으로 도착하면 그때 뜬다', async () => {
      mockGetForeground.mockResolvedValue(DENIED);
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, async () => {
          await gate;
          return HttpResponse.json({ visits: [] });
        })
      );

      render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });

      // 앵커 — 일자 탭이 그려졌고(일정 도착) 기록 조회가 나가 응답을 기다리는 중이다.
      // (TRIP-1085 — 옛 `record-trip-day-tab-{date}` → 셸 `sheet-daychip-{index}`. DAY=0 · DAY2=1.)
      expect(await screen.findByTestId('sheet-daychip-0')).toBeOnTheScreen();
      await waitFor(() => expect(hitCount(VISITS_GET)).toBe(1));
      expect(screen.queryByTestId('record-trip-empty')).toBeNull();
      expect(screen.queryByTestId('record-trip-error')).toBeNull();

      // 짝 — 0건이 실제로 도착하면 안내가 선다("로딩이면 영원히 끔"이 아님).
      release();
      expect(await screen.findByTestId('record-trip-empty')).toBeOnTheScreen();
    });
  });

  describe('TripRecordsPage · "방문 체크"는 오늘 탭에서만 (TRIP-1021 5-c 경고6)', () => {
    const DAY2 = '2026-08-21';
    const KEY_P5 = `${DAY2}#p5`;
    const twoDays = () => ({
      ...itinerary(),
      days: [
        ...itinerary().days,
        { date: DAY2, slots: [daySlot('p5', '◇◇ 시장', '11:00:00')] },
      ],
    });

    beforeEach(() => {
      mockGetForeground.mockResolvedValue(DENIED);
      server.use(
        http.get(`${BASE}/trips/:tripId/itinerary`, () =>
          HttpResponse.json(twoDays())
        )
      );
    });

    it('R8 오늘이 1일차면 2일차(미래) 탭 계획 행엔 "방문 체크"가 없고, 1일차로 돌아오면 다시 선다', async () => {
      render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });

      // 오늘(1일차) — 버튼이 있다(긍정 앵커).
      expect(await screen.findByTestId(checkId(KEY_P4))).toBeOnTheScreen();

      // 미래(2일차) — 행은 보이되 버튼은 0.
      fireEvent.press(screen.getByTestId('sheet-daychip-1'));
      expect(await screen.findByTestId(rowId(KEY_P5))).toBeOnTheScreen();
      expect(screen.queryAllByTestId(/^record-trip-plan-check-/)).toHaveLength(
        0
      );

      // 오늘로 돌아오면 다시 선다("탭을 한 번이라도 고르면 끔" 오구현 차단).
      fireEvent.press(screen.getByTestId('sheet-daychip-0'));
      expect(await screen.findByTestId(checkId(KEY_P4))).toBeOnTheScreen();
      expect(postBodies).toHaveLength(0);
    });

    it('R9 오늘이 2일차면 1일차(지난 날) 탭 계획 행엔 "방문 체크"가 없고, 2일차 탭엔 있다', async () => {
      render(<TripRecordsPage tripId={TRIP_ID} today={DAY2} />, { wrapper });

      // 첫 탭(1일차 = 지난 날) — 행 2개는 보이되 버튼은 0. 권한 조회가 끝난 뒤에 본다(수동 모드 확정).
      expect(await screen.findByTestId(rowId(KEY_P3))).toBeOnTheScreen();
      expect(screen.getByTestId(rowId(KEY_P4))).toBeOnTheScreen();
      expect(await screen.findByTestId('record-gps-banner')).toBeOnTheScreen();
      expect(screen.queryAllByTestId(/^record-trip-plan-check-/)).toHaveLength(
        0
      );

      // 오늘(2일차) — 버튼이 있다.
      fireEvent.press(screen.getByTestId('sheet-daychip-1'));
      expect(await screen.findByTestId(checkId(KEY_P5))).toBeOnTheScreen();
    });
  });

  describe('TripRecordsPage · 도착 실패 뒤 재시도 (TRIP-1021 5-c 경고4)', () => {
    it('R10 "방문 체크"가 네트워크 실패로 되돌아간 뒤 다시 누르면 POST 가 한 번 더 나가고 방문 카드가 뜬다', async () => {
      mockGetForeground.mockResolvedValue(DENIED);
      let posts = 0;
      server.use(
        http.post(`${BASE}/trips/:tripId/visits`, async ({ request }) => {
          postBodies.push(await request.json());
          posts += 1;
          if (posts === 1) return HttpResponse.error();
          return HttpResponse.json(createdVisitP4(), { status: 201 });
        })
      );

      render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });
      fireEvent.press(await screen.findByTestId(checkId(KEY_P4)));

      // 1차 — 서버가 실패를 돌려준 뒤, 롤백으로 p4 행의 "방문 체크"가 다시 섰다.
      await waitFor(() => expect(posts).toBe(1));
      await waitFor(() => {
        expect(screen.getByTestId(checkId(KEY_P4))).toBeOnTheScreen();
        expect(screen.queryByTestId('record-trip-visit-card-v-p4')).toBeNull();
      });
      // record 훅은 롤백 뒤 한 틱 양보(settleRollback)하고 나서 가드를 푼다 — 사람 손가락처럼 한 틱 쉬고
      // 누른다(02c ★4). 이 대기가 없으면 올바른 구현에서도 두 번째 press 가 가드에 걸릴 수 있다.
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

      // 2차 — 새로 찾은 버튼을 누른다(실패 뒤라 연타가 아니다).
      fireEvent.press(screen.getByTestId(checkId(KEY_P4)));

      expect(
        await screen.findByTestId('record-trip-visit-card-v-p4')
      ).toBeOnTheScreen();
      expect(hitCount(POST_VISITS)).toBe(2);
      expect(postBodies[1]).toEqual({
        slotKey: KEY_P4,
        poiId: 'p4',
        source: 'MANUAL',
      });
    });
  });
});

describe('메모 저장 실패 안내·세션 캐시 시드', () => {
  // TRIP-1078 (옛 TripRecordsPage.memo.integration.test.tsx)
  /**
   * 🔴 TRIP-1078 · AC-4·AC-5·AC-6 — j01 메모 저장 실패 안내 · 세션 캐시 시드(실 페이지 + MSW).
   *
   * 무엇을 보장하나:
   *  - AC-5 PUT 이 404·네트워크로 실패하면 **그 카드 안**에 안내 한 줄(`record-trip-memo-notice-{id}`)이 뜨고
   *    입력한 텍스트는 입력칸에 남는다(INV-4). 같은 텍스트로 다시 포커스를 빼면 PUT 이 다시 나가고, 성공하면
   *    안내가 사라진다.
   *  - AC-6 저장에 성공한 메모는 페이지가 언마운트됐다 다시 떠도(탭 이동) 입력칸에 그 텍스트로 보인다.
   *  - AC-4 다시 뜬 뒤 같은 텍스트로 포커스를 빼도 PUT 은 안 나간다.
   *
   * ★ 테스트 client 의 기본 gcTime 은 0 이다. GC 는 setTimeout 으로 예약되므로, 기다리지 않고 다시 렌더하면
   *   메모 캐시에 gcTime Infinity 가 없어도 통과한다 → 같은 조건의 photos 쿼리가 **실제로 지워졌음**을 먼저
   *   단언해 "GC 가 돌았다"를 증명한 뒤 시드를 본다.
   * ★ "PUT 0회" 는 시간 대기 대신 다음 저장의 바디까지 목록 전체를 `toEqual` 로 본다(중복이면 앞에 낀다).
   *
   * (개념) `unmount()`=렌더한 트리를 내림(탭 이동으로 화면이 사라진 것) · `getQueryCache().find`=캐시에 그 키
   *   쿼리가 남아 있는지 · `HttpResponse.error()`=MSW 네트워크 실패 · `toHaveTextContent(문자열)`=완전 일치.
   */
  // 이 묶음의 옛 라우터 목엔 push 가 없어, 페이지가 push 를 부르면 TypeError 로 red 였다. 합친 파일은 push 있는
  // 목을 물려받으므로 그 그물을 부재 단언으로 남긴다(1147 경고-1과 같은 자리). afterEach 안 expect 가 실패하면
  // 방금 끝난 테스트가 실패로 표시된다.
  afterEach(() => {
    expect(jest.mocked(router.push)).not.toHaveBeenCalled();
  });
  // 옛 파일의 위치 권한 목 — 늘 granted.
  beforeEach(() => {
    mockGetForeground.mockResolvedValue({
      status: 'granted',
      granted: true,
      canAskAgain: true,
    });
  });

  const NOTICE = 'record-trip-memo-notice-v-in';

  const NOTICE_COPY = '메모를 저장하지 못했어요. 다시 시도해 주세요.';

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
        {
          date: DAY,
          slots: [
            {
              poiId: 'p1',
              nameKo: '광안리 해변',
              startAt: '10:00:00',
              endAt: '11:00:00',
              isFixed: false,
              endsNextDay: false,
              hasViolation: false,
              tags: [] as string[],
            },
          ],
        },
      ],
    };
  }

  /** 도착만 한 방문(광안리) — 메모칸이 있는 카드. */
  const V_IN = {
    visitCheckId: 'v-in',
    slotKey: `${DAY}#p1`,
    poiId: 'p1',
    arrivedAt: '2026-08-20T05:20:00Z',
    completedAt: null,
    skippedAt: null,
    source: 'MANUAL',
    spontaneous: false,
    updatedAt: '2026-08-20T07:00:00.000Z',
  };

  type MemoReply = 'ok' | 'not-found' | 'network';

  let memoReply: MemoReply = 'ok';

  let memoBodies: unknown[] = [];

  function newClient() {
    return new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  }

  function renderPage(client: QueryClient) {
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, {
      wrapper: Wrapper,
    });
  }

  /**
   * n 번째 PUT 이 서버에 닿은 뒤, 응답(성공·실패 처리)이 화면에 반영될 때까지 기다린다(5-b 보강).
   * ★ `waitFor(안내 없음)` 만으로는 부족하다 — 재시도 직전에 안내를 지우는 순간 통과해, 성공 **뒤** 안내가
   *   다시 켜지는 구현을 못 본다. 요청 수를 센 뒤 응답이 돌아올 여유(50ms)를 두고 알림까지 비운 다음에
   *   부재를 단언한다(네트워크 실패는 msw 가 response 이벤트를 안 내므로 요청 수로 센다).
   */
  async function settleMemoResponses(n: number) {
    await waitFor(() => expect(memoBodies).toHaveLength(n));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await flushNotifications();
  }

  const cardOf = () => screen.getByTestId('record-trip-visit-card-v-in');

  const memoInput = () =>
    waitFor(() => within(cardOf()).getByTestId('record-trip-memo-input'));

  beforeEach(() => {
    setAccessToken('a');
    memoReply = 'ok';
    memoBodies = [];
    server.use(
      // TRIP-1085 — 페이지가 시트 헤더 여행명을 GET /trips/{tripId} 로 얻는다.
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(tripRecordsTrip())
      ),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      ),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: [V_IN] })
      ),
      http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])),
      http.get(`${BASE}/trips/:tripId/visits/:visitCheckId/photos`, () =>
        HttpResponse.json({ items: [], count: 0 })
      ),
      http.put(
        `${BASE}/trips/:tripId/visits/:visitCheckId/memo`,
        async ({ request }) => {
          const body = (await request.json()) as { text: string };
          memoBodies.push(body);
          if (memoReply === 'network') return HttpResponse.error();
          if (memoReply === 'not-found') {
            return HttpResponse.json({ error: 'not found' }, { status: 404 });
          }
          return HttpResponse.json({
            text: body.text,
            updatedAt: '2026-08-20T08:00:00.000Z',
          });
        }
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  describe('🔴 AC-5 · 저장 실패는 카드 안 안내 한 줄 + 입력 유지, 재시도 성공 시 안내가 사라진다', () => {
    it.each<[string, MemoReply]>([
      ['404', 'not-found'],
      ['네트워크 실패', 'network'],
    ])(
      'PUT %s → 안내 · 텍스트 유지 → 같은 텍스트 재시도 성공 → 안내 사라짐',
      async (_label, reply) => {
        renderPage(newClient());
        const input = await memoInput();
        // 앵커 — 실패 전엔 안내가 없다.
        expect(within(cardOf()).queryByTestId(NOTICE)).toBeNull();

        // 실행 ① — 실패하는 저장.
        memoReply = reply;
        fireEvent.changeText(input, '파도 소리가 좋았다');
        fireEvent(input, 'blur');

        // 단언 ① — 그 카드 안에 안내(완전 일치), 입력은 남는다.
        await waitFor(() =>
          expect(within(cardOf()).getByTestId(NOTICE)).toHaveTextContent(
            NOTICE_COPY
          )
        );
        expect(
          within(cardOf()).getByTestId('record-trip-memo-input').props.value
        ).toBe('파도 소리가 좋았다');

        // 실행 ② — 서버가 살아났고, 같은 텍스트로 다시 포커스를 뺀다.
        memoReply = 'ok';
        fireEvent(
          within(cardOf()).getByTestId('record-trip-memo-input'),
          'blur'
        );

        // 단언 ② — 마지막 성공값이 없으니 PUT 이 다시 나가고, 성공 응답이 반영된 **뒤에도** 안내가 없다.
        await settleMemoResponses(2);
        expect(within(cardOf()).queryByTestId(NOTICE)).toBeNull();
        expect(memoBodies).toEqual([
          { text: '파도 소리가 좋았다' },
          { text: '파도 소리가 좋았다' },
        ]);
        expect(cardOf()).toBeOnTheScreen();
      }
    );
  });

  describe('🔴 AC-6·AC-4 · 저장한 메모는 다시 떠도 보이고, 같은 텍스트는 다시 안 보낸다', () => {
    it('저장 → 언마운트(GC 확인) → 다시 렌더하면 입력칸이 저장 텍스트, 같은 텍스트 blur 는 PUT 0', async () => {
      const client = newClient();
      const first = renderPage(client);

      // 준비 — 저장 성공.
      const input = await memoInput();
      fireEvent.changeText(input, '바람이 좋았다');
      fireEvent(input, 'blur');
      await waitFor(() => expect(memoBodies).toHaveLength(1));
      // 5-b 보강 — 첫 저장 성공이 반영된 뒤 실패 안내가 없다(성공에도 안내를 켜는 구현 차단).
      await settleMemoResponses(1);
      expect(within(cardOf()).queryByTestId(NOTICE)).toBeNull();

      // 실행 ① — 페이지가 사라지고 GC 가 돈다.
      const photosKey = getGetTripsTripIdVisitsVisitCheckIdPhotosQueryKey(
        TRIP_ID,
        'v-in'
      );
      expect(
        client.getQueryCache().find({ queryKey: photosKey })
      ).toBeDefined();
      first.unmount();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      // 앵커 — gcTime 0 쿼리는 실제로 지워졌다(GC 가 돌았다는 증거).
      expect(
        client.getQueryCache().find({ queryKey: photosKey })
      ).toBeUndefined();

      // 실행 ② — 같은 세션(같은 client)으로 다시 들어온다.
      renderPage(client);
      const again = await memoInput();

      // 단언 ① — 저장한 텍스트로 시드된다.
      expect(again.props.value).toBe('바람이 좋았다');

      // 실행 ③ — 같은 텍스트로 포커스를 뺀 뒤, 다른 텍스트로 저장한다(순서 센티널).
      fireEvent(again, 'blur');
      fireEvent.changeText(
        within(cardOf()).getByTestId('record-trip-memo-input'),
        '노을도 좋았다'
      );
      fireEvent(within(cardOf()).getByTestId('record-trip-memo-input'), 'blur');

      // 단언 ② — 같은 텍스트 blur 는 PUT 0회(중복이면 두 바디 사이에 낀다).
      await waitFor(() =>
        expect(memoBodies).toContainEqual({ text: '노을도 좋았다' })
      );
      expect(memoBodies).toEqual([
        { text: '바람이 좋았다' },
        { text: '노을도 좋았다' },
      ]);
    });
  });
});

describe('방문 카드 사진 — `+` 로 붙이고 이 기기 사진은 썸네일로', () => {
  // TRIP-1070 (옛 TripRecordsPage.photo.integration.test.tsx)
  /**
   * TRIP-1070 · j01 방문 카드의 사진 — `+` 로 붙이고, 이 기기 사진은 실제 썸네일로 보인다.
   *
   * 무엇을 보장하나:
   *  - AC-4  도착한 방문 카드에 `+` 가 있고, 누르고 1장 고르면 POST 1회 → 다시 불러온 목록에 그 사진 칸이 는다.
   *  - AC-5  서버 사진의 기기 = 이 설치 + 앨범에서 찾음 → 실제 썸네일(`<Image>`, 앨범 주소).
   *  - AC-6  다른 기기 사진 → "다른 기기에서 찍은 사진"(썸네일 0). 같은 기기인데 못 찾음 → "사진을 불러올 수 없어요".
   *  - F5    이 설치의 식별자를 아직 모르는 동안엔 "다른 기기" 로 잘못 그리지 않는다(깜빡임 금지).
   *  - AC-8  좌표는 GPS 기록 동의가 켜졌을 때만 싣는다.
   *  - AC-9·10  취소는 조용히, 권한 거부·자산 번호 없음·피커 실패는 카드 안 안내 한 줄(다음 `+` 에 지워진다).
   *  - AC-11 저장 실패는 "업로드 실패" 칸 + [다시 시도](TRIP-760 무회귀).
   *
   * 왜 이렇게 테스트하나:
   *  - 앨범(`@/shared/photo`)과 설치 식별자(`@/shared/storage/installId`)는 네이티브라 가짜로 바꾼다.
   *    식별자는 **딥 경로**를 가짜로 잡는다 — 배럴(`@/shared/storage`)로 가져오면 아래 배럴 목에 함수가
   *    없어 깨진다(02a ★5, 배럴 재수출 금지).
   *  - 서버 사진 목록을 `serverPhotos` 한 곳에 두고 POST 가 거기에 더한다 — 재조회가 "서버값"을 읽는다.
   *
   * (개념) `within(카드)` = 그 카드 안에서만 찾기 · 정규식 testID = 상태 4종 칸을 한 번에 세기 ·
   *   deferred = 테스트가 원할 때 끝나는 약속(식별자 로딩 중 상태를 붙잡아 두려고).
   * 3동작: 준비(서버 사진·식별자·앨범 응답) → 실행(렌더·`+` 누르기) → 단언(칸 testID·요청 본문·안내 문구).
   */
  beforeEach(() => {
    mockPhotoSeam = true;
  });

  const CARD = 'record-trip-visit-card-v-a';

  const NOTICE = 'record-trip-photo-notice-v-a';

  const PHOTOS_POST = `POST /api/v1/trips/${TRIP_ID}/visits/v-a/photos`;

  const PHOTOS_GET = `GET /api/v1/trips/${TRIP_ID}/visits/v-a/photos`;

  const ANY_CELL =
    /^record-photo-(available|other-device|unavailable|upload-failed)-/;

  const COPY_DENIED = '사진 접근 권한이 없어 사진을 불러올 수 없어요';

  const COPY_NO_ASSET_ID =
    '선택한 사진을 불러올 수 없어요. 사진 전체 접근을 허용해 주세요';

  const COPY_FAILED = '사진을 불러올 수 없어요';

  const asset = (localAssetId = 'asset-new') => ({
    localAssetId,
    deviceId: 'dev-A',
    takenAt: '2026-08-20T04:30:00.000Z',
    exifLat: 35.1532,
    exifLng: 129.1186,
  });

  const serverPhoto = (
    visitPhotoMetaId: string,
    localAssetId: string,
    deviceId: string
  ): VisitPhoto => ({
    visitPhotoMetaId,
    localAssetId,
    deviceId,
    takenAt: null,
    exifLat: null,
    exifLng: null,
    sortOrder: 0,
  });

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
      days: [{ date: DAY, slots: [daySlot('p1', '광안리 해변')] }],
    };
  }

  function completedVisit() {
    return {
      visitCheckId: 'v-a',
      slotKey: `${DAY}#p1`,
      poiId: 'p1',
      arrivedAt: `${DAY}T14:20:00`,
      completedAt: `${DAY}T15:20:00`,
      skippedAt: null,
      source: 'MANUAL',
      spontaneous: false,
      updatedAt: `${DAY}T15:20:00`,
    };
  }

  const consent = (gpsRecordingOptIn: boolean) => ({
    osPermissionMirror: 'GRANTED',
    // GPS 기록과 반대로 둔다 — 엉뚱한 필드를 읽으면 결과가 뒤집힌다(02a ★3).
    legalConsent: !gpsRecordingOptIn,
    gpsRecordingOptIn,
    capabilities: {
      localLocationUse: !gpsRecordingOptIn,
      serverLocationService: !gpsRecordingOptIn,
      gpsTrackRetention: gpsRecordingOptIn,
    },
  });

  let serverPhotos: VisitPhoto[] = [];

  let photoBodies: Record<string, unknown>[] = [];

  let photoStatus = 201;

  let gpsOptIn = true;

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }

  beforeEach(() => {
    observedHits = [];
    serverPhotos = [];
    photoBodies = [];
    photoStatus = 201;
    gpsOptIn = true;
    mockPick.mockReset().mockResolvedValue({ kind: 'picked', asset: asset() });
    mockResolveUri
      .mockReset()
      .mockImplementation(async (id: string) => `file:///photos/${id}.jpg`);
    mockGetInstallId.mockReset().mockResolvedValue('dev-A');
    setAccessToken('a');
    server.use(
      // TRIP-1085 — 페이지가 시트 헤더 여행명을 GET /trips/{tripId} 로 얻는다.
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(tripRecordsTrip())
      ),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      ),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: [completedVisit()] })
      ),
      http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])),
      http.get(`${BASE}/me/location-consent`, () =>
        HttpResponse.json(consent(gpsOptIn))
      ),
      http.get(`${BASE}/trips/:tripId/visits/:visitCheckId/photos`, () =>
        HttpResponse.json({ items: serverPhotos, count: serverPhotos.length })
      ),
      http.post(
        `${BASE}/trips/:tripId/visits/:visitCheckId/photos`,
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          photoBodies.push(body);
          if (photoStatus !== 201) {
            return HttpResponse.json(
              { error: { code: 'INTERNAL', message: 'boom' } },
              { status: photoStatus }
            );
          }
          const created = serverPhoto(
            'ph-new',
            String(body.localAssetId),
            String(body.deviceId)
          );
          serverPhotos = [...serverPhotos, created];
          return HttpResponse.json(created, { status: 201 });
        }
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
    resetPressGuard();
  });

  async function renderCard() {
    render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });
    return screen.findByTestId(CARD);
  }

  describe('🔴 AC-4 · 도착한 방문 카드의 `+` 로 사진을 붙인다', () => {
    it('R1 `+` → 1장 선택 → POST 1회 → 다시 불러온 목록에 그 사진 칸이 하나 는다', async () => {
      const card = await renderCard();
      const add = await within(card).findByTestId('record-trip-photo-add');
      expect(within(card).queryAllByTestId(ANY_CELL)).toHaveLength(0);

      fireEvent.press(add);

      await waitFor(() => expect(hitCount(PHOTOS_POST)).toBe(1));
      expect(photoBodies[0]).toMatchObject({
        localAssetId: 'asset-new',
        deviceId: 'dev-A',
      });
      expect(
        await within(card).findByTestId('record-photo-available-ph-new')
      ).toBeOnTheScreen();
      expect(within(card).queryAllByTestId(ANY_CELL)).toHaveLength(1);
    });
  });

  describe('🔴 AC-5·AC-6 · 사진 칸은 기기와 앨범 결과로 갈린다 (BR-U5-14/15 · INV-4)', () => {
    it('R2 이 설치에서 붙인 사진이고 앨범에서 찾으면 실제 썸네일(앨범 주소)로 그린다', async () => {
      serverPhotos = [serverPhoto('ph1', 'asset-1', 'dev-A')];
      await renderCard();

      const image = await screen.findByTestId('record-photo-thumb-image-ph1');

      expect(image.props.source).toEqual({ uri: 'file:///photos/asset-1.jpg' });
      expect(
        screen.getByTestId('record-photo-available-ph1')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('record-photo-other-device-ph1')).toBeNull();
      expect(mockResolveUri).toHaveBeenCalledWith('asset-1');
    });

    it('R3 다른 기기 사진은 "다른 기기" 칸(썸네일 0), 같은 기기인데 앨범에서 못 찾으면 "불러올 수 없어요" 칸', async () => {
      serverPhotos = [
        serverPhoto('ph-other', 'asset-2', 'dev-B'),
        serverPhoto('ph-gone', 'asset-3', 'dev-A'),
      ];
      mockResolveUri.mockImplementation(async (id: string) =>
        id === 'asset-3' ? null : `file:///photos/${id}.jpg`
      );
      await renderCard();

      expect(
        await screen.findByTestId('record-photo-other-device-ph-other')
      ).toBeOnTheScreen();
      expect(
        await screen.findByTestId('record-photo-unavailable-ph-gone')
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId('record-photo-thumb-image-ph-other')
      ).toBeNull();
      expect(
        screen.queryByTestId('record-photo-thumb-image-ph-gone')
      ).toBeNull();
    });

    it('R4 (F5) 설치 식별자를 아직 모르는 동안엔 "다른 기기" 로 그리지 않고, 알게 되면 썸네일로 바뀐다', async () => {
      // 준비 — 식별자 로딩을 붙잡아 둔다.
      // 몇 번을 물어도 같은 약속 하나(실제 getInstallId 도 약속 하나를 기억한다).
      let release: (id: string) => void = () => {};
      const pending = new Promise<string>((resolve) => {
        release = resolve;
      });
      mockGetInstallId.mockImplementation(() => pending);
      serverPhotos = [serverPhoto('ph1', 'asset-1', 'dev-A')];
      await renderCard();
      await waitFor(() => expect(hitCount(PHOTOS_GET)).toBeGreaterThan(0));
      await settle();

      // 단언 — 서버 사진은 도착했지만 식별자를 모르므로 "다른 기기" 칸이 없다.
      expect(screen.queryByTestId('record-photo-other-device-ph1')).toBeNull();

      // 실행 — 식별자 도착.
      await act(async () => {
        release('dev-A');
      });

      expect(
        await screen.findByTestId('record-photo-available-ph1')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('record-photo-other-device-ph1')).toBeNull();
    });
  });

  describe('🔴 AC-8 · j01 에서도 좌표는 GPS 기록 동의가 켜졌을 때만 (BR-U5-12)', () => {
    it.each([
      ['켜짐 → 좌표 있음', true],
      ['꺼짐 → 좌표 키 없음', false],
    ])('R5 GPS 기록 동의 %s', async (_label, optIn) => {
      gpsOptIn = optIn;
      const card = await renderCard();

      fireEvent.press(await within(card).findByTestId('record-trip-photo-add'));

      await waitFor(() => expect(hitCount(PHOTOS_POST)).toBe(1));
      const body = photoBodies[0] ?? {};
      if (optIn) {
        expect(body).toMatchObject({ exifLat: 35.1532, exifLng: 129.1186 });
      } else {
        expect(body).not.toHaveProperty('exifLat');
        expect(body).not.toHaveProperty('exifLng');
      }
    });
  });

  describe('🔴 AC-9·AC-10·AC-11 · 실패 경로', () => {
    it('R6 앨범에서 취소하면 요청도 안내도 없다', async () => {
      mockPick.mockResolvedValue({ kind: 'canceled' });
      const card = await renderCard();

      fireEvent.press(await within(card).findByTestId('record-trip-photo-add'));
      await waitFor(() => expect(mockPick).toHaveBeenCalledTimes(1));
      await settle();

      expect(hitCount(PHOTOS_POST)).toBe(0);
      expect(screen.queryByTestId(NOTICE)).toBeNull();
    });

    it.each([
      ['사진 권한 거부', 'denied', COPY_DENIED],
      ['자산 번호 없음(선택한 사진만 허용)', 'no-asset-id', COPY_NO_ASSET_ID],
      ['피커 실패(재빌드 전 앱)', 'failed', COPY_FAILED],
    ])(
      'R7 %s → 카드 안 안내가 뜨고 요청은 0회, 다음 `+` 에 안내가 지워진다',
      async (_label, kind, copy) => {
        mockPick.mockResolvedValueOnce({ kind });
        const card = await renderCard();
        const add = await within(card).findByTestId('record-trip-photo-add');

        fireEvent.press(add);

        expect(await within(card).findByTestId(NOTICE)).toHaveTextContent(copy);
        await settle();
        expect(hitCount(PHOTOS_POST)).toBe(0);

        // 실행 — 다시 `+`(이번엔 취소).
        mockPick.mockResolvedValueOnce({ kind: 'canceled' });
        fireEvent.press(within(card).getByTestId('record-trip-photo-add'));
        await waitFor(() => expect(mockPick).toHaveBeenCalledTimes(2));
        await settle();

        expect(screen.queryByTestId(NOTICE)).toBeNull();
      }
    );

    it('R7b 권한 거부 안내에는 [설정 열기] 가 있고 누르면 openSettings 1회 · 피커 실패 안내에는 없다 (TRIP-1216 d)', async () => {
      const openSettings = jest
        .spyOn(Linking, 'openSettings')
        .mockResolvedValue(undefined);
      mockPick.mockResolvedValueOnce({ kind: 'failed' });
      const card = await renderCard();

      fireEvent.press(await within(card).findByTestId('record-trip-photo-add'));
      await within(card).findByTestId(NOTICE);
      expect(
        within(card).queryByTestId('record-trip-photo-settings')
      ).toBeNull();

      mockPick.mockResolvedValueOnce({ kind: 'denied' });
      fireEvent.press(within(card).getByTestId('record-trip-photo-add'));
      fireEvent.press(
        await within(card).findByTestId('record-trip-photo-settings')
      );

      expect(openSettings).toHaveBeenCalledTimes(1);
      openSettings.mockRestore();
    });

    it('R8 저장 요청이 실패하면(500) "업로드 실패" 칸과 카드 [다시 시도]가 뜬다', async () => {
      photoStatus = 500;
      mockPick.mockResolvedValue({ kind: 'picked', asset: asset('asset-9') });
      const card = await renderCard();

      fireEvent.press(await within(card).findByTestId('record-trip-photo-add'));

      expect(
        await within(card).findByTestId('record-photo-upload-failed-asset-9')
      ).toBeOnTheScreen();
      expect(
        within(card).getByTestId('record-trip-upload-retry-v-a')
      ).toBeOnTheScreen();
    });
  });
});

describe('「오늘의 회고」 FAB 배선', () => {
  // TRIP-1088 (옛 TripRecordsPage.reflectionFab.integration.test.tsx)
  /**
   * 🔴 TRIP-1088 · P1~P7 — j01 「오늘의 회고」 FAB 페이지 배선(US-REC-06 · 지라 결정 2·3).
   *
   * 무엇을 보장하나:
   *  - 누르면 **지금 선택된 일차**의 j03(`/trips/{tripId}/records/reflection/{YYYY-MM-DD}`)으로 1회 간다(P1·P2·P4).
   *  - 미래 일차엔 없고 오늘·지난 일차엔 있다(P3·P4). 끝난 여행도 모든 일차에 있다(P5 — 여행 상태로 안 가른다).
   *  - 일정이 오기 전(활성 일자 '')엔 없다 — `'' <= today` 가 참이라 가드가 없으면 날짜 없는 경로로 간다(P6).
   *  - 연타해도 이동은 1회(P7, guardPress).
   *
   * 방문은 전부 0건 — 그날 계획 행 이름이 "그날 로드 완료" 앵커다(부재 단언이 로딩 중에 공짜로 통과하지 않게).
   * (개념) `findByTestId` = 나타날 때까지 기다렸다 찾는다 · `queryByTestId` = 없으면 null(부재 단언용).
   */

  const FAB = 'record-trip-reflection-fab';

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

  /** 일차 번호(0부터) → 그날 계획 행 이름(로드 앵커). */
  const DAY_ANCHOR = ['광안리 해변', '부산시립미술관', '○○ 카페'];

  function reflectionPath(date: string): string {
    return `/trips/${TRIP_ID}/records/reflection/${date}`;
  }

  /** 칩을 눌러 그날로 옮기고, 그날 계획 행이 그려질 때까지 기다린다. */
  async function selectDay(index: number): Promise<void> {
    fireEvent.press(screen.getByTestId(`sheet-daychip-${index}`));
    await screen.findByText(DAY_ANCHOR[index] ?? '');
  }

  beforeEach(() => {
    setAccessToken('a');
    server.use(
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(tripRecordsTrip())
      ),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      ),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: [] })
      ),
      http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([]))
    );
  });

  // 파일 최상위 — guardPress 창·push 기록은 모듈 전역이라 describe 안에만 걸면 앞 테스트가 샌다.
  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
    resetPressGuard();
    jest.mocked(router.push).mockClear();
  });

  describe('🔴 TRIP-1088 P1·P2 · 누르면 선택된 일차의 j03 으로 간다', () => {
    it('P1·P2 오늘(2일차)에서 누르면 2일차 경로, 1일차로 옮겨 누르면 1일차 경로로 간다 — 오늘로 고정하지 않는다', async () => {
      render(<TripRecordsPage tripId={TRIP_ID} today="2026-08-21" />, {
        wrapper,
      });
      await screen.findByText(DAY_ANCHOR[0] ?? '');
      expect(jest.mocked(router.push).mock.calls).toEqual([]);

      // 실행 ① — 오늘 탭(2일차)에서 누른다.
      await selectDay(1);
      fireEvent.press(screen.getByTestId(FAB));

      // 실행 ② — 400ms 가 흐른 것으로 치고(guardPress 창 닫기) 1일차로 옮겨 누른다.
      resetPressGuard();
      await selectDay(0);
      fireEvent.press(screen.getByTestId(FAB));

      expect(jest.mocked(router.push).mock.calls).toEqual([
        [reflectionPath('2026-08-21')],
        [reflectionPath('2026-08-20')],
      ]);
    });
  });

  describe('🔴 TRIP-1088 P3·P4·P5 · 미래 일차에선 숨고, 오늘·지난 일차·끝난 여행에선 보인다', () => {
    it('P3 오늘이 1일차면 1일차엔 있고 2일차·3일차(미래)엔 없다', async () => {
      render(<TripRecordsPage tripId={TRIP_ID} today="2026-08-20" />, {
        wrapper,
      });
      await screen.findByText(DAY_ANCHOR[0] ?? '');
      expect(screen.getByTestId(FAB)).toBeOnTheScreen();

      await selectDay(1);
      expect(screen.queryByTestId(FAB)).toBeNull();

      await selectDay(2);
      expect(screen.queryByTestId(FAB)).toBeNull();
    });

    it('P4 오늘이 3일차면 지난 1일차에도 있고, 누르면 1일차 경로로 간다', async () => {
      render(<TripRecordsPage tripId={TRIP_ID} today="2026-08-22" />, {
        wrapper,
      });
      await screen.findByText(DAY_ANCHOR[0] ?? '');

      fireEvent.press(screen.getByTestId(FAB));

      expect(jest.mocked(router.push).mock.calls).toEqual([
        [reflectionPath('2026-08-20')],
      ]);
    });

    it('P5 여행이 끝난 뒤(오늘 08-30, 여행 상태 ENDED)엔 모든 일차에 있다', async () => {
      // 준비 — 여행 응답을 끝난 여행(ENDED)으로 덮는다. 상태로 FAB 를 가르는 퇴행을 잡으려면 픽스처가
      // 실제로 ENDED 여야 한다(ACTIVE 그대로면 그 퇴행이 green 으로 통과 — 03b 경고-1).
      server.use(
        http.get(`${BASE}/trips/:tripId`, () =>
          HttpResponse.json({ ...tripRecordsTrip(), status: 'ENDED' })
        )
      );
      render(<TripRecordsPage tripId={TRIP_ID} today="2026-08-30" />, {
        wrapper,
      });
      await screen.findByText(DAY_ANCHOR[0] ?? '');
      // 여행 응답이 도착했는지(헤더에 여행명) 먼저 확인 — 로딩 중이라 FAB 가 보이는 경우와 가른다.
      await waitFor(() =>
        expect(
          screen.getByTestId('record-trip-sheet-header')
        ).toHaveTextContent(/^부산 여행 · /)
      );
      expect(screen.getByTestId(FAB)).toBeOnTheScreen();

      await selectDay(1);
      expect(screen.getByTestId(FAB)).toBeOnTheScreen();

      await selectDay(2);
      expect(screen.getByTestId(FAB)).toBeOnTheScreen();
    });
  });

  describe('🔴 TRIP-1088 P6 · 일정이 오기 전(활성 일자 없음)엔 없다', () => {
    it('P6 itinerary 응답을 붙잡은 동안엔 뷰만 있고 FAB 는 없다 — 응답이 오면 선다', async () => {
      // 준비 — itinerary GET 을 게이트로 붙잡는다(바로 주면 로딩 창이 한 번에 지나간다, 02a ★8).
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
          await gate;
          return HttpResponse.json(itinerary());
        })
      );

      render(<TripRecordsPage tripId={TRIP_ID} today="2026-08-20" />, {
        wrapper,
      });

      // 단언 ① — 화면은 그려졌지만(앵커) 날짜가 없어 FAB 가 없다.
      expect(screen.getByTestId('record-trip-view')).toBeOnTheScreen();
      expect(screen.queryByTestId(FAB)).toBeNull();

      // 실행 — 응답을 보낸다.
      release();

      // 단언 ② — 1일차(= 오늘)가 활성이 되면 선다.
      expect(await screen.findByTestId(FAB)).toBeOnTheScreen();
    });
  });

  describe('🔴 TRIP-1088 P7 · 연타해도 j03 은 한 번만 쌓인다', () => {
    it('P7 같은 순간 두 번 눌러도 push 는 1회다', async () => {
      render(<TripRecordsPage tripId={TRIP_ID} today="2026-08-20" />, {
        wrapper,
      });
      await screen.findByText(DAY_ANCHOR[0] ?? '');

      const fab = screen.getByTestId(FAB);
      fireEvent.press(fab);
      fireEvent.press(fab);

      expect(jest.mocked(router.push).mock.calls).toEqual([
        [reflectionPath('2026-08-20')],
      ]);
    });
  });
});
