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
import {
  guardPress,
  openPressGuardWindow,
  resetPressGuard,
} from '@/shared/lib/pressGuard';
import {
  coverChoices,
  coverSourceForKey,
  tripCoverSource,
} from '@/entities/trip';
import { BASE } from '@/test-support/apiBase';
import { freezeDate } from '@/test-support/freezeDate';
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
 *  A. 화면: GET 값으로 칸을 채운다(이름 입력·동행·인원·일과 `HH:mm`), 여행지는 보기만(눌러도 아무 일 없다).
 *     (TRIP-1788 이 1787 의 "기간·커버도 보기만"을 뒤집었다 — 기간·커버는 아래 J~Q 가 맡는다.)
 *  B. 이름 저장(AC-1·2): 바뀐 값이 있을 때만 저장이 켜지고, PATCH 는 정확히 1번 · 본문은 GET 의 나머지 칸 그대로(취향 스냅샷 키 없음)
 *     · 성공하면 목록 다시 받기 + 토스트 + 뒤로. 본문은 누르는 순간의 입력 + 그 순간의 최신 여행으로 만든다.
 *  C. 동행·일과 시트(AC-7): 시트로 바꾼 값이 PATCH 에 실리고, 안 건드린 일과는 `HH:mm:ss` 원문 그대로 나간다. 기간을 안 건드리면 기간은 그대로.
 *  D. 이름 검증(AC-3): 121 코드포인트·공백·빈 이름은 막힘 + 안내. 막힘 = 비활성 + 실제 누름 + 요청 0회 세 겹.
 *  E. 끝난 여행(AC-4): GET `status==='ENDED'` 면 열리되 잠금 + 이유 한 줄. 저장 응답 409 도 같은 잠금 얼굴.
 *  F. 실패(AC-5): 5xx·네트워크 → 입력 유지 + 오류 + 다시 시도(INV-4). 연타는 PATCH 1번.
 *  G. 삭제(AC-6): 확인 전 DELETE 0 · 성공(204·404) 뒤 일정 탭으로. 노출 조건은 내 여행 목록의 ⋯ 삭제와 같다.
 *  H. 조회 얼굴: 로딩 · 실패(다시 시도) · 404.
 *
 *  --- TRIP-1788 (기간 날짜 이동 · 일수 변경 재생성 · 커버 고르기) — 아래 describe J~Q, 시계는 서울 2099-05-20 로 고정 ---
 *  J. 기간 행 잠금·열림(AC-4)  K. 기간 시트 기본 모드(AC-1·2)  L. 끝일 모드(AC-3·D10)  M. 일수 변경 확인창·확정(AC-3·11)
 *  N. 409 가르기(AC-5)  O. 커버 고르기(AC-6·8·9, 소비처 ⑥)  P. 캐시(AC-1·D11)  Q. 연타(AC-11)
 *  새 개념 — **누름 가드 창**: 한 번 누르면 400ms 동안 다른 누름을 무시하는 전역 창. 화면이 바뀌는 순간(적용·이동)에 열어 둬야 연타 둘째
 *  탭이 뒤 화면 버튼을 못 누른다. 시계(`Date`)를 고정하면 창이 안 닫히므로 이 파일은 누르기 전 `resetPressGuard()`(=`press()`)를 쓴다.
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
  jest.useRealTimers(); // J~Q 가 `freezeDate` 로 고정한 시계를 되돌린다 — 파일 최상위 한 곳
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

describe('A · 화면 — GET 값으로 채우고, 여행지는 보기만', () => {
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

  it('여행지 행은 눌러도 아무 일이 없다 — 시트·이동·요청 0 (여행지 변경은 이번 범위 밖)', async () => {
    await openPage();

    press('trip-settings-destinations');
    await settle();

    expect(screen.queryByTestId('trip-wizard-companion-sheet')).toBeNull();
    expect(screen.queryByTestId('trip-wizard-daywindow-sheet')).toBeNull();
    expect(screen.queryByTestId('trip-wizard-period-sheet')).toBeNull();
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

describe('C · 동행·일과 시트 (AC-7) — 바꾼 값이 본문에 실리고, 기간을 안 건드리면 기간은 그대로', () => {
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

  it('이름·동행·일과를 모두 바꿔 저장해도(기간 시트는 안 엶) 기간(startDate·endDate)·예산·목적지는 GET 값 그대로다', async () => {
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

// ════════════════════════════════════════════════════════════════════════════
// TRIP-1788 · 기간 날짜 이동 · 일수 변경(일정 버리고 다시) · 커버 고르기
// 시계는 서울 2099-05-20(정오)로 고정한다 — 시작일 2099-06-10 은 "시작 전", 달 넘김·다음 달 이동(오늘+24개월 상한 안)이 된다.
// ════════════════════════════════════════════════════════════════════════════

const TODAY_ISO = '2099-05-20T03:00:00Z';
const HINT_OPEN = '날짜를 옮기거나 일수를 바꿀 수 있어요';
const HINT_STARTED = '여행이 시작돼 기간은 바꿀 수 없어요';
const HINT_GENERATING = '일정을 만드는 중이에요. 끝난 뒤 바꿀 수 있어요';
const HINT_ENDED = '끝난 여행은 바꿀 수 없어요';
const NOTE_SHIFT = '일수는 그대로 두고 시작일만 옮겨요';
const NOTE_LENGTH = '끝나는 날을 골라요 · 일수가 바뀌면 일정을 다시 짜요';
const METHOD_HREF = `/trips/${TRIP_ID}/itinerary/method`;

const freezeToday = () => freezeDate(TODAY_ISO);
/** 시계를 앞으로 돌린다(고정된 `Date` 는 저절로 안 흐른다). */
const advanceClock = (ms: number) => jest.setSystemTime(Date.now() + ms);

const hint = () => screen.getByTestId('trip-settings-period-hint');
const periodChevron = () =>
  screen.queryByTestId('trip-settings-period-chevron');
const periodSheet = () => screen.queryByTestId('trip-wizard-period-sheet');
const startMark = (date: string) =>
  screen.queryByTestId(`trip-wizard-period-cell-start-${date}`);
const endMark = (date: string) =>
  screen.queryByTestId(`trip-wizard-period-cell-end-${date}`);
const lengthDialog = () => screen.queryByTestId('trip-settings-length-dialog');

const openPeriodSheet = () => press('trip-settings-period');
const pickDate = (date: string) => press(`trip-wizard-period-cell-${date}`);
const applyPeriod = () => press('trip-wizard-period-apply');
const nextMonth = () => press('trip-wizard-period-next');
const prevMonth = () => press('trip-wizard-period-prev');
/** 「일수 바꾸기」 → 끝일 모드로 `tapped` 를 눌러 [적용] — 일수가 달라지면 확인창이 뜬다. */
function changeLengthAndApply(tapped: string): void {
  openPeriodSheet();
  press('trip-wizard-period-change-length');
  pickDate(tapped);
  applyPeriod();
}
const confirmLength = () => press('trip-settings-length-confirm');
const periodText = () => screen.getByTestId('trip-settings-period');

/** `router.replace` 인자(문자열 또는 `{pathname, params}`)를 실제 주소로 읽는다. */
function hrefOf(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  const { pathname, params } = arg as {
    pathname: string;
    params: Record<string, string>;
  };
  return pathname.replace(/\[(\w+)\]/g, (_m, key: string) => params[key]);
}

const error409 = (code: string) => () =>
  HttpResponse.json(
    { error: { code, message: '기간을 바꿀 수 없습니다.' } },
    { status: 409 }
  );

const coverImage = () =>
  screen.getByTestId('trip-settings-cover-image').props.source;
const coverOption = (key: string) =>
  screen.getByTestId(`trip-settings-cover-option-${key}`);
const openCoverSheet = () => press('trip-settings-cover-change');
/** jest 엔 레이아웃이 없어 칸이 스스로 안 늘어난다 — 크기를 알려 주고 맨 끝 스크롤 이벤트를 쏜다(칸 높이는 대략값이라 큼직하게). */
const COVER_GRID_HEIGHT = 8000;
const scrollCoverGridTo = (y: number) => {
  const grid = screen.getByTestId('trip-settings-cover-sheet');
  const layoutMeasurement = { width: 390, height: 600 };
  const contentSize = { width: 390, height: COVER_GRID_HEIGHT };
  fireEvent(grid, 'layout', { nativeEvent: { layout: layoutMeasurement } });
  fireEvent(grid, 'contentSizeChange', contentSize.width, contentSize.height);
  fireEvent.scroll(grid, {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize,
      layoutMeasurement,
    },
  });
};
const scrollCoverGridToEnd = () => scrollCoverGridTo(COVER_GRID_HEIGHT - 600);
const mountedCoverOptions = () =>
  screen.queryAllByTestId(/^trip-settings-cover-option-/);

describe('J · 기간 행 잠금·열림 (AC-4)', () => {
  beforeEach(freezeToday);

  it('시작 전 여행은 기간 행에 chevron 과 보조문이 있고, 눌러서 시트가 열린다', async () => {
    await openPage();

    expect(periodChevron()).toBeOnTheScreen();
    expect(hint()).toHaveTextContent(HINT_OPEN);
    expect(periodSheet()).toBeNull(); // 아직 안 열림(앵커)
    openPeriodSheet();
    expect(periodSheet()).toBeOnTheScreen();
  });

  it.each<[string, Partial<Trip>, string]>([
    [
      '시작일이 오늘(서버는 < 라 FE 가 하루 더 보수적 — 사용자 결정 "여행 중 잠금")',
      { startDate: '2099-05-20', endDate: '2099-05-23', status: 'ACTIVE' },
      HINT_STARTED,
    ],
    [
      '시작일이 지남',
      { startDate: '2099-05-01', endDate: '2099-05-30', status: 'ACTIVE' },
      HINT_STARTED,
    ],
    [
      '끝난 여행',
      { status: 'ENDED', startDate: '2099-04-01', endDate: '2099-04-03' },
      HINT_ENDED,
    ],
    [
      '일정 생성 중',
      {
        itineraryGenerating: true,
        itineraryStatus: 'PLANNED',
        itineraryGenerationState: 'PARTIAL',
        itineraryGenerationMode: 'FULLY_AI',
      },
      HINT_GENERATING,
    ],
  ])(
    '%s → chevron 없음 · 눌러도 시트 안 열림 · 이유 보조문',
    async (_label, over, expectedHint) => {
      serverTrip = baseTrip(over);
      await openPage();

      expect(periodChevron()).toBeNull();
      expect(hint()).toHaveTextContent(expectedHint);
      press('trip-settings-period');
      await settle();
      expect(periodSheet()).toBeNull();
      expect(patchHits()).toBe(0);
    }
  );

  it('경계 짝 — 시작일이 오늘이면 잠기고 오늘+1 이면 열린다', async () => {
    serverTrip = baseTrip({
      startDate: '2099-05-20',
      endDate: '2099-05-23',
      status: 'ACTIVE',
    });
    await openPage();
    expect(periodChevron()).toBeNull();
    screen.unmount();

    serverTrip = baseTrip({ startDate: '2099-05-21', endDate: '2099-05-24' });
    await openPage();
    expect(periodChevron()).toBeOnTheScreen();
    openPeriodSheet();
    expect(periodSheet()).toBeOnTheScreen();
  });

  it('시작이 지난(끝나지 않은) 여행도 이름 저장과 커버는 계속 열려 있고, 끝난 여행은 커버 버튼이 없다', async () => {
    serverTrip = baseTrip({
      startDate: '2099-05-01',
      endDate: '2099-05-30',
      status: 'ACTIVE',
    });
    await openPage();

    expect(screen.queryByTestId('trip-settings-locked')).toBeNull();
    expect(screen.getByTestId('trip-settings-cover-change')).toBeOnTheScreen();
    typeTitle('여행 중에도 이름은');
    expect(save()).toBeEnabled();
    screen.unmount();

    serverTrip = baseTrip({
      status: 'ENDED',
      startDate: '2099-04-01',
      endDate: '2099-04-03',
    });
    await openPage();
    expect(screen.getByTestId('trip-settings-locked')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-settings-cover-change')).toBeNull();
  });
});

describe('K · 기간 시트 기본 모드 — 시작을 옮기면 끝이 같은 일수로 따라온다 (AC-1 · AC-2)', () => {
  beforeEach(freezeToday);

  it('열면 서버 기간이 시작·끝 표식으로 보이고, 기본 안내 문구와 「일수 바꾸기」 버튼이 있다', async () => {
    await openPage();

    openPeriodSheet();

    expect(startMark('2099-06-10')).toBeOnTheScreen();
    expect(endMark('2099-06-13')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-wizard-period-note')).toHaveTextContent(
      NOTE_SHIFT
    );
    expect(
      screen.getByTestId('trip-wizard-period-change-length')
    ).toHaveTextContent('일수 바꾸기');
  });

  it('날짜를 누르면 그 날이 새 시작이 되고 끝은 같은 일수(3박)로 따라온다 — 달을 넘겨도', async () => {
    await openPage();
    openPeriodSheet();

    pickDate('2099-06-20');
    expect(startMark('2099-06-20')).toBeOnTheScreen();
    expect(endMark('2099-06-23')).toBeOnTheScreen();
    expect(startMark('2099-06-10')).toBeNull();
    expect(endMark('2099-06-13')).toBeNull();

    pickDate('2099-06-29'); // 끝이 다음 달(7월 2일)로 넘어간다
    expect(startMark('2099-06-29')).toBeOnTheScreen();
    nextMonth();
    expect(endMark('2099-07-02')).toBeOnTheScreen();
    prevMonth();
    expect(startMark('2099-06-29')).toBeOnTheScreen();
  });

  it('고르는 동안(적용 전)은 화면의 기간·저장 버튼이 그대로이고, [적용] 하면 시트가 닫히고 기간 줄이 바뀌며 저장이 켜진다 — 서버 요청은 0', async () => {
    await openPage();
    openPeriodSheet();
    pickDate('2099-06-20');

    expect(periodText()).toHaveTextContent(/6월 10일.*13일/);
    expect(save()).toBeDisabled();

    applyPeriod();

    expect(periodSheet()).toBeNull();
    expect(periodText()).toHaveTextContent(/6월 20일.*23일/);
    expect(screen.getByTestId('trip-settings-period')).toHaveTextContent(
      /3박 4일/
    );
    expect(save()).toBeEnabled();
    expect(patchHits()).toBe(0);
    expect(lengthDialog()).toBeNull();
  });

  it('저장하면 PATCH 1번 — 새 시작·같은 일수·목적지 그대로, 일정을 버리라는 플래그와 커버 키는 없다 → 토스트·뒤로', async () => {
    await openPage();
    openPeriodSheet();
    pickDate('2099-06-20');
    applyPeriod();

    press('trip-settings-save');

    await waitFor(() => expect(routerSpies.back).toHaveBeenCalledTimes(1));
    expect(patchHits()).toBe(1);
    expect(patchBodies[0]).toEqual({
      title: '제주 가족 여행',
      startDate: '2099-06-20',
      endDate: '2099-06-23',
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
    expect('discardItinerary' in patchBodies[0]).toBe(false);
    expect('coverKey' in patchBodies[0]).toBe(false);
    expect(routerSpies.replace).not.toHaveBeenCalled();
  });

  it('[적용] 한 기간으로 시트를 다시 열면 그 값에서 시작하고, 두 번 고쳐도 PATCH 는 마지막 값 하나다', async () => {
    await openPage();
    openPeriodSheet();
    pickDate('2099-06-20');
    applyPeriod();

    openPeriodSheet();
    expect(startMark('2099-06-20')).toBeOnTheScreen();
    expect(endMark('2099-06-23')).toBeOnTheScreen();
    pickDate('2099-06-25');
    applyPeriod();
    press('trip-settings-save');

    await waitFor(() => expect(routerSpies.back).toHaveBeenCalledTimes(1));
    expect(patchHits()).toBe(1);
    expect(patchBodies[0].startDate).toBe('2099-06-25');
    expect(patchBodies[0].endDate).toBe('2099-06-28');
  });
});

describe('L · 끝일 모드 — 「일수 바꾸기」 (AC-3 · D10)', () => {
  beforeEach(freezeToday);

  async function openLengthMode(): Promise<void> {
    await openPage();
    openPeriodSheet();
    press('trip-wizard-period-change-length');
  }

  it('「일수 바꾸기」를 누르면 그 버튼이 사라지고 안내 문구가 끝일 모드로 바뀐다(기간은 그대로)', async () => {
    await openPage();
    openPeriodSheet();
    expect(screen.getByTestId('trip-wizard-period-note')).toHaveTextContent(
      NOTE_SHIFT
    );

    press('trip-wizard-period-change-length');

    expect(screen.queryByTestId('trip-wizard-period-change-length')).toBeNull();
    expect(screen.getByTestId('trip-wizard-period-note')).toHaveTextContent(
      NOTE_LENGTH
    );
    expect(startMark('2099-06-10')).toBeOnTheScreen();
    expect(endMark('2099-06-13')).toBeOnTheScreen();
  });

  it('시작 이후 날짜를 누르면 끝이 바뀐다(시작 유지)', async () => {
    await openLengthMode();

    pickDate('2099-06-20');

    expect(startMark('2099-06-10')).toBeOnTheScreen();
    expect(endMark('2099-06-20')).toBeOnTheScreen();
    expect(endMark('2099-06-13')).toBeNull();
  });

  it('시작 이전 날짜를 누르면 시작이 바뀌고 끝은 그대로다', async () => {
    await openLengthMode();

    pickDate('2099-06-05');

    expect(startMark('2099-06-05')).toBeOnTheScreen();
    expect(endMark('2099-06-13')).toBeOnTheScreen();
    expect(startMark('2099-06-10')).toBeNull();
  });

  it('시작일 자신을 누르면 당일치기가 된다(끝 표식 없음)', async () => {
    await openLengthMode();

    pickDate('2099-06-10');

    expect(startMark('2099-06-10')).toBeOnTheScreen();
    expect(endMark('2099-06-10')).toBeNull();
    expect(endMark('2099-06-13')).toBeNull();
  });

  it('시작+30일보다 먼 날을 누르면 끝이 시작+30일(7월 10일)로 잘려 달력에 보인다', async () => {
    await openLengthMode();
    nextMonth();

    pickDate('2099-07-25');

    expect(endMark('2099-07-10')).toBeOnTheScreen();
    expect(endMark('2099-07-25')).toBeNull();
  });

  it('일수가 달라지는 [적용] 은 시트를 닫고 확인창을 띄운다 — 서버 요청도 이동도 아직 0', async () => {
    await openLengthMode();
    pickDate('2099-06-20');
    expect(lengthDialog()).toBeNull(); // 앵커 — 적용 전엔 창이 없다

    applyPeriod();

    expect(periodSheet()).toBeNull();
    expect(lengthDialog()).toBeOnTheScreen();
    expect(screen.getByTestId('trip-settings-length-title')).toHaveTextContent(
      '일수가 바뀌면 일정을 다시 짜야 해요'
    );
    expect(patchHits()).toBe(0);
    expect(routerSpies.replace).not.toHaveBeenCalled();
  });

  it('끝일 모드여도 결과 일수가 그대로면 확인창 없이 드래프트로 닫힌다(저장도 안 켜진다 — 바뀐 게 없다)', async () => {
    await openLengthMode();
    pickDate('2099-06-13'); // 원래 끝일

    applyPeriod();

    expect(periodSheet()).toBeNull();
    expect(lengthDialog()).toBeNull();
    expect(save()).toBeDisabled();
    expect(patchHits()).toBe(0);
  });
});

describe('M · 일수 변경 확인창과 확정 (AC-3 · AC-11)', () => {
  beforeEach(freezeToday);

  it('[취소] → 창이 닫히고 PATCH·이동 0, 기간도 저장 버튼도 그대로다', async () => {
    await openPage();
    changeLengthAndApply('2099-06-20');
    expect(lengthDialog()).toBeOnTheScreen();

    press('trip-settings-length-cancel');

    expect(lengthDialog()).toBeNull();
    expect(patchHits()).toBe(0);
    expect(routerSpies.replace).not.toHaveBeenCalled();
    expect(periodText()).toHaveTextContent(/6월 10일.*13일/);
    expect(save()).toBeDisabled();
  });

  it('줄이는 확정 → PATCH 1번(일정 버림 플래그·새 기간·고친 이름·현재 커버·박수 합 ≤ 새 박수) → 같은 여행의 일정 방식 선택으로 replace 1번', async () => {
    serverTrip = baseTrip({ coverKey: '26350', ...CONFIRMED_COLS });
    await openPage();
    typeTitle('다시 만들 이름');
    changeLengthAndApply('2099-06-11'); // 3박 → 1박
    expect(patchHits()).toBe(0);
    expect(routerSpies.replace).not.toHaveBeenCalled();

    confirmLength();

    await waitFor(() => expect(routerSpies.replace).toHaveBeenCalledTimes(1));
    expect(patchHits()).toBe(1);
    const body = patchBodies[0];
    expect(body.discardItinerary).toBe(true);
    expect(body.startDate).toBe('2099-06-10');
    expect(body.endDate).toBe('2099-06-11');
    expect(body.title).toBe('다시 만들 이름');
    expect(body.coverKey).toBe('26350');
    expect(body.budgetTotal).toBe(1500000);
    // 3박 → 1박: 서귀포시(1박)가 0박이 돼 빠지고 제주시만 남는다(사용자 결정 2026-11-06).
    expect(body.destinations).toEqual([
      { seq: 1, region: '제주시', nights: 1, regionCode: '50110' },
    ]);
    expect(hrefOf(routerSpies.replace.mock.calls[0][0])).toBe(METHOD_HREF);
    expect(routerSpies.back).not.toHaveBeenCalled();
  });

  it('늘리는 확정 → 박수 합이 새 박수 이하이고 마지막 여행지만 늘어난다', async () => {
    await openPage();
    changeLengthAndApply('2099-06-20'); // 3박 → 10박

    confirmLength();

    await waitFor(() => expect(routerSpies.replace).toHaveBeenCalledTimes(1));
    const body = patchBodies[0];
    expect(body.endDate).toBe('2099-06-20');
    expect(body.discardItinerary).toBe(true);
    expect(body.destinations.map((one) => one.nights)).toEqual([2, 8]);
    expect(body.destinations[0]).toEqual({
      seq: 1,
      region: '제주시',
      nights: 2,
      regionCode: '50110',
    });
  });

  it('본문 문구가 일정이 있는지(itineraryDayCount)로 갈린다 — 없는 일정이 사라진다고 말하지 않는다', async () => {
    serverTrip = baseTrip({ ...CONFIRMED_COLS });
    await openPage();
    changeLengthAndApply('2099-06-20');
    expect(screen.getByTestId('trip-settings-length-body')).toHaveTextContent(
      '지금 일정은 사라지고 이 여행에서 새로 짜요.'
    );
    expect(
      screen.getByTestId('trip-settings-length-confirm')
    ).toHaveTextContent('다시 만들기');
    expect(screen.getByTestId('trip-settings-length-cancel')).toHaveTextContent(
      '취소'
    );
    screen.unmount();

    serverTrip = baseTrip(); // itineraryDayCount 0
    await openPage();
    changeLengthAndApply('2099-06-20');
    expect(screen.getByTestId('trip-settings-length-body')).toHaveTextContent(
      '이 여행에서 일정을 새로 짜요.'
    );
    expect(screen.getByTestId('trip-settings-length-title')).toHaveTextContent(
      '일수가 바뀌면 일정을 다시 짜야 해요'
    );
  });

  it('응답을 기다리는 동안 확정을 연타해도 PATCH 는 1번이고, 이동도 1번이다', async () => {
    let release: () => void = () => {};
    patchGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await openPage();
    changeLengthAndApply('2099-06-20');

    const button = screen.getByTestId('trip-settings-length-confirm');
    resetPressGuard();
    fireEvent.press(button);
    fireEvent.press(button);
    fireEvent.press(button);
    await settle();
    expect(patchHits()).toBe(1);

    release();
    await waitFor(() => expect(routerSpies.replace).toHaveBeenCalledTimes(1));
    expect(patchHits()).toBe(1);
  });

  it.each([
    ['서버 5xx', ERROR_500],
    ['네트워크 오류', NETWORK_ERROR],
  ])(
    '%s → 창이 안 닫히고 안에 오류가 뜨며 이동·토스트가 없다. 다시 확정하면 성공한다',
    async (_label, failure) => {
      patchQueue = [failure];
      await openPage();
      changeLengthAndApply('2099-06-20');
      expect(screen.queryByTestId('trip-settings-length-error')).toBeNull(); // 앵커

      confirmLength();

      expect(
        await screen.findByTestId('trip-settings-length-error')
      ).toHaveTextContent('다시 만들지 못했어요. 다시 시도해 주세요.');
      expect(lengthDialog()).toBeOnTheScreen();
      expect(routerSpies.replace).not.toHaveBeenCalled();
      expect(screen.queryByTestId('trip-settings-saved-toast')).toBeNull();
      expect(patchHits()).toBe(1);

      confirmLength();

      await waitFor(() => expect(routerSpies.replace).toHaveBeenCalledTimes(1));
      expect(patchHits()).toBe(2);
      expect(patchBodies[1].discardItinerary).toBe(true);
      expect(patchBodies[1].endDate).toBe('2099-06-20');
    }
  );

  it('이동하는 순간 연타 창이 열려 있다 — 확정 누름이 연 창이 닫힌 뒤에도 (이동 직전 openPressGuardWindow)', async () => {
    let openAtReplace: boolean | null = null;
    routerSpies.replace.mockImplementationOnce(() => {
      openAtReplace = pressWindowOpen();
    });
    let release: () => void = () => {};
    patchGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await openPage();
    changeLengthAndApply('2099-06-20');
    confirmLength();
    await waitFor(() => expect(patchHits()).toBe(1));

    // 앵커 — 시계를 돌리면 어떤 누름이 연 창도 닫혀 있다(이 탐침이 창을 열므로 바로 닫는다).
    advanceClock(1000);
    expect(pressWindowOpen()).toBe(false);
    resetPressGuard();
    release();

    await waitFor(() => expect(routerSpies.replace).toHaveBeenCalledTimes(1));
    expect(openAtReplace).toBe(true);
  });

  // 5-b 경고-1: 같은 뮤테이션을 겹쳐 부르면 앞 호출의 개별 콜백이 버려져 잠금이 영영 안 풀렸다.
  it('저장 응답을 기다리는 동안 확정을 눌러도 둘째 PATCH 가 안 나가고, 저장이 실패하면 다시 저장할 수 있다', async () => {
    let release: () => void = () => {};
    patchGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    patchQueue = [ERROR_500];
    await openPage();
    typeTitle('겹쳐 저장');
    press('trip-settings-save');
    await waitFor(() => expect(patchHits()).toBe(1));

    changeLengthAndApply('2099-06-20');
    confirmLength();

    release();
    expect(await screen.findByTestId('trip-settings-error')).toBeOnTheScreen();
    expect(patchHits()).toBe(1);
    expect(routerSpies.replace).not.toHaveBeenCalled();

    press('trip-settings-length-cancel');
    press('trip-settings-save');

    await waitFor(() => expect(routerSpies.back).toHaveBeenCalledTimes(1));
    expect(patchHits()).toBe(2);
    expect(patchBodies[1].title).toBe('겹쳐 저장');
  });

  // 5-b 참고-2: 창을 안 닫으면 전체 잠금 화면 위에 창이 남아 같은 409 를 반복해서 맞는다.
  it('확정이 일반 409(끝난 여행)로 끝나면 창이 닫히고 화면 전체가 잠기며 이동하지 않는다', async () => {
    patchQueue = [CONFLICT_409];
    await openPage();
    changeLengthAndApply('2099-06-20');

    confirmLength();

    expect(await screen.findByTestId('trip-settings-locked')).toBeOnTheScreen();
    expect(lengthDialog()).toBeNull();
    expect(routerSpies.replace).not.toHaveBeenCalled();
  });
});

describe('N · 저장 409 가르기 (AC-5)', () => {
  beforeEach(freezeToday);

  it.each<[string, string, string, boolean]>([
    [
      'TRIP_PERIOD_STARTED',
      '여행이 시작돼 기간을 바꾸지 못했어요',
      HINT_STARTED,
      false,
    ],
    [
      'TRIP_PERIOD_GENERATING',
      '일정을 만드는 중이라 기간을 바꾸지 못했어요',
      HINT_GENERATING,
      false,
    ],
    [
      'TRIP_PERIOD_LENGTH_CHANGED',
      '일수가 달라져 기간을 바꾸지 못했어요',
      HINT_OPEN,
      true,
    ],
  ])(
    '%s → 화면은 안 잠기고 기간 편집만 버려 서버 원값으로 돌아가며 안내가 뜬다. 이름 편집은 남아 다시 저장하면 서버 원값 기간으로 성공한다',
    async (code, notice, expectedHint, rowStaysOpen) => {
      patchQueue = [error409(code)];
      await openPage();
      typeTitle('이름은 지킨다');
      openPeriodSheet();
      pickDate('2099-06-20');
      applyPeriod();
      expect(screen.queryByTestId('trip-settings-period-notice')).toBeNull(); // 앵커

      press('trip-settings-save');

      expect(
        await screen.findByTestId('trip-settings-period-notice')
      ).toHaveTextContent(notice);
      expect(screen.queryByTestId('trip-settings-locked')).toBeNull();
      expect(periodText()).toHaveTextContent(/6월 10일.*13일/);
      expect(screen.getByTestId('trip-settings-title')).toHaveDisplayValue(
        '이름은 지킨다'
      );
      expect(hint()).toHaveTextContent(expectedHint);
      if (rowStaysOpen) expect(periodChevron()).toBeOnTheScreen();
      else expect(periodChevron()).toBeNull();
      expect(patchHits()).toBe(1);
      expect(screen.queryByTestId('trip-settings-error')).toBeNull();

      expect(save()).toBeEnabled();
      press('trip-settings-save');

      await waitFor(() => expect(routerSpies.back).toHaveBeenCalledTimes(1));
      expect(patchHits()).toBe(2);
      expect(patchBodies[1].title).toBe('이름은 지킨다');
      expect(patchBodies[1].startDate).toBe('2099-06-10');
      expect(patchBodies[1].endDate).toBe('2099-06-13');
      expect('discardItinerary' in patchBodies[1]).toBe(false);
    }
  );

  it.each<[string, () => Response]>([
    ['CONFLICT 코드(종료·삭제)', error409('CONFLICT')],
    ['본문 없는 409', () => new HttpResponse(null, { status: 409 })],
  ])(
    '%s → 종전처럼 화면 전체 잠금(끝난 여행 얼굴)이다',
    async (_label, failure) => {
      patchQueue = [failure];
      await openPage();
      typeTitle('늦은 저장');

      press('trip-settings-save');

      expect(
        await screen.findByTestId('trip-settings-locked')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('trip-settings-period-notice')).toBeNull();
      await expectSaveBlocked();
    }
  );

  it('확인창에서 확정했는데 시작됐다는 409 가 오면 창이 닫히고 이동 없이 기간 편집이 버려진다', async () => {
    patchQueue = [error409('TRIP_PERIOD_STARTED')];
    await openPage();
    changeLengthAndApply('2099-06-20');

    confirmLength();

    await waitFor(() => expect(lengthDialog()).toBeNull());
    expect(routerSpies.replace).not.toHaveBeenCalled();
    expect(screen.getByTestId('trip-settings-period-notice')).toHaveTextContent(
      '여행이 시작돼 기간을 바꾸지 못했어요'
    );
    expect(periodText()).toHaveTextContent(/6월 10일.*13일/);
    expect(periodChevron()).toBeNull();
  });
});

describe('O · 커버 고르기 (AC-6 · AC-8 · AC-9 · 소비처 ⑥)', () => {
  beforeEach(freezeToday);

  it('「커버 바꾸기」 → 시트: 첫 칸(첫 여행지 그림)부터 일부만 마운트하고(가상화), 격자가 받은 목록은 첫 칸 + coverChoices() 전부이며 이름표 그대로다', async () => {
    await openPage();
    expect(screen.queryByTestId('trip-settings-cover-sheet')).toBeNull();

    openCoverSheet();

    expect(screen.getByTestId('trip-settings-cover-sheet')).toBeOnTheScreen();
    expect(coverOption('auto').props.accessibilityLabel).toBe('첫 여행지 그림');
    const firstMounted = mountedCoverOptions().length;
    expect(firstMounted).toBeGreaterThan(1);
    expect(firstMounted).toBeLessThan(coverChoices().length / 2);
    // 화면 밖 칸은 마운트돼 있지 않아 글자로 못 본다 — jest 엔 칸 레이아웃이 없어 스크롤로 전수를 돌 수도 없다(y 를 늘려도 34칸에서 멈춘다).
    // 그래서 격자가 받은 목록을 본다. 목록은 칸을 그리는 입력이고, 그리는 쪽은 첫 칸·끝 칸 단언과 실기 108칸이 맡는다.
    const cells = screen.getByTestId('trip-settings-cover-sheet').props
      .data as { id: string; label: string }[];
    expect(cells.map((cell) => [cell.id, cell.label])).toEqual([
      ['auto', '첫 여행지 그림'],
      ...coverChoices().map((one) => [one.key, one.label]),
    ]);
  });

  it.each<[string, Partial<Trip>, string]>([
    ['null(자동)', { coverKey: null }, 'auto'],
    ['알려진 키', { coverKey: '26' }, '26'],
    [
      '앱이 모르는 키 — 어느 그림도 선택 표시 없이 첫 칸이 선택',
      { coverKey: 'zz9' },
      'auto',
    ],
  ])(
    '시트의 선택 표시: 서버 coverKey 가 %s',
    async (_label, over, selectedKey) => {
      serverTrip = baseTrip(over);
      await openPage();

      openCoverSheet();

      for (const option of mountedCoverOptions()) {
        if (option.props.testID === `trip-settings-cover-option-${selectedKey}`)
          expect(option).toBeSelected();
        else expect(option).not.toBeSelected();
      }
      expect(coverOption(selectedKey)).toBeSelected();
    }
  );

  it('끝까지 스크롤하면 마지막 칸이 나오고 고를 수 있다 — 화면 밖에 있던 서버 값도 선택 표시로 나온다', async () => {
    const lastKey = coverChoices().at(-1)!.key;
    serverTrip = baseTrip({ coverKey: lastKey });
    await openPage();
    openCoverSheet();
    expect(
      screen.queryByTestId(`trip-settings-cover-option-${lastKey}`)
    ).toBeNull();

    scrollCoverGridToEnd();

    await waitFor(() => expect(coverOption(lastKey)).toBeSelected());
    expect(coverOption(lastKey).props.accessibilityLabel).toBe(
      coverChoices().at(-1)!.label
    );
    expect(save()).toBeDisabled();

    const otherKey = coverChoices().at(-2)!.key;
    press(`trip-settings-cover-option-${otherKey}`);
    expect(coverOption(otherKey)).toBeSelected();
    expect(coverOption(lastKey)).not.toBeSelected();
    press('trip-settings-cover-apply');
    expect(coverImage()).toEqual([coverSourceForKey(otherKey)]);
  });

  it('다른 그림을 골라도 적용 전엔 화면 커버·저장이 그대로이고, [적용] 하면 화면 커버가 바뀌고 저장이 켜진다 → 저장하면 coverKey 만 바뀐 본문', async () => {
    serverTrip = baseTrip({ coverKey: '26350' });
    await openPage();
    expect(coverImage()).toEqual([coverSourceForKey('26350')]);
    expect(coverSourceForKey('11110')).not.toBe(coverSourceForKey('26350'));
    openCoverSheet();

    press('trip-settings-cover-option-11110');
    expect(coverImage()).toEqual([coverSourceForKey('26350')]);
    expect(save()).toBeDisabled();
    press('trip-settings-cover-apply');

    expect(screen.queryByTestId('trip-settings-cover-sheet')).toBeNull();
    expect(coverImage()).toEqual([coverSourceForKey('11110')]);
    expect(save()).toBeEnabled();
    expect(patchHits()).toBe(0);

    press('trip-settings-save');

    await waitFor(() => expect(routerSpies.back).toHaveBeenCalledTimes(1));
    expect(patchHits()).toBe(1);
    expect(patchBodies[0].coverKey).toBe('11110');
    expect(patchBodies[0].startDate).toBe('2099-06-10');
    expect(patchBodies[0].endDate).toBe('2099-06-13');
    expect('discardItinerary' in patchBodies[0]).toBe(false);
  });

  it('첫 칸(자동)을 고르고 적용하면 PATCH 본문에 coverKey: null 이 실린다(키가 있고 값이 null)', async () => {
    serverTrip = baseTrip({ coverKey: '26350' });
    await openPage();
    openCoverSheet();
    press('trip-settings-cover-option-auto');
    press('trip-settings-cover-apply');
    expect(save()).toBeEnabled();

    press('trip-settings-save');

    await waitFor(() => expect(routerSpies.back).toHaveBeenCalledTimes(1));
    expect('coverKey' in patchBodies[0]).toBe(true);
    expect(patchBodies[0].coverKey).toBeNull();
    // 응답으로 갱신된 단건 캐시에도 null(고른 그림이 지워졌다)
    expect(
      client.getQueryData<Trip>(getGetTripsTripIdQueryKey(TRIP_ID))?.coverKey
    ).toBeNull();
  });

  it('닫으면(적용 전) 무변화이고, 지금과 같은 그림을 적용하는 건 바뀐 게 아니다', async () => {
    serverTrip = baseTrip({ coverKey: '26' });
    await openPage();
    openCoverSheet();
    press('trip-settings-cover-option-11110');

    press('trip-settings-cover-close');

    expect(screen.queryByTestId('trip-settings-cover-sheet')).toBeNull();
    expect(coverImage()).toEqual([coverSourceForKey('26')]);
    expect(save()).toBeDisabled();

    openCoverSheet();
    expect(coverOption('26')).toBeSelected(); // 닫은 선택은 버려져 서버 값에서 다시 시작
    press('trip-settings-cover-option-26');
    press('trip-settings-cover-apply');
    expect(save()).toBeDisabled();
  });

  // 5-b 참고-1: `picked === undefined` 가드가 없으면 앞서 적용한 선택이 사라져 서버 값으로 되돌아간다.
  it('다른 그림을 적용해 둔 뒤 시트를 다시 열어 아무것도 안 누르고 적용해도 앞의 선택이 남는다', async () => {
    serverTrip = baseTrip({ coverKey: '26350' });
    await openPage();
    openCoverSheet();
    press('trip-settings-cover-option-11110');
    press('trip-settings-cover-apply');
    expect(coverImage()).toEqual([coverSourceForKey('11110')]);

    openCoverSheet();
    press('trip-settings-cover-apply');

    expect(coverImage()).toEqual([coverSourceForKey('11110')]);
    expect(save()).toBeEnabled();
  });

  it('앱이 모르는 서버 키는 시트를 열고 그냥 적용해도 안 지워지고, 이름만 고쳐 저장하면 원문 그대로 실린다', async () => {
    serverTrip = baseTrip({ coverKey: 'zz9' });
    await openPage();
    openCoverSheet();

    press('trip-settings-cover-apply');
    expect(save()).toBeDisabled();
    typeTitle('모르는 키 보존');
    press('trip-settings-save');

    await waitFor(() => expect(routerSpies.back).toHaveBeenCalledTimes(1));
    expect(patchBodies[0].coverKey).toBe('zz9');
  });

  it('앱이 모르는 서버 키에서 첫 칸(자동)을 직접 눌러 적용하면 그건 사용자의 선택이라 coverKey: null 이 실린다', async () => {
    serverTrip = baseTrip({ coverKey: 'zz9' });
    await openPage();
    openCoverSheet();

    press('trip-settings-cover-option-auto');
    press('trip-settings-cover-apply');
    expect(save()).toBeEnabled();
    press('trip-settings-save');

    await waitFor(() => expect(routerSpies.back).toHaveBeenCalledTimes(1));
    expect(patchBodies[0].coverKey).toBeNull();
  });

  it('이름만 고쳐 저장해도 현재 coverKey 가 본문에 그대로 실린다(PATCH 는 통째 교체라 안 실으면 지워진다)', async () => {
    serverTrip = baseTrip({ coverKey: '26350' });
    await openPage();
    typeTitle('커버는 지킨다');

    press('trip-settings-save');

    await waitFor(() => expect(routerSpies.back).toHaveBeenCalledTimes(1));
    expect(patchBodies[0].coverKey).toBe('26350');
    expect(patchBodies[0].title).toBe('커버는 지킨다');
  });

  it('옛 서버(응답에 coverKey 칸이 없음)면 본문에도 키가 생기지 않고, 커버는 첫 목적지 자동 그림이다', async () => {
    expect('coverKey' in serverTrip).toBe(false);
    await openPage();

    expect(coverImage()).toEqual([tripCoverSource(serverTrip)]);
    expect(tripCoverSource(serverTrip)).not.toBeNull();
    typeTitle('옛 서버');
    press('trip-settings-save');

    await waitFor(() => expect(routerSpies.back).toHaveBeenCalledTimes(1));
    expect('coverKey' in patchBodies[0]).toBe(false);
  });

  it('소비처 ⑥ — 고른 키가 첫 목적지(제주)와 다르면 설정 화면 커버는 고른 그림, null 이면 첫 목적지 그림이다', async () => {
    serverTrip = baseTrip({ coverKey: '11110' });
    await openPage();

    expect(coverImage()).toEqual([coverSourceForKey('11110')]);
    expect(coverImage()).not.toEqual([
      tripCoverSource({ destinations: serverTrip.destinations }),
    ]);
    screen.unmount();

    serverTrip = baseTrip({ coverKey: null });
    await openPage();
    expect(coverImage()).toEqual([
      tripCoverSource({ destinations: serverTrip.destinations }),
    ]);
  });
});

describe('P · 캐시 (AC-1 · D11) — 그 여행 하위 조회만, 훅 옵션이라 화면을 떠나도', () => {
  beforeEach(freezeToday);

  const CHILD_KEYS = [
    `/trips/${TRIP_ID}/itinerary`,
    `/trips/${TRIP_ID}/bases`,
    `/trips/${TRIP_ID}/must-visits`,
  ];
  /** 다른 여행·접두만 같은 다른 id — 건드리면 안 된다. */
  const OTHER_KEYS = [
    '/trips/other-trip/itinerary',
    `/trips/${TRIP_ID}x/itinerary`,
  ];

  function seedCaches(): void {
    for (const key of [...CHILD_KEYS, ...OTHER_KEYS]) {
      client.setQueryData([key], { marker: key });
    }
  }
  const invalidated = (key: string) =>
    client.getQueryState([key])?.isInvalidated === true;

  it('날짜 이동 저장은 응답 전에 화면을 떠나도 그 여행의 자식 조회를 낡음 처리한다 — 단건·다른 여행·접두만 같은 id 는 아니다', async () => {
    let release: () => void = () => {};
    patchGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await openPage();
    seedCaches();
    for (const key of [...CHILD_KEYS, ...OTHER_KEYS]) {
      expect(invalidated(key)).toBe(false); // 앵커
    }
    openPeriodSheet();
    pickDate('2099-06-20');
    applyPeriod();
    press('trip-settings-save');
    await waitFor(() => expect(patchHits()).toBe(1));

    screen.unmount();
    release();

    await waitFor(() => expect(invalidated(CHILD_KEYS[0])).toBe(true));
    for (const key of CHILD_KEYS) expect(invalidated(key)).toBe(true);
    for (const key of OTHER_KEYS) expect(invalidated(key)).toBe(false);
    const detail = client.getQueryState(getGetTripsTripIdQueryKey(TRIP_ID));
    expect(detail?.isInvalidated).toBe(false);
    expect(
      client.getQueryData<Trip>(getGetTripsTripIdQueryKey(TRIP_ID))?.startDate
    ).toBe('2099-06-20');
  });

  it('기간을 안 바꾼 저장(이름만)은 자식 조회를 건드리지 않는다', async () => {
    await openPage();
    seedCaches();
    typeTitle('이름만');

    press('trip-settings-save');

    await waitFor(() => expect(routerSpies.back).toHaveBeenCalledTimes(1));
    for (const key of [...CHILD_KEYS, ...OTHER_KEYS]) {
      expect(invalidated(key)).toBe(false);
      expect(client.getQueryData([key])).toEqual({ marker: key });
    }
  });

  it('일정을 버리는 확정이 성공하면(화면을 떠난 뒤에도) 자식 조회의 데이터가 비워지고, 단건은 새 기간·다른 여행은 그대로다', async () => {
    let release: () => void = () => {};
    patchGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await openPage();
    seedCaches();
    changeLengthAndApply('2099-06-11');
    confirmLength();
    await waitFor(() => expect(patchHits()).toBe(1));
    for (const key of CHILD_KEYS) {
      expect(client.getQueryData([key])).toEqual({ marker: key }); // 앵커 — 응답 전엔 옛 데이터
    }

    screen.unmount();
    release();

    await waitFor(() =>
      expect(client.getQueryData([CHILD_KEYS[0]])).toBeUndefined()
    );
    for (const key of CHILD_KEYS) {
      expect(client.getQueryData([key])).toBeUndefined();
    }
    for (const key of OTHER_KEYS) {
      expect(client.getQueryData([key])).toEqual({ marker: key });
    }
    expect(
      client.getQueryData<Trip>(getGetTripsTripIdQueryKey(TRIP_ID))?.endDate
    ).toBe('2099-06-11');
  });

  it('확정이 실패하면 자식 조회의 데이터가 그대로다', async () => {
    patchQueue = [ERROR_500];
    await openPage();
    seedCaches();
    changeLengthAndApply('2099-06-11');

    confirmLength();

    await screen.findByTestId('trip-settings-length-error');
    for (const key of CHILD_KEYS) {
      expect(client.getQueryData([key])).toEqual({ marker: key });
      expect(invalidated(key)).toBe(false);
    }
  });
});

describe('Q · 연타 (AC-11)', () => {
  beforeEach(freezeToday);

  it('기간 [적용] 직후 같은 틱의 저장 누름은 PATCH 를 안 내고, 창이 닫힌 뒤의 저장은 나간다', async () => {
    await openPage();
    typeTitle('연타 방지');
    openPeriodSheet();
    pickDate('2099-06-20');
    expect(save()).toBeEnabled();

    resetPressGuard();
    fireEvent.press(screen.getByTestId('trip-wizard-period-apply'));
    fireEvent.press(save());
    await settle();

    expect(periodSheet()).toBeNull(); // 적용은 됐다
    expect(patchHits()).toBe(0);

    advanceClock(500);
    fireEvent.press(save());

    await waitFor(() => expect(patchHits()).toBe(1));
    expect(patchBodies[0].startDate).toBe('2099-06-20');
  });

  it('커버 [적용] 직후 같은 틱의 저장 누름도 PATCH 를 안 낸다', async () => {
    await openPage();
    typeTitle('커버 연타');
    openCoverSheet();
    press('trip-settings-cover-option-11110');
    expect(save()).toBeEnabled();

    resetPressGuard();
    fireEvent.press(screen.getByTestId('trip-settings-cover-apply'));
    fireEvent.press(save());
    await settle();

    expect(screen.queryByTestId('trip-settings-cover-sheet')).toBeNull();
    expect(patchHits()).toBe(0);
  });

  it('저장이 실패하면 바로 다시 눌러 재시도할 수 있다 — 저장 자신은 창을 열지 않는다', async () => {
    patchQueue = [ERROR_500];
    await openPage();
    typeTitle('재시도');
    press('trip-settings-save');
    await screen.findByTestId('trip-settings-error');

    fireEvent.press(screen.getByTestId('trip-settings-retry'));

    await waitFor(() => expect(patchHits()).toBe(2));
    await waitFor(() => expect(routerSpies.back).toHaveBeenCalledTimes(1));
  });

  it.each(['trip-settings-period', 'trip-settings-cover-change'])(
    '%s 를 누르면 연타 창이 열린다(guardPress)',
    async (testID) => {
      await openPage();

      press(testID);

      expect(pressWindowOpen()).toBe(true);
    }
  );
});

/**
 * 통합 QA(2026-11-06) D1·D2·D4·D5·D6·O1 — 첫 탭으로 시트·창이 닫히거나 화면이 바뀐 직후, 둘째 탭이 그 자리의 다른 요소를 누른다.
 * `tap` 은 `press` 와 달리 **창을 닫지 않고** 누른다 — 연타의 둘째 탭을 흉내 낸다. 실제 손가락·딤 관통은 실화면 몫이고, 여기서는
 * "표적 핸들러가 창을 따르는가 · 앞 탭이 창을 여는가"만 본다.
 */
describe('R · 통합 QA 연타·0박 여행지', () => {
  beforeEach(freezeToday);

  const tap = (testID: string) => fireEvent.press(screen.getByTestId(testID));

  it('D1 동행 시트 [적용] 연타 — 둘째 탭이 저장을 누르지 않는다. 창이 닫힌 뒤 저장은 된다', async () => {
    await openPage();
    press('trip-settings-companion');
    press('trip-wizard-companion-chip-partner');

    tap('trip-wizard-companion-apply');
    expect(screen.queryByTestId('trip-wizard-companion-sheet')).toBeNull(); // 앞 탭은 먹었다(앵커)
    expect(save()).toBeEnabled();
    tap('trip-settings-save');
    await settle();

    expect(patchHits()).toBe(0);
    expect(routerSpies.back).not.toHaveBeenCalled();

    press('trip-settings-save');
    await waitFor(() => expect(patchHits()).toBe(1));
  });

  it('D2 일과 시트 [적용] 연타 — 둘째 탭이 저장을 누르지 않는다', async () => {
    await openPage();
    press('trip-settings-day-start');
    press('trip-wizard-daywindow-wheel-h-11');
    press('trip-wizard-daywindow-wheel-m-00');

    tap('trip-wizard-daywindow-apply');
    expect(screen.queryByTestId('trip-wizard-daywindow-sheet')).toBeNull();
    expect(save()).toBeEnabled();
    tap('trip-settings-save');
    await settle();

    expect(patchHits()).toBe(0);
    expect(routerSpies.back).not.toHaveBeenCalled();
  });

  it('D4 일수 확인창 [취소] 연타 — 둘째 탭이 뒤 기간 행을 다시 열지 않는다', async () => {
    await openPage();
    changeLengthAndApply('2099-06-20');
    expect(lengthDialog()).toBeOnTheScreen();
    resetPressGuard(); // 앞 [적용]이 연 창을 닫는다 — 창은 [취소]가 열어야 한다

    tap('trip-settings-length-cancel');
    expect(lengthDialog()).toBeNull();
    tap('trip-settings-period');

    expect(periodSheet()).toBeNull();
    expect(patchHits()).toBe(0);
  });

  it('삭제 확인창 [취소] 연타도 같다 — 둘째 탭이 뒤 행을 열지 않는다', async () => {
    await openPage();
    press('trip-settings-delete');
    resetPressGuard(); // 「여행 삭제」가 연 창을 닫는다(시계가 고정이라 저절로 안 닫힌다) — 창은 [취소]가 열어야 한다

    tap('my-trip-delete-cancel');
    expect(screen.queryByTestId('my-trip-delete-dialog')).toBeNull();
    tap('trip-settings-period');

    expect(periodSheet()).toBeNull();
  });

  it.each<[string, string, string]>([
    ['여행 삭제', 'trip-settings-delete', 'my-trip-delete-dialog'],
    ['동행 행', 'trip-settings-companion', 'trip-wizard-companion-sheet'],
    ['일과 행', 'trip-settings-day-start', 'trip-wizard-daywindow-sheet'],
  ])(
    'O1 앞 화면에서 넘어온 연타 창 안이면 %s 은(는) 무시된다 — 창이 닫히면 열린다',
    async (_label, target, opened) => {
      await openPage();

      openPressGuardWindow(); // 목록 ⋯ 「여행 설정」이 연 창
      tap(target);
      expect(screen.queryByTestId(opened)).toBeNull();

      press(target);
      expect(screen.getByTestId(opened)).toBeOnTheScreen();
    }
  );

  describe('D5 — 일수를 줄여 0박이 된 여행지는 뺀다', () => {
    const threeCities = () =>
      baseTrip({
        startDate: '2099-06-10',
        endDate: '2099-06-13',
        destinations: [
          { seq: 1, region: '제주', nights: 1, regionCode: '50' },
          { seq: 2, region: '부산', nights: 1, regionCode: '26' },
          { seq: 3, region: '서울', nights: 1, regionCode: '11' },
        ],
      });
    const dropped = () => screen.queryByTestId('trip-settings-length-dropped');

    it('확인창이 빠지는 도시를 한 줄로 말하고, 확정 전엔 아무것도 안 나간다. 확정 본문엔 남는 도시만 실린다', async () => {
      serverTrip = threeCities();
      await openPage();

      changeLengthAndApply('2099-06-11'); // 3박 → 1박

      expect(dropped()).toHaveTextContent('부산·서울이 여행지에서 빠져요');
      expect(patchHits()).toBe(0);

      confirmLength();
      await waitFor(() => expect(routerSpies.replace).toHaveBeenCalledTimes(1));
      expect(patchBodies[0].discardItinerary).toBe(true);
      expect(patchBodies[0].destinations).toEqual([
        { seq: 1, region: '제주', nights: 1, regionCode: '50' },
      ]);
    });

    it('한 곳만 빠지면 그 곳만 말한다(2박으로 줄이면 서울)', async () => {
      serverTrip = threeCities();
      await openPage();

      changeLengthAndApply('2099-06-12');

      expect(dropped()).toHaveTextContent('서울이 여행지에서 빠져요');
    });

    it('당일치기까지 줄여도 첫 도시는 남는다 — 박수 0 으로 실린다', async () => {
      serverTrip = threeCities();
      await openPage();

      changeLengthAndApply('2099-06-10');
      expect(dropped()).toHaveTextContent('부산·서울이 여행지에서 빠져요');

      confirmLength();
      await waitFor(() => expect(routerSpies.replace).toHaveBeenCalledTimes(1));
      expect(patchBodies[0].destinations).toEqual([
        { seq: 1, region: '제주', nights: 0, regionCode: '50' },
      ]);
    });

    it('늘릴 때는 그 줄이 없다', async () => {
      await openPage();

      changeLengthAndApply('2099-06-20'); // 3박 → 10박

      expect(lengthDialog()).toBeOnTheScreen();
      expect(dropped()).toBeNull();
    });

    it('한 도시 여행을 줄이면 빠지는 도시가 없다', async () => {
      serverTrip = baseTrip({
        destinations: [{ seq: 1, region: '제주', nights: 3, regionCode: '50' }],
      });
      await openPage();

      changeLengthAndApply('2099-06-11');

      expect(lengthDialog()).toBeOnTheScreen();
      expect(dropped()).toBeNull();
    });
  });
});
