import { http, HttpResponse } from 'msw';
import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import {
  getGetTripsQueryKey,
  getGetTripsTripIdQueryKey,
} from '@/shared/api/index.hooks';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { EditTripRequest, Trip } from '@/shared/api/index.schemas';
import { guardPress, resetPressGuard } from '@/shared/lib/pressGuard';
import { BASE } from '@/test-support/apiBase';
import { makeTrip } from '@/test-support/mustVisitFixtures';
import { createRequestLog } from '@/test-support/mswItinerary';
import {
  newTestQueryClient,
  renderWithQueryClient,
  settle,
} from '@/test-support/queryRender';
import { resetToast, WithToastHost } from '@/test-support/toastHarness';
import { listHits, watchTripsList } from '@/test-support/tripItineraryCols';

import { TripSettingsPage } from './TripSettingsPage';

/**
 * TRIP-1787 · g03 여행 설정 화면 — 내 여행 카드 ⋯ 「여행 설정」(TRIP-1786)이 도착하는 화면의 통합 테스트(실 HTTP · MSW).
 * 실제로 나간 요청의 수와 **본문**이 심판 대상이라 통합 버킷이다(훅 목 대신 실제 react-query).
 *
 * 새 개념 두 줄 —
 *  - **PATCH 통째 교체**: 서버는 받은 본문 전체로 여행을 덮어쓴다. 빠진 칸은 지워지므로 안 바꾼 칸도 지금 값을 다시 실어야 한다
 *    (본문 조립 규칙 자체는 `model/editTripRequest.test.ts` 가 잠그고, 여기서는 화면이 그 규칙에 **누르는 순간의 입력과 최신 여행**을
 *    넘기는지 본다).
 *  - **마운트 스냅샷 함정**: 화면이 열릴 때 값을 한 번 굳혀 두고 저장하면, 그 사이 다른 곳에서 바뀐 칸을 되돌린다.
 *
 * 무엇을 보장하나(AC-1~7):
 *  A. 화면: GET 값으로 칸을 채운다(이름 입력·동행·인원·일과 `HH:mm`), 기간·여행지·커버는 보기만(눌러도 아무 일 없다).
 *  B. 이름 저장(AC-1·2): 바뀐 값이 있을 때만 저장이 켜지고, PATCH 는 정확히 1번 · 본문은 GET 의 나머지 칸 그대로(취향 스냅샷 키 없음)
 *     · 성공하면 목록 다시 받기 + 토스트 + 뒤로. 본문은 누르는 순간의 입력 + 그 순간의 최신 여행으로 만든다.
 *  C. 동행·일과 시트(AC-7): 시트로 바꾼 값이 PATCH 에 실리고, 안 건드린 일과는 `HH:mm:ss` 원문 그대로 나간다.
 *  D. 이름 검증(AC-3): 121 코드포인트·공백·빈 이름은 막힘 + 안내. 막힘 = 비활성 + 실제 누름 + 요청 0회 세 겹.
 *  E. 끝난 여행(AC-4): GET `status==='ENDED'` 면 열리되 잠금 + 이유 한 줄. 저장 응답 409 도 같은 잠금 얼굴.
 *  F. 실패(AC-5): 5xx·네트워크 → 입력 유지 + 오류 + 다시 시도(INV-4). 연타는 PATCH 1번.
 *  G. 삭제(AC-6): 확인 전 DELETE 0 · 성공(204·404) 뒤 일정 탭으로. 노출 조건은 내 여행 목록의 ⋯ 삭제와 같다.
 *  H. 조회 얼굴: 로딩 · 실패(다시 시도) · 404.
 *
 * ⚠️ jest 가 원리적으로 못 보는 것(기능 지도 몫): 시트가 실제로 열리고 딤이 덮이는지 · 삭제 다이얼로그 딤·중앙 정렬 · 키보드 ·
 * 휠 제스처 · 생김새(Figma 픽셀, 삭제 버튼 색). 이름 입력에 `maxLength` 를 걸어도 `fireEvent.changeText` 는 길이를 안 자르므로
 * jest 가 못 잡는다 — 121자 안내를 못 띄우게 되는 회귀는 코드 리뷰·6-b 몫이다.
 *
 * 3동작: 준비(서버 여행·응답 정하기) → 실행(입력·누름) → 단언(나간 요청·화면).
 */

// 생성 클라이언트의 인증 계층이 `@/shared/storage` 를 정적으로 문다(토큰 저장소 대역).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/storage', () => require('@/test-support/storageMock'));

jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    useRouter: ['push', 'replace', 'back', 'dismissTo', 'canGoBack'],
    router: ['push', 'replace', 'back', 'dismissTo', 'canGoBack'],
  })
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { routerSpies } = require('@/test-support/expoRouterMock') as {
  routerSpies: Record<
    'push' | 'replace' | 'back' | 'dismissTo' | 'canGoBack',
    jest.Mock
  >;
};

const TRIP_ID = 'trip-settings-1';
const DELETE_DONE_HREF = '/(tabs)/itinerary';

/** 시작 전(2099) · 작성중(일정 없음) · 목적지 둘(regionCode 포함) · 예산 있음 · 일과 일부(HH:mm:ss 원문). */
function baseTrip(over: Partial<Trip> = {}): Trip {
  return makeTrip({
    tripId: TRIP_ID,
    title: '제주 가족 여행',
    startDate: '2099-06-10',
    endDate: '2099-06-13',
    party: 3,
    companionType: '가족',
    budgetTotal: 1500000,
    preferenceSnapshot: { styles: ['자연'] } as Trip['preferenceSnapshot'],
    destinations: [
      { seq: 1, region: '제주시', nights: 2, regionCode: '50110' },
      { seq: 2, region: '서귀포시', nights: 1, regionCode: '50130' },
    ],
    status: 'PLANNED',
    dayStartAt: '09:30:00',
    firstDayStartAt: null,
    lastDayEndAt: '18:00:00',
    ...over,
  });
}

/** 확정 일정이 있는 여행(목록의 일정 상태 칸). */
const CONFIRMED_COLS = {
  itineraryStatus: 'CONFIRMED',
  itineraryGenerationState: 'COMPLETE',
  itineraryGenerationMode: 'FULLY_AI',
  itineraryDayCount: 4,
} as const satisfies Partial<Trip>;

// ── 가짜 서버 ──────────────────────────────────────────────────────────────
let serverTrip: Trip;
let patchBodies: EditTripRequest[] = [];
/** PATCH 응답 큐 — 앞에서부터 하나씩 쓰고, 비면 성공(서버 상태 갱신). */
let patchQueue: (() => Response)[] = [];
let patchGate: Promise<void> | null = null;
/** DELETE 응답 큐 — 비면 204. */
let deleteQueue: (() => Response | Promise<Response>)[] = [];
/** GET /trips/:id 응답 큐 — 비면 현재 서버 여행. */
let getQueue: (() => Response | Promise<Response>)[] = [];

const log = createRequestLog(server);
const patchHits = () => log.hitsFor('PATCH', `/trips/${TRIP_ID}`);
const deleteHits = () => log.hitsFor('DELETE', `/trips/${TRIP_ID}`);

const CONFLICT_409 = () =>
  HttpResponse.json(
    { code: 'CONFLICT', message: '종료된 여행은 수정할 수 없습니다.' },
    { status: 409 }
  );
const ERROR_500 = () =>
  HttpResponse.json(
    { code: 'INTERNAL_ERROR', message: 'boom' },
    { status: 500 }
  );
const NETWORK_ERROR = () => HttpResponse.error();

function installServer(): void {
  server.use(
    http.get(`${BASE}/trips/:tripId`, async () => {
      const next = getQueue.shift();
      return next ? next() : HttpResponse.json(serverTrip);
    }),
    http.get(`${BASE}/trips`, () => HttpResponse.json([serverTrip])),
    http.patch(`${BASE}/trips/:tripId`, async ({ request }) => {
      const body = (await request.json()) as EditTripRequest;
      patchBodies.push(body);
      if (patchGate) await patchGate;
      const next = patchQueue.shift();
      if (next) return next();
      // 통째 교체 흉내 — 본문에 없는 일과 칸은 null 로 덮인다.
      serverTrip = {
        ...serverTrip,
        ...body,
        title: body.title ?? serverTrip.title,
        party: body.party ?? 1,
        companionType: body.companionType ?? null,
        budgetTotal: body.budgetTotal ?? null,
        dayStartAt: body.dayStartAt ?? null,
        firstDayStartAt: body.firstDayStartAt ?? null,
        lastDayEndAt: body.lastDayEndAt ?? null,
      } as Trip;
      return HttpResponse.json(serverTrip);
    }),
    http.delete(`${BASE}/trips/:tripId`, () => {
      const next = deleteQueue.shift();
      return next ? next() : new HttpResponse(null, { status: 204 });
    })
  );
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  log.attach();
});

beforeEach(() => {
  serverTrip = baseTrip();
  patchBodies = [];
  patchQueue = [];
  patchGate = null;
  deleteQueue = [];
  getQueue = [];
  log.reset();
  Object.values(routerSpies).forEach((spy) => spy.mockClear());
  routerSpies.canGoBack.mockReturnValue(true);
  setAccessToken('valid-access');
  installServer();
});

// 모듈 싱글턴(토스트·누름 가드)은 파일 최상위에서 비운다 — describe 안에만 걸면 앞 테스트 상태가 샌다.
afterEach(() => {
  clearAccessToken();
  resetPressGuard();
  resetToast();
  server.resetHandlers();
});

afterAll(() => server.close());

// ── 도우미 ─────────────────────────────────────────────────────────────────
let client: QueryClient;

async function openPage(): Promise<void> {
  client = newTestQueryClient();
  renderWithQueryClient(
    <WithToastHost>
      <TripSettingsPage tripId={TRIP_ID} />
    </WithToastHost>,
    client
  );
  await screen.findByTestId('trip-settings-root');
}

/** 눌러도 되는 누름 — 앞 누름이 연 400ms 누름 가드 창을 닫고 누른다(연타 케이스는 쓰지 않는다). */
function press(testID: string): void {
  resetPressGuard();
  fireEvent.press(screen.getByTestId(testID));
}

/** 연타 창이 지금 열려 있나 — 창 안이면 `guardPress` 로 감싼 함수가 무시된다(창이 닫혀 있었으면 이 탐침이 창을 연다). */
function pressWindowOpen(): boolean {
  let ran = false;
  guardPress(() => {
    ran = true;
  })();
  return !ran;
}

const typeTitle = (value: string) =>
  fireEvent.changeText(screen.getByTestId('trip-settings-title'), value);
const save = () => screen.getByTestId('trip-settings-save');

/** "막힌다" 세 겹 — ① 비활성 매처 ② 실제 누름 ③ 요청 0회(누름 전 PATCH 수 그대로). */
async function expectSaveBlocked(): Promise<void> {
  const before = patchHits();
  expect(save()).toBeDisabled();
  press('trip-settings-save');
  await settle();
  expect(patchHits()).toBe(before);
}

describe('A · 화면 — GET 값으로 채우고, 기간·여행지·커버는 보기만', () => {
  it('이름 입력·동행·인원·일과(앞 5글자 HH:mm)·기간·여행지·커버가 GET 값으로 보이고, 저장은 꺼져 있다', async () => {
    await openPage();

    expect(screen.getByTestId('trip-settings-title')).toHaveDisplayValue(
      '제주 가족 여행'
    );
    expect(
      screen.getByTestId('trip-settings-companion-type')
    ).toHaveTextContent('가족');
    expect(screen.getByTestId('trip-settings-party')).toHaveTextContent('3명');
    // 서버 일과는 HH:mm:ss — 화면은 HH:mm. 하루 끝은 서버 상수 21:00.
    expect(
      screen.getByTestId('trip-settings-day-start-value')
    ).toHaveTextContent('09:30 ~ 21:00');
    expect(screen.getByTestId('trip-settings-day-end')).toHaveTextContent(
      '마지막 날 18:00까지'
    );
    // 정하지 않은 첫날 값은 줄 자체가 없다
    expect(screen.queryByTestId('trip-settings-day-first')).toBeNull();
    expect(screen.getByTestId('trip-settings-period')).toHaveTextContent(
      /3박 4일/
    );
    expect(screen.getByTestId('trip-settings-destinations')).toHaveTextContent(
      /제주시.*서귀포시/
    );
    expect(screen.getByTestId('trip-settings-cover')).toBeOnTheScreen();
    await expectSaveBlocked();
  });

  it('하루 시작이 null 이면 서버 기본 09:00 으로 보이고, 첫날 값이 있으면 보조 줄이 뜬다', async () => {
    serverTrip = baseTrip({
      dayStartAt: null,
      firstDayStartAt: '12:00:00',
      lastDayEndAt: null,
    });
    await openPage();

    expect(
      screen.getByTestId('trip-settings-day-start-value')
    ).toHaveTextContent('09:00 ~ 21:00');
    expect(screen.getByTestId('trip-settings-day-first')).toHaveTextContent(
      '첫날 12:00부터'
    );
    expect(screen.queryByTestId('trip-settings-day-end')).toBeNull();
  });

  it('동행이 미정(null)이면 유형 칸은 "미정", 시트의 칩은 어느 것도 켜져 있지 않다', async () => {
    serverTrip = baseTrip({ companionType: null, party: 1 });
    await openPage();

    expect(
      screen.getByTestId('trip-settings-companion-type')
    ).toHaveTextContent('미정');
    press('trip-settings-companion');
    expect(screen.getByTestId('trip-wizard-companion-sheet')).toBeOnTheScreen();
    for (const code of ['alone', 'friend', 'partner', 'family']) {
      expect(
        screen.queryByTestId(`trip-wizard-companion-chip-active-${code}`)
      ).toBeNull();
    }
  });

  it('기간·여행지·커버 행은 눌러도 아무 일이 없다 — 시트·이동·요청 0', async () => {
    await openPage();

    for (const id of [
      'trip-settings-period',
      'trip-settings-destinations',
      'trip-settings-cover',
    ]) {
      press(id);
    }
    await settle();

    expect(screen.queryByTestId('trip-wizard-companion-sheet')).toBeNull();
    expect(screen.queryByTestId('trip-wizard-daywindow-sheet')).toBeNull();
    expect(screen.queryByText('커버 바꾸기')).toBeNull();
    expect(routerSpies.push).not.toHaveBeenCalled();
    expect(routerSpies.replace).not.toHaveBeenCalled();
    expect(patchHits()).toBe(0);
  });

  it('뒤로 버튼은 스택이 있으면 back, 스택이 없으면(딥링크) 일정 탭으로 replace 한다', async () => {
    await openPage();

    press('trip-settings-back');
    expect(routerSpies.back).toHaveBeenCalledTimes(1);

    routerSpies.back.mockClear();
    routerSpies.canGoBack.mockReturnValue(false);
    press('trip-settings-back');
    expect(routerSpies.back).not.toHaveBeenCalled();
    expect(routerSpies.replace).toHaveBeenCalledWith('/itinerary');
  });
});

describe('B · 이름 저장 (AC-1 · AC-2)', () => {
  it('이름을 바꿔 저장하면 PATCH 1번 — 새 title + GET 나머지 칸 그대로(일과는 HH:mm:ss 원문·null 은 null, 취향 스냅샷 키 없음) → 목록 다시 받기·토스트·뒤로', async () => {
    await openPage();
    const unwatch = watchTripsList(client);
    await waitFor(() => expect(listHits(log.all())).toBe(1));
    const listBefore = listHits(log.all());

    // 앵커 — 저장 전에는 토스트가 아직 없다(실행 단계를 지워도 "보인다"가 green 이 되지 않게)
    expect(screen.queryByTestId('trip-settings-saved-toast')).toBeNull();
    typeTitle('엄마랑 제주');
    expect(save()).toBeEnabled();
    press('trip-settings-save');

    await waitFor(() => expect(routerSpies.back).toHaveBeenCalledTimes(1));
    expect(patchHits()).toBe(1);
    expect(patchBodies[0]).toEqual({
      title: '엄마랑 제주',
      startDate: '2099-06-10',
      endDate: '2099-06-13',
      party: 3,
      companionType: '가족',
      budgetTotal: 1500000,
      destinations: [
        { seq: 1, region: '제주시', nights: 2, regionCode: '50110' },
        { seq: 2, region: '서귀포시', nights: 1, regionCode: '50130' },
      ],
      dayStartAt: '09:30:00',
      firstDayStartAt: null,
      lastDayEndAt: '18:00:00',
    });
    expect('preferenceSnapshot' in patchBodies[0]).toBe(false);
    // 내 여행 목록(홈·기록이 같은 키를 구독)이 다시 받아진다 + 여행 단건 캐시도 새 이름
    await waitFor(() => expect(listHits(log.all())).toBe(listBefore + 1));
    await waitFor(() =>
      expect(
        client.getQueryData<Trip>(getGetTripsTripIdQueryKey(TRIP_ID))?.title
      ).toBe('엄마랑 제주')
    );
    expect(screen.getByTestId('trip-settings-saved-toast')).toHaveTextContent(
      '여행 설정을 저장했어요'
    );
    unwatch();
  });

  it('스택이 없을 때(딥링크) 저장 성공은 일정 탭으로 replace 한다', async () => {
    routerSpies.canGoBack.mockReturnValue(false);
    await openPage();

    typeTitle('새 이름');
    press('trip-settings-save');

    await waitFor(() =>
      expect(routerSpies.replace).toHaveBeenCalledWith('/itinerary')
    );
    expect(routerSpies.back).not.toHaveBeenCalled();
  });

  it('이름을 바꿨다가 원래대로 되돌리면 저장이 다시 꺼진다(바뀐 값이 있을 때만 켜짐 — 한 번 켜지면 계속 켜지는 구현은 red)', async () => {
    await openPage();

    typeTitle('다른 이름');
    expect(save()).toBeEnabled();
    typeTitle('제주 가족 여행');

    await expectSaveBlocked();
    expect(patchHits()).toBe(0);
  });

  it('저장 본문은 누르는 순간의 입력이다 — 이름을 여러 번 고쳐도 마지막 값 하나만 1번 나간다', async () => {
    await openPage();

    typeTitle('A');
    typeTitle('AB');
    typeTitle('ABC');
    press('trip-settings-save');

    await waitFor(() => expect(patchHits()).toBe(1));
    expect(patchBodies[0].title).toBe('ABC');
  });

  it('마운트 스냅샷 함정 — 열린 뒤 다른 곳에서 여행(목적지·예산)이 바뀌었으면 저장 본문은 그 최신 값이고, 입력 중인 이름은 지워지지 않는다', async () => {
    await openPage();
    typeTitle('내가 쓰던 이름');

    // 위저드 등 다른 표면이 같은 여행 캐시를 갱신한 상황 흉내
    const newer: Trip = {
      ...serverTrip,
      budgetTotal: 2000000,
      destinations: [
        { seq: 1, region: '제주시', nights: 1, regionCode: '50110' },
        { seq: 2, region: '서귀포시', nights: 2, regionCode: '50130' },
      ],
    };
    act(() => {
      client.setQueryData(getGetTripsTripIdQueryKey(TRIP_ID), newer);
    });
    expect(screen.getByTestId('trip-settings-title')).toHaveDisplayValue(
      '내가 쓰던 이름'
    );

    press('trip-settings-save');
    await waitFor(() => expect(patchHits()).toBe(1));

    expect(patchBodies[0].title).toBe('내가 쓰던 이름');
    expect(patchBodies[0].budgetTotal).toBe(2000000);
    expect(patchBodies[0].destinations).toEqual(newer.destinations);
  });

  it('범위 밖인 옛 동행 조합(혼자 + 3명)도 건드리지 않으면 그대로 echo 한다 — 이름만 바꿔 저장해도 인원이 1 로 깎이지 않는다', async () => {
    serverTrip = baseTrip({ companionType: '혼자', party: 3 });
    await openPage();

    typeTitle('이름만');
    press('trip-settings-save');

    await waitFor(() => expect(patchHits()).toBe(1));
    expect(patchBodies[0].party).toBe(3);
    expect(patchBodies[0].companionType).toBe('혼자');
  });
});

describe('C · 동행·일과 시트 (AC-7) — 바꾼 값이 본문에 실리고, 어떤 조작에도 기간은 그대로 (AC-2)', () => {
  it('동행 시트: 시드는 GET 값, 연인 칩을 고르면 인원이 2명으로 맞춰지고, 적용하면 행이 바뀌며 저장 본문에 party·companionType 이 실린다', async () => {
    await openPage();
    expect(screen.queryByTestId('trip-wizard-companion-sheet')).toBeNull();

    press('trip-settings-companion');
    expect(screen.getByTestId('trip-wizard-companion-sheet')).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-companion-chip-active-family')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-companion-party-value')
    ).toHaveTextContent('3명');

    press('trip-wizard-companion-chip-partner');
    expect(
      screen.getByTestId('trip-wizard-companion-party-value')
    ).toHaveTextContent('2명');
    press('trip-wizard-companion-apply');

    expect(screen.queryByTestId('trip-wizard-companion-sheet')).toBeNull();
    expect(
      screen.getByTestId('trip-settings-companion-type')
    ).toHaveTextContent('연인');
    expect(screen.getByTestId('trip-settings-party')).toHaveTextContent('2명');
    expect(save()).toBeEnabled();

    press('trip-settings-save');
    await waitFor(() => expect(patchHits()).toBe(1));
    expect(patchBodies[0]).toEqual({
      title: '제주 가족 여행',
      startDate: '2099-06-10',
      endDate: '2099-06-13',
      party: 2,
      companionType: '연인',
      budgetTotal: 1500000,
      destinations: serverTrip.destinations,
      dayStartAt: '09:30:00',
      firstDayStartAt: null,
      lastDayEndAt: '18:00:00',
    });
  });

  it('혼자 칩을 고르면 인원이 1명으로 고정된다(−·+ 잠김)', async () => {
    await openPage();

    press('trip-settings-companion');
    press('trip-wizard-companion-chip-alone');

    expect(
      screen.getByTestId('trip-wizard-companion-party-value')
    ).toHaveTextContent('1명');
    expect(
      screen.getByTestId('trip-wizard-companion-party-dec')
    ).toBeDisabled();
    expect(
      screen.getByTestId('trip-wizard-companion-party-inc')
    ).toBeDisabled();
  });

  it('일과 시트: 시드는 GET 값의 HH:mm, 하루 시작을 10:00 으로 적용하면 행이 바뀌고, 본문의 일과는 시트 결과(HH:mm · 정한 값만)이다', async () => {
    await openPage();
    expect(screen.queryByTestId('trip-wizard-daywindow-sheet')).toBeNull();

    press('trip-settings-day-start');
    expect(screen.getByTestId('trip-wizard-daywindow-sheet')).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-daywindow-tab-day-value')
    ).toHaveTextContent('09:30');
    expect(
      screen.getByTestId('trip-wizard-daywindow-tab-last-value')
    ).toHaveTextContent('18:00');

    press('trip-wizard-daywindow-wheel-h-10');
    press('trip-wizard-daywindow-wheel-m-00');
    press('trip-wizard-daywindow-apply');

    expect(screen.queryByTestId('trip-wizard-daywindow-sheet')).toBeNull();
    expect(
      screen.getByTestId('trip-settings-day-start-value')
    ).toHaveTextContent('10:00 ~ 21:00');

    press('trip-settings-save');
    await waitFor(() => expect(patchHits()).toBe(1));
    expect(patchBodies[0]).toEqual({
      title: '제주 가족 여행',
      startDate: '2099-06-10',
      endDate: '2099-06-13',
      party: 3,
      companionType: '가족',
      budgetTotal: 1500000,
      destinations: serverTrip.destinations,
      dayStartAt: '10:00',
      lastDayEndAt: '18:00',
    });
    expect('firstDayStartAt' in patchBodies[0]).toBe(false);
  });

  it('일과 시트를 열어 값을 안 바꾸고 적용하면 바뀐 게 없는 것이다 — 저장이 켜지지 않고, 서버 원문(HH:mm:ss)을 HH:mm 으로 다시 쓰지 않는다', async () => {
    await openPage();

    press('trip-settings-day-start');
    press('trip-wizard-daywindow-apply');

    expect(screen.queryByTestId('trip-wizard-daywindow-sheet')).toBeNull();
    await expectSaveBlocked();
  });

  it('이름·동행·일과를 모두 바꿔 저장해도 기간(startDate·endDate)·예산·목적지는 GET 값 그대로다(AC-2)', async () => {
    await openPage();

    typeTitle('전부 바꾼 이름');
    press('trip-settings-companion');
    press('trip-wizard-companion-chip-friend');
    press('trip-wizard-companion-apply');
    press('trip-settings-day-start');
    press('trip-wizard-daywindow-wheel-h-11');
    press('trip-wizard-daywindow-wheel-m-30');
    press('trip-wizard-daywindow-apply');
    press('trip-settings-save');

    await waitFor(() => expect(patchHits()).toBe(1));
    const body = patchBodies[0];
    expect(body.title).toBe('전부 바꾼 이름');
    expect(body.companionType).toBe('친구');
    expect(body.dayStartAt).toBe('11:30');
    expect(body.startDate).toBe('2099-06-10');
    expect(body.endDate).toBe('2099-06-13');
    expect(body.budgetTotal).toBe(1500000);
    expect(body.destinations).toEqual(serverTrip.destinations);
    expect('preferenceSnapshot' in body).toBe(false);
  });
});

describe('D · 이름 검증 (AC-3) — 막힘 + 안내', () => {
  it('121 코드포인트는 안내가 뜨고 저장이 막힌다(비활성 · 누름 · 요청 0). 120 으로 줄이면 안내가 사라지고 저장된다', async () => {
    await openPage();

    typeTitle('가'.repeat(121));
    expect(screen.getByTestId('trip-settings-title-error')).toBeOnTheScreen();
    await expectSaveBlocked();

    typeTitle('가'.repeat(120));
    expect(screen.queryByTestId('trip-settings-title-error')).toBeNull();
    expect(save()).toBeEnabled();
    press('trip-settings-save');
    await waitFor(() => expect(patchHits()).toBe(1));
    expect(patchBodies[0].title).toBe('가'.repeat(120));
  });

  it('이모지 120개(UTF-16 으로는 240칸)는 통과하고 본문에 통째로 실린다, 121개는 막힌다', async () => {
    await openPage();

    typeTitle('😀'.repeat(121));
    expect(screen.getByTestId('trip-settings-title-error')).toBeOnTheScreen();
    await expectSaveBlocked();

    typeTitle('😀'.repeat(120));
    expect(screen.queryByTestId('trip-settings-title-error')).toBeNull();
    press('trip-settings-save');
    await waitFor(() => expect(patchHits()).toBe(1));
    expect(patchBodies[0].title).toBe('😀'.repeat(120));
  });

  it.each([
    ['공백만', '   '],
    ['빈 이름', ''],
  ])(
    '이름이 %s: 안내가 뜨고 저장이 막힌다 — 서버가 몰래 "제주시 여행" 으로 바꿔 버리지 않게',
    async (_label, value) => {
      await openPage();

      typeTitle(value);

      expect(screen.getByTestId('trip-settings-title-error')).toBeOnTheScreen();
      await expectSaveBlocked();
    }
  );
});

describe('E · 끝난 여행 (AC-4) — 열리되 잠금', () => {
  it('GET status 가 ENDED 면 화면은 열리고 이유 한 줄이 뜨며, 이름 입력·동행·일과가 막히고 저장이 잠긴다', async () => {
    serverTrip = baseTrip({
      status: 'ENDED',
      startDate: '2020-06-10',
      endDate: '2020-06-13',
      ...CONFIRMED_COLS,
    });
    await openPage();

    expect(screen.getByTestId('trip-settings-locked')).toHaveTextContent(
      '끝난 여행은 바꿀 수 없어요'
    );
    // 이름 입력은 안 바뀐다
    typeTitle('바꿔 보기');
    expect(screen.getByTestId('trip-settings-title')).toHaveDisplayValue(
      '제주 가족 여행'
    );
    // 동행·일과 시트도 안 열린다
    press('trip-settings-companion');
    press('trip-settings-day-start');
    expect(screen.queryByTestId('trip-wizard-companion-sheet')).toBeNull();
    expect(screen.queryByTestId('trip-wizard-daywindow-sheet')).toBeNull();
    await expectSaveBlocked();
  });

  it('날짜가 지난 작성중(일정 미확정) 여행도 잠긴다 — 서버 409 는 확정 여부가 아니라 날짜만 본다(classifyTripPhase 로 판정하면 draft 라 열려 버린다)', async () => {
    serverTrip = baseTrip({
      status: 'ENDED',
      startDate: '2020-06-10',
      endDate: '2020-06-13',
    }); // 일정 상태 칸 없음 = 작성중
    await openPage();

    expect(screen.getByTestId('trip-settings-locked')).toBeOnTheScreen();
    await expectSaveBlocked();
  });

  it('진행 중(ACTIVE) 여행은 잠기지 않는다 — 서버는 여행 중 편집을 허용한다', async () => {
    serverTrip = baseTrip({
      status: 'ACTIVE',
      startDate: '2020-06-10',
      endDate: '2099-06-13',
      ...CONFIRMED_COLS,
    });
    await openPage();

    expect(screen.queryByTestId('trip-settings-locked')).toBeNull();
    typeTitle('여행 중 이름');
    expect(save()).toBeEnabled();
  });

  it('저장 응답이 409(화면을 열어 둔 채 자정을 넘긴 경우)면 같은 잠금 얼굴로 바뀐다 — 오류·다시 시도가 아니다, 토스트·뒤로 없음', async () => {
    patchQueue = [CONFLICT_409];
    await openPage();

    typeTitle('늦은 저장');
    press('trip-settings-save');

    expect(await screen.findByTestId('trip-settings-locked')).toHaveTextContent(
      '끝난 여행은 바꿀 수 없어요'
    );
    expect(patchHits()).toBe(1);
    expect(screen.queryByTestId('trip-settings-error')).toBeNull();
    expect(screen.queryByTestId('trip-settings-retry')).toBeNull();
    expect(screen.queryByTestId('trip-settings-saved-toast')).toBeNull();
    expect(routerSpies.back).not.toHaveBeenCalled();
    await expectSaveBlocked();
  });
});

describe('F · 저장 실패 (AC-5 · INV-4) — 입력 유지 + 오류 + 다시 시도', () => {
  it.each([
    ['서버 5xx', ERROR_500],
    ['네트워크 오류', NETWORK_ERROR],
  ])(
    '%s: 오류 줄과 다시 시도가 뜨고 입력은 그대로이며 토스트·뒤로·목록 갱신이 없다. 다시 시도는 그 순간의 입력으로 한 번 더 보낸다',
    async (_label, failure) => {
      patchQueue = [failure];
      await openPage();
      const unwatch = watchTripsList(client);
      await waitFor(() => expect(listHits(log.all())).toBe(1));

      typeTitle('실패할 이름');
      press('trip-settings-save');

      expect(
        await screen.findByTestId('trip-settings-error')
      ).toBeOnTheScreen();
      expect(screen.getByTestId('trip-settings-retry')).toBeEnabled();
      expect(screen.getByTestId('trip-settings-title')).toHaveDisplayValue(
        '실패할 이름'
      );
      expect(screen.queryByTestId('trip-settings-saved-toast')).toBeNull();
      expect(routerSpies.back).not.toHaveBeenCalled();
      expect(listHits(log.all())).toBe(1);
      expect(patchHits()).toBe(1);

      // 오류 상태에서 이름을 다시 고치고 다시 시도 → 새 이름으로 성공
      typeTitle('고친 이름');
      press('trip-settings-retry');

      await waitFor(() => expect(routerSpies.back).toHaveBeenCalledTimes(1));
      expect(patchHits()).toBe(2);
      expect(patchBodies[1].title).toBe('고친 이름');
      expect(screen.queryByTestId('trip-settings-error')).toBeNull();
      unwatch();
    }
  );

  // 통합 QA D2(11-06) — [저장] 연타의 둘째 탭이 뒤로 간 목록의 다른 카드를 눌렀다. 이동하는 순간 연타 창이 열려 있어야
  // 목록 카드(guardPress)가 그 탭을 버린다.
  it('저장 성공으로 뒤로 가는 순간 연타 창이 열려 있다 — 둘째 탭이 뒤 화면(목록 카드)에 닿아도 무시된다 (D2)', async () => {
    let openAtBack: boolean | null = null;
    routerSpies.back.mockImplementationOnce(() => {
      openAtBack = pressWindowOpen();
    });
    await openPage();

    typeTitle('연타 이름');
    press('trip-settings-save'); // 누르기 전에 창을 닫는다 — 열려 있다면 이동이 연 것이다

    await waitFor(() => expect(routerSpies.back).toHaveBeenCalledTimes(1));
    expect(openAtBack).toBe(true);
  });

  it('응답을 기다리는 동안 저장을 연타해도 PATCH 는 1번이다', async () => {
    let release: () => void = () => {};
    patchGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await openPage();

    typeTitle('연타 이름');
    fireEvent.press(save());
    fireEvent.press(save());
    fireEvent.press(save());
    await settle();
    expect(patchHits()).toBe(1);

    release();
    await waitFor(() => expect(routerSpies.back).toHaveBeenCalledTimes(1));
    expect(patchHits()).toBe(1);
  });
});

describe('G · 삭제 (AC-6 · D7)', () => {
  it('「여행 삭제」를 누르면 확인 다이얼로그만 뜨고 DELETE 는 0번이다. 취소하면 다이얼로그가 닫히고 여전히 0번이다', async () => {
    await openPage();

    press('trip-settings-delete');
    expect(screen.getByTestId('my-trip-delete-dialog')).toBeOnTheScreen();
    expect(
      screen.getByText('작성 중인 일정도 함께 지워지고 되돌릴 수 없어요.')
    ).toBeOnTheScreen();
    await settle();
    expect(deleteHits()).toBe(0);

    press('my-trip-delete-cancel');
    expect(screen.queryByTestId('my-trip-delete-dialog')).toBeNull();
    await settle();
    expect(deleteHits()).toBe(0);
    expect(routerSpies.dismissTo).not.toHaveBeenCalled();
  });

  it('확인하면 DELETE 1번 → 내 여행 목록을 다시 받고 일정 탭으로 돌아간다(연타해도 DELETE 1번)', async () => {
    await openPage();
    const unwatch = watchTripsList(client);
    await waitFor(() => expect(listHits(log.all())).toBe(1));

    press('trip-settings-delete');
    fireEvent.press(screen.getByTestId('my-trip-delete-confirm'));
    fireEvent.press(screen.getByTestId('my-trip-delete-confirm'));

    await waitFor(() =>
      expect(routerSpies.dismissTo).toHaveBeenCalledWith(DELETE_DONE_HREF)
    );
    expect(deleteHits()).toBe(1);
    expect(routerSpies.dismissTo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(listHits(log.all())).toBe(2));
    unwatch();
  });

  // 통합 QA D3(11-06) — [삭제] 연타의 둘째 탭이 돌아간 목록의 **지운 카드**(무효화만 해서 재조회 전까지 남아 있음)를 열었다.
  // 돌아가는 순간 목록 캐시에서 이미 빠져 있고, 연타 창도 열려 있어야 한다.
  it.each<[string, (() => Response)[]]>([
    ['204', []],
    [
      '404(이미 없음)',
      [
        () =>
          HttpResponse.json(
            { code: 'NOT_FOUND', message: 'gone' },
            { status: 404 }
          ),
      ],
    ],
  ])(
    '삭제 %s 로 돌아가는 순간 목록 캐시에 지운 여행이 없고 연타 창이 열려 있다 (D3)',
    async (_l, queue) => {
      deleteQueue = queue;
      let listAtDismiss: Trip[] | undefined;
      let openAtDismiss: boolean | null = null;
      routerSpies.dismissTo.mockImplementationOnce(() => {
        listAtDismiss = client.getQueryData<Trip[]>(getGetTripsQueryKey());
        openAtDismiss = pressWindowOpen();
      });
      await openPage();
      const unwatch = watchTripsList(client);
      // 앵커 — 목록 캐시에 이 여행이 들어 있다(빼는 단언이 공허하지 않게).
      await waitFor(() =>
        expect(
          client
            .getQueryData<Trip[]>(getGetTripsQueryKey())
            ?.map((t) => t.tripId)
        ).toEqual([TRIP_ID])
      );

      press('trip-settings-delete');
      press('my-trip-delete-confirm');

      await waitFor(() =>
        expect(routerSpies.dismissTo).toHaveBeenCalledWith(DELETE_DONE_HREF)
      );
      expect(listAtDismiss?.map((t) => t.tripId)).toEqual([]);
      expect(openAtDismiss).toBe(true);
      unwatch();
    }
  );

  it('이미 없는 여행(404)은 성공으로 본다 — 안내 없이 일정 탭으로 돌아가고 목록을 다시 받는다', async () => {
    deleteQueue = [
      () =>
        HttpResponse.json(
          { code: 'NOT_FOUND', message: 'gone' },
          { status: 404 }
        ),
    ];
    await openPage();

    press('trip-settings-delete');
    press('my-trip-delete-confirm');

    await waitFor(() =>
      expect(routerSpies.dismissTo).toHaveBeenCalledWith(DELETE_DONE_HREF)
    );
    expect(screen.queryByTestId('my-trip-delete-error')).toBeNull();
  });

  it('서버 5xx 면 다이얼로그가 안에서 실패 문구를 보이고 닫히지 않으며 이동이 없다. 다시 확인하면 한 번 더 보내 성공한다', async () => {
    deleteQueue = [ERROR_500];
    await openPage();

    press('trip-settings-delete');
    press('my-trip-delete-confirm');

    expect(await screen.findByTestId('my-trip-delete-error')).toHaveTextContent(
      '삭제하지 못했어요. 다시 시도해 주세요.'
    );
    expect(screen.getByTestId('my-trip-delete-dialog')).toBeOnTheScreen();
    expect(routerSpies.dismissTo).not.toHaveBeenCalled();

    press('my-trip-delete-confirm');
    await waitFor(() =>
      expect(routerSpies.dismissTo).toHaveBeenCalledWith(DELETE_DONE_HREF)
    );
    expect(deleteHits()).toBe(2);
  });

  it('확정한 일정이 있는 여행(시작 전)은 확정 문구로 묻는다', async () => {
    serverTrip = baseTrip({ status: 'CONFIRMED', ...CONFIRMED_COLS });
    await openPage();

    press('trip-settings-delete');

    expect(
      screen.getByText(
        '확정한 일정과 예정 알림도 함께 지워지고 되돌릴 수 없어요.'
      )
    ).toBeOnTheScreen();
  });

  // 노출 조건 — 내 여행 목록 ⋯ 의 「삭제」와 같다: 작성중(날짜 무관) 또는 확정 + 시작 전.
  it.each<[string, Partial<Trip>, boolean]>([
    ['작성중 · 시작 전', {}, true],
    [
      '작성중 · 이미 끝난 날짜',
      { status: 'ENDED', startDate: '2020-06-10', endDate: '2020-06-13' },
      true,
    ],
    ['확정 · 시작 전', { status: 'CONFIRMED', ...CONFIRMED_COLS }, true],
    [
      '확정 · 여행 중',
      {
        status: 'ACTIVE',
        startDate: '2020-06-10',
        endDate: '2099-06-13',
        ...CONFIRMED_COLS,
      },
      false,
    ],
    [
      '확정 · 끝남',
      {
        status: 'ENDED',
        startDate: '2020-06-10',
        endDate: '2020-06-13',
        ...CONFIRMED_COLS,
      },
      false,
    ],
  ])('삭제 버튼 노출 — %s', async (_label, over, visible) => {
    serverTrip = baseTrip(over);
    await openPage();

    if (visible) {
      expect(screen.getByTestId('trip-settings-delete')).toBeOnTheScreen();
    } else {
      expect(screen.queryByTestId('trip-settings-delete')).toBeNull();
    }
  });
});

describe('H · 조회 얼굴 (D10)', () => {
  it('여행을 받는 동안은 로딩 얼굴만 있고 입력·저장은 없다', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    getQueue = [
      async () => {
        await gate;
        return HttpResponse.json(serverTrip);
      },
    ];
    client = newTestQueryClient();
    renderWithQueryClient(
      <WithToastHost>
        <TripSettingsPage tripId={TRIP_ID} />
      </WithToastHost>,
      client
    );

    expect(
      await screen.findByTestId('trip-settings-loading')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-settings-title')).toBeNull();
    expect(screen.queryByTestId('trip-settings-save')).toBeNull();

    release();
    expect(await screen.findByTestId('trip-settings-root')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-settings-loading')).toBeNull();
  });

  it('조회 실패(5xx)는 오류 얼굴 + 다시 시도 — 입력·저장은 없고, 다시 시도하면 화면이 열린다', async () => {
    getQueue = [ERROR_500];
    client = newTestQueryClient();
    renderWithQueryClient(
      <WithToastHost>
        <TripSettingsPage tripId={TRIP_ID} />
      </WithToastHost>,
      client
    );

    expect(
      await screen.findByTestId('trip-settings-fetch-error')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-settings-title')).toBeNull();
    expect(screen.queryByTestId('trip-settings-save')).toBeNull();

    press('trip-settings-fetch-retry');

    expect(await screen.findByTestId('trip-settings-title')).toHaveDisplayValue(
      '제주 가족 여행'
    );
    expect(screen.queryByTestId('trip-settings-fetch-error')).toBeNull();
  });

  it('없는 여행(404)은 「여행을 찾을 수 없어요」 — 다시 시도 버튼이 없다', async () => {
    getQueue = [
      () =>
        HttpResponse.json(
          { code: 'NOT_FOUND', message: 'gone' },
          { status: 404 }
        ),
    ];
    client = newTestQueryClient();
    renderWithQueryClient(
      <WithToastHost>
        <TripSettingsPage tripId={TRIP_ID} />
      </WithToastHost>,
      client
    );

    expect(
      await screen.findByTestId('trip-settings-notfound')
    ).toHaveTextContent('여행을 찾을 수 없어요');
    expect(screen.queryByTestId('trip-settings-save')).toBeNull();
    expect(screen.queryByTestId('trip-settings-fetch-retry')).toBeNull();
  });
});

// TRIP-1787 5-b 보강 — code-critic 경고 1·2. 성공 처리 위치(훅 옵션 vs 호출별 콜백)와 같은 틱 이중 누름은
// 화면이 마운트된 채로 응답을 받는 앞 케이스들로는 밟히지 않는다.
describe('I · 5-b 보강 — 응답 전에 떠나기 · 같은 틱 이중 저장', () => {
  it('저장 응답이 오기 전에 화면을 떠나도, 성공하면 단건 캐시가 새 이름으로 바뀌고 내 여행 목록을 다시 받는다', async () => {
    let release: () => void = () => {};
    patchGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await openPage();
    const unwatch = watchTripsList(client);
    await waitFor(() => expect(listHits(log.all())).toBe(1));

    typeTitle('떠나며 저장');
    press('trip-settings-save');
    await waitFor(() => expect(patchHits()).toBe(1));

    screen.unmount();
    release();

    await waitFor(() => expect(listHits(log.all())).toBe(2));
    expect(
      client.getQueryData<Trip>(getGetTripsTripIdQueryKey(TRIP_ID))?.title
    ).toBe('떠나며 저장');
    unwatch();
  });

  it('삭제 응답이 오기 전에 화면을 떠나도, 성공하면 내 여행 목록을 다시 받는다', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    deleteQueue = [
      async () => {
        await gate;
        return new HttpResponse(null, { status: 204 });
      },
    ];
    await openPage();
    const unwatch = watchTripsList(client);
    await waitFor(() => expect(listHits(log.all())).toBe(1));

    press('trip-settings-delete');
    press('my-trip-delete-confirm');
    await waitFor(() => expect(deleteHits()).toBe(1));

    screen.unmount();
    release();

    await waitFor(() => expect(listHits(log.all())).toBe(2));
    unwatch();
  });

  it('한 번의 act 안에서 [저장]을 두 번 눌러도(같은 렌더 클로저) PATCH 는 1번이다', async () => {
    let release: () => void = () => {};
    patchGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await openPage();

    typeTitle('이중 탭 이름');
    const button = save();
    resetPressGuard();
    act(() => {
      fireEvent.press(button);
      fireEvent.press(button);
    });
    await settle();
    expect(patchHits()).toBe(1);

    release();
    await waitFor(() => expect(routerSpies.back).toHaveBeenCalledTimes(1));
    expect(patchHits()).toBe(1);
  });
});
