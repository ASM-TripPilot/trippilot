import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { PreferenceView, Trip } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-669 (S5) g01 취향 편집 시트 — **배선 승인 테스트**(요약 "취향" 행 → 시트 오픈 → 드래프트 전이
 * → 적용 → 스토어 → 제출 스냅숏). 자매 시트 통합(companion/period/destinationSheet)과 동형.
 *
 * 무엇을 보장하나:
 *  - PI-1 요약 취향 행 탭 → 시트 마운트(현 `openEditSheet` no-op 스텁 대체).
 *  - PI-2 초기 선택 = 온보딩 프리필(드래프트를 effective 에서 초기화, AC-2).
 *  - PI-3 칩 탭 → 배선이 드래프트를 전이시켜 재렌더(무상태 시트라 이 전이는 여기서만 관측, AC-1).
 *  - PI-4 적용 → `setPrefStyleOverride(draft)` 커밋 + 닫힘(AC-3).
 *  - PI-5 ★ 제출 `preferenceSnapshot.styles` = effective(오버라이드), `activities` = 활동 오버라이드가
 *        없으면(undefined) 프리필 원본(TRIP-1092 01b Q1), 계정 취향(`PUT /me/preferences`) 불변(BR-U1-38).
 *  - PI-6 ★ null-vs-empty: 전해제 → 적용 → store `[]` → 제출 styles `[]`(프리필로 안 돌아감, 맹점②).
 *  - PI-7 ★ hasOverride → 요약 "+ 온보딩" 제거(D4).
 *  - PA-1~9 (TRIP-1092) 활동 칩 — 행의 모든 값이 시트 칩으로 대응(A13)·활동 축 해제/적용/제출·
 *        같은 라벨(자연·쇼핑) 1회 표기와 축 분리. TRIP-669 D5("activities 는 시트가 안 건드림")는 뒤집혔다.
 *
 * 왜 통합 버킷인가: 시트는 props-only 무상태라 "탭→선택 변화"는 배선이 드래프트를 소유·갱신할 때만
 * 일어난다 — 스토어 실반영·제출 바디를 함께 관측해야 한다(msw). 컴포넌트 단위(선택 표식·콜백)는
 * `PrefOverrideSheet.test.tsx`가, 스토어 필드는 `tripWizardStore.prefOverride.test.ts`가 잠근다.
 *
 * ⚠️ 게스트(토큰 없음)로 돈다 — 담은목록 조회가 `enabled:isAuthed` 라 안 나가고 `savedPlacesLoading`
 * 이 false 라 게이트를 안 막는다(비회원 예외, 기존 integration 선례). 그래서 /saved-places 핸들러가
 * 필요 없다. `/regions`·`/saved-stays` 핸들러도 안 준다 — 신 배선이 그 훅을 드롭했음을 강제한다
 * (남기면 onUnhandledRequest:'error' 로 크래시 red).
 *
 * ⚠️ 매처 함정(02a §5-4·§5-5): preferenceSnapshot 배열은 `toEqual`(정확 배열), 요약 부분 텍스트는
 * 정규식(`toHaveTextContent('문자열')`은 완전 일치라 부분 매칭엔 정규식/`within`).
 *
 * ⚠️ 바텀시트 통과형 목: 관측하는 "시트 오픈"은 **조건부 마운트 트리 존재/부재**뿐이다. 실제
 * 슬라이드업·딤·터치 차단은 jest 사각(6-b 실기, 자율 세션 SKIP).
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
}));

const BASE = 'http://localhost:8080/api/v1';
const BASE_DATE = '2026-06-10';

/** 프리필 — styles 2종은 전부 7칩 안의 값(미식·자연), activities 는 야경(TRIP-1092 전엔 시트 밖 값).
 *  budget rawAmount 800000 → 요약 예산 "80만원"이 프리필 도착의 눈금(override 무관, 항상 뜬다). */
const PREFERENCE: PreferenceView = {
  pace: { value: '균형있게', isNeutralDefault: false },
  budget: { tier: '중간', rawAmount: 800000, isNeutralDefault: false },
  styles: { value: ['미식', '자연'] },
  activities: { value: ['야경'] },
};

/** openapi `Trip.required` 10필드. */
const TRIP: Trip = {
  tripId: '11111111-1111-1111-1111-111111111111',
  title: '부산 여행',
  startDate: '2026-06-10',
  endDate: '2026-06-13',
  party: 1,
  companionType: null,
  budgetTotal: 800000,
  preferenceSnapshot: {},
  destinations: [{ seq: 1, region: '부산', nights: 3 }],
  status: 'PLANNED',
  createdAt: '2026-08-02T00:00:00Z',
  updatedAt: '2026-08-02T00:00:00Z',
  baseCount: 0,
  itineraryDayCount: 0,
};

let observedHits: string[] = [];
let postedBodies: Record<string, unknown>[] = [];

function createHits(): number {
  return observedHits.filter((hit) => hit === 'POST /api/v1/trips').length;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  postedBodies = [];
  mockPush.mockClear();
  mockBack.mockClear();
  useTripWizardStore.getState().reset();

  server.use(
    http.get(`${BASE}/me/preferences`, () => HttpResponse.json(PREFERENCE)),
    http.post(`${BASE}/trips`, async ({ request }) => {
      postedBodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(TRIP, { status: 201 });
    })
  );
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return Wrapper;
}

function renderPage() {
  return render(<TripNewStep1Page baseDate={BASE_DATE} />, {
    wrapper: createWrapper(),
  });
}

function next() {
  return screen.getByTestId('trip-wizard-step1-next');
}

function summaryPreferenceRow() {
  return screen.getByTestId('trip-wizard-summary-preference');
}

function chip(slug: string) {
  return screen.getByTestId(`trip-wizard-pref-chip-${slug}`);
}

/** 정상 제출 가능한 스토어 선상태(부산 3박 + 3박 4일 = 박수 3 ≤ 기간 3). */
function seedValidDraft(): void {
  const store = useTripWizardStore.getState();
  store.addDestination('부산', 3);
  store.setPeriod('3n4d', '2026-06-10', '2026-06-13');
}

/** 프리필이 도착해 요약 예산 행(80만원)이 뜬 것을 기다린다 — override 유무와 무관한 프리필 눈금. */
async function waitForPrefill(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByTestId('trip-wizard-summary-budget')).toHaveTextContent(
      /80만원/
    )
  );
}

/** 취향 요약 행을 눌러 시트를 연다(공통). */
async function openSheet(): Promise<void> {
  fireEvent.press(summaryPreferenceRow());
  await screen.findByTestId('trip-wizard-pref-sheet');
}

describe('PI-1 · AC-5 취향 행 탭이 시트를 연다', () => {
  it('탭 전엔 시트가 없고, 탭하면 마운트된다', async () => {
    renderPage();
    await waitForPrefill();
    expect(screen.queryByTestId('trip-wizard-pref-sheet')).toBeNull();

    fireEvent.press(summaryPreferenceRow());

    expect(
      await screen.findByTestId('trip-wizard-pref-sheet')
    ).toBeOnTheScreen();
  });
});

describe('PI-2 · AC-2 초기 선택 = 온보딩 프리필', () => {
  it('시트를 열면 프리필 styles(미식·자연) 칩만 selected 로 시작한다', async () => {
    renderPage();
    await waitForPrefill();
    await openSheet();

    expect(chip('gourmet')).toBeSelected();
    expect(chip('nature')).toBeSelected();
    // 나머지는 프리필 밖 — selected 아님(드래프트를 effective 에서 초기화 안 하면 red).
    for (const slug of ['rest', 'art', 'activity', 'sightseeing', 'shopping']) {
      expect(chip(slug)).not.toBeSelected();
    }
  });
});

describe('PI-3 · AC-1 칩 탭 → 배선이 드래프트를 전이시킨다 (무상태 시트)', () => {
  it('미식 해제 → 미식만 꺼지고 자연은 남고, 문화예술 추가 → 켜진다', async () => {
    renderPage();
    await waitForPrefill();
    await openSheet();

    fireEvent.press(chip('gourmet'));
    await waitFor(() => expect(chip('gourmet')).not.toBeSelected());
    expect(chip('nature')).toBeSelected();

    fireEvent.press(chip('art'));
    await waitFor(() => expect(chip('art')).toBeSelected());
  });
});

describe('PI-4 · ★ AC-3 적용 → setPrefStyleOverride 커밋 + 닫힘', () => {
  it('오버라이드 드래프트를 만들고 적용하면 store 에 실리고 시트가 닫힌다', async () => {
    renderPage();
    await waitForPrefill();
    await openSheet();

    // 프리필(미식·자연)에서 둘 다 끄고 휴양을 켜 → 드래프트 ['휴양'].
    fireEvent.press(chip('gourmet'));
    fireEvent.press(chip('nature'));
    fireEvent.press(chip('rest'));
    await waitFor(() => expect(chip('rest')).toBeSelected());

    // 적용 전 — store 는 아직 오버라이드 없음(undefined).
    expect(useTripWizardStore.getState().prefStyleOverride).toBeUndefined();

    fireEvent.press(screen.getByTestId('trip-wizard-pref-sheet-apply'));

    await waitFor(() =>
      expect(useTripWizardStore.getState().prefStyleOverride).toEqual(['휴양'])
    );
    await waitFor(() =>
      expect(screen.queryByTestId('trip-wizard-pref-sheet')).toBeNull()
    );
  });
});

describe('PI-5 · ★ 제출축 — styles=effective, 활동 오버라이드 없으면 activities=프리필, 계정취향 불변', () => {
  it('스타일 오버라이드만 있으면 POST 스냅숏 styles 는 override, activities 는 프리필 원본이고 PUT 은 없다', async () => {
    seedValidDraft();
    // 시트 UI 대신 오버라이드를 직접 심어 제출축만 잰다(오픈→적용 배선은 PI-4 가 잠금).
    useTripWizardStore.getState().setPrefStyleOverride(['휴양']);

    renderPage();
    await waitForPrefill();
    expect(next()).toBeEnabled();

    fireEvent.press(next());

    await waitFor(() => expect(createHits()).toBe(1));
    const snapshot = postedBodies[0].preferenceSnapshot as {
      styles: unknown;
      activities: unknown;
    };
    // styles = effective(오버라이드) — 프리필 ['미식','자연'] 이 아니라 ['휴양'].
    expect(snapshot.styles).toEqual(['휴양']);
    // activities = 프리필 원본 — 활동 오버라이드가 undefined 라서(01b Q1, TRIP-1092 전 D5 근거는 폐기).
    expect(snapshot.activities).toEqual(['야경']);

    // 계정 취향은 GET 으로만 읽는다 — PUT 이 나가면 BR-U1-38 위반.
    expect(
      observedHits.some((hit) => hit === 'PUT /api/v1/me/preferences')
    ).toBe(false);

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
  });
});

describe('PI-6 · ★ null-vs-empty — 전해제 → 빈 오버라이드 저장 (프리필로 안 돌아감)', () => {
  it('전부 해제해 적용하면 store 는 [] 이고 제출 styles 도 [] 다 (프리필 아님)', async () => {
    seedValidDraft();
    renderPage();
    await waitForPrefill();
    await openSheet();

    // 프리필 미식·자연 둘 다 해제 → toggleMulti 가 null → 배선이 [] 로 매핑해야 한다.
    fireEvent.press(chip('gourmet'));
    fireEvent.press(chip('nature'));
    await waitFor(() => expect(chip('gourmet')).not.toBeSelected());
    expect(chip('nature')).not.toBeSelected();

    fireEvent.press(screen.getByTestId('trip-wizard-pref-sheet-apply'));

    // store 는 [] (undefined 아님) — 매핑 누락이면 null 이 실려 제출에서 프리필로 폴백한다.
    await waitFor(() =>
      expect(useTripWizardStore.getState().prefStyleOverride).toEqual([])
    );

    fireEvent.press(next());

    await waitFor(() => expect(createHits()).toBe(1));
    const snapshot = postedBodies[0].preferenceSnapshot as { styles: unknown };
    // 빈 오버라이드 — effectiveStyles = [] ?? prefill 이 [] 를 폴백하면(프리필 ['미식','자연']) red.
    expect(snapshot.styles).toEqual([]);
  });
});

describe('PI-7 · ★ D4 hasOverride → 요약 "+ 온보딩" 제거', () => {
  it('오버라이드 없으면 요약 취향 행에 "+ 온보딩"이 붙는다 (선제green 회귀 앵커)', async () => {
    renderPage();
    await waitForPrefill();

    await waitFor(() =>
      expect(summaryPreferenceRow()).toHaveTextContent(/미식/)
    );
    // TRIP-732: 옛 " + 온보딩" 문자열이 스파클+분홍 "온보딩" 배지로 바뀐다 → `\+`를 뗀 `/온보딩/`로
    // 검사(구·신 렌더 모두 "온보딩"을 담아 선제 green, 반전 후 `\+` 부재로 깨지는 것 예방).
    expect(summaryPreferenceRow()).toHaveTextContent(/온보딩/);
  });

  it('스타일 오버라이드가 있으면 요약이 effective(휴양)·activities(야경)를 담고 "온보딩"이 사라진다', async () => {
    useTripWizardStore.getState().setPrefStyleOverride(['휴양']);
    renderPage();
    await waitForPrefill();

    await waitFor(() =>
      expect(summaryPreferenceRow()).toHaveTextContent(/휴양/)
    );
    // 활동 오버라이드 undefined → 프리필(야경) 그대로 — 이제 시트 활동 칩으로 끌 수 있는 값이다(TRIP-1092).
    expect(summaryPreferenceRow()).toHaveTextContent(/야경/);
    // 바꿨는데 "온보딩" 표식이 남으면 거짓 — 제거돼야 한다.
    expect(summaryPreferenceRow()).not.toHaveTextContent(/온보딩/);
  });
});

/**
 * TRIP-677 · S5G — 프리필 async 갭(취향 데이터 손실 봉합). `GET /me/preferences` 도착 전이면
 * `prefillStyles=[]` 라 시트가 빈 [] 드래프트로 열리고, 적용하면 `effectiveStyles=[] ?? prefill=[]`
 * (★2 `??` 는 빈 배열을 값으로 지켜 프리필로 안 돌아감)로 **온보딩 취향이 영구 유실**된다.
 *
 * 봉합: `openPrefSheet` 진입 가드 `if (preference.isPending) return;` — 미도착이면 시트를 아예 안 연다.
 * 신호는 `preference.isPending`(≠`isLoading`, ★3). 이 테스트는 그 커밋 경로를 **시트 미개봉**으로 차단한다.
 *
 * ⚠️ deferred(비해결) 프리필로 pending 을 재현한다(★1) — 응답을 영영 안 주는 msw 핸들러(02a §5-A 실검증).
 * `SummaryRow` 는 isLoading 이어도 onPress 가 살아 있다(값만 스켈레톤, S7 착시 — 02a §5-C).
 */
describe('PI-8 · ★ AC-S5G-1 프리필 미해결 중 취향 행 탭은 시트를 안 연다', () => {
  it('preference 쿼리가 pending 이면 취향 요약 행을 눌러도 PrefOverrideSheet 가 안 열린다', () => {
    // 비해결 프리필 — 도착 전 상태를 영구 고정(deferred, 리포 pending 재현 idiom).
    server.use(http.get(`${BASE}/me/preferences`, () => new Promise(() => {})));

    renderPage();

    // pending 확증 — 로딩 얼굴이라 취향 값 자리가 스켈레톤이다(가드 신호 preference.isPending 활성).
    expect(
      screen.getByTestId('trip-wizard-summary-skeleton-4')
    ).toBeOnTheScreen();

    // 값이 스켈레톤이어도 SummaryRow 의 onPress 는 살아 있다(S7 착시 — isLoading 은 값만 가림).
    fireEvent.press(summaryPreferenceRow());

    // 현행(결함): 가드가 없어 빈 [] 드래프트로 시트가 열린다 → 적용 시 온보딩 취향 유실.
    // 가드(if preference.isPending return) 후엔 시트가 안 열린다.
    expect(screen.queryByTestId('trip-wizard-pref-sheet')).toBeNull();
  });
});

/**
 * TRIP-984 D10 · 취향 시트 하단 "온보딩에서 고른 취향을 가져왔어요" 는 온보딩 취향이 있을 때만.
 * TRIP-1092 01b Q2: 시트가 활동 축도 그리므로 조건이 styles **또는** activities 1개 이상으로 넓어진다 —
 * 온보딩 활동 칩이 켜진 채 열리는데 "온보딩에서" 를 빼면 출처를 숨긴다. 둘 다 없으면 뒤쪽 절만 남는다.
 */
describe('PI-9 · AC-D3·D4 취향 시트 문구는 온보딩 취향(styles 또는 activities)이 있을 때만 "온보딩에서"', () => {
  it('D3 · 온보딩 styles·activities 가 모두 0개면 "프로필 취향은 바뀌지 않아요" 만 보이고 "온보딩에서" 는 없다', async () => {
    // TRIP-1092 개정: activities 도 비운다(Q2 — activities 만 있어도 "온보딩에서" 가 붙는다, D3b).
    server.use(
      http.get(`${BASE}/me/preferences`, () =>
        HttpResponse.json({
          ...PREFERENCE,
          styles: { value: [] },
          activities: { value: [] },
        })
      )
    );
    renderPage();
    await waitForPrefill();
    await openSheet();

    const sheet = screen.getByTestId('trip-wizard-pref-sheet');
    expect(
      within(sheet).getByText('프로필 취향은 바뀌지 않아요')
    ).toBeOnTheScreen();
    expect(within(sheet).queryByText(/온보딩에서/)).toBeNull();
  });

  it('D3b · TRIP-1092 Q2 — styles 가 0개여도 activities 가 있으면 "온보딩에서" 문구가 붙는다', async () => {
    server.use(
      http.get(`${BASE}/me/preferences`, () =>
        HttpResponse.json({ ...PREFERENCE, styles: { value: [] } })
      )
    );
    renderPage();
    await waitForPrefill();
    await openSheet();

    const sheet = screen.getByTestId('trip-wizard-pref-sheet');
    expect(
      within(sheet).getByText(
        '온보딩에서 고른 취향을 가져왔어요 · 프로필 취향은 바뀌지 않아요'
      )
    ).toBeOnTheScreen();
  });

  it('D4 · 온보딩 styles 가 있으면 기존 문구 그대로다 (무회귀)', async () => {
    renderPage();
    await waitForPrefill();
    await openSheet();

    expect(
      screen.getByText(
        '온보딩에서 고른 취향을 가져왔어요 · 프로필 취향은 바뀌지 않아요'
      )
    ).toBeOnTheScreen();
  });
});

// ── TRIP-1092 · 취향 시트 활동 칩 (QA A13 · 결정 1·2) ─────────────────────────────────────
//
// 무엇을 보장하나: 요약 "취향" 행에 보이는 값은 전부 시트에서 끄고 켤 수 있고(A13), 활동 축도 스타일과
// 똑같이 여행 단위로 덮어써 행·제출 스냅숏에 반영된다(BR-U1-38). 같은 라벨(자연·쇼핑)은 행에 한 번만
// 보이고, 두 축은 라벨이 같아도 서로 따로 켜지고 꺼진다.
//
// ⚠️ 행 값은 `within(row).getByText('…')` **완전 일치**로 본다 — 값 Text 노드가 하나(`SummaryRow`
// value.main)라 중복 라벨이면 문자열 자체가 달라 red. `toHaveTextContent(/자연/)` 는 두 번이어도 통과한다.

/** A13 재현 — 온보딩 styles=[미식, 자연] · activities=[역사문화](역사문화는 스타일 7칩에 없다). */
const PREF_A13: PreferenceView = {
  ...PREFERENCE,
  styles: { value: ['미식', '자연'] },
  activities: { value: ['역사문화'] },
};

/** 결정 2 재현 — 자연이 두 축 모두에 있다. */
const PREF_DUP: PreferenceView = {
  ...PREFERENCE,
  styles: { value: ['미식', '자연'] },
  activities: { value: ['자연', '야경'] },
};

function servePreference(preference: PreferenceView): void {
  server.use(
    http.get(`${BASE}/me/preferences`, () => HttpResponse.json(preference))
  );
}

function activityChip(slug: string) {
  return screen.getByTestId(`trip-wizard-pref-activity-chip-${slug}`);
}

function applySheet(): void {
  fireEvent.press(screen.getByTestId('trip-wizard-pref-sheet-apply'));
}

/** 행 값(value.main) 노드 — 완전 일치로 찾는다(없으면 throw). */
function preferenceValue(text: string) {
  return within(summaryPreferenceRow()).getByText(text);
}

async function waitForSheetClosed(): Promise<void> {
  await waitFor(() =>
    expect(screen.queryByTestId('trip-wizard-pref-sheet')).toBeNull()
  );
}

/** A13 핵심 단언 — 행에 보이는 라벨 하나하나가 시트에서 **켜진 칩**으로 존재한다(축 무관). */
function expectEveryRowLabelIsSelectedChip(rowMain: string): void {
  const sheet = screen.getByTestId('trip-wizard-pref-sheet');
  for (const label of rowMain.split(' · ')) {
    expect(
      within(sheet).getAllByRole('button', { name: label, selected: true })
        .length
    ).toBeGreaterThan(0);
  }
}

function putHits(): number {
  return observedHits.filter((hit) => hit === 'PUT /api/v1/me/preferences')
    .length;
}

function postedSnapshot(): { styles: unknown; activities: unknown } {
  return postedBodies[0].preferenceSnapshot as {
    styles: unknown;
    activities: unknown;
  };
}

describe('PA-1 · TRIP-1092 AC-1 (A13) — 행의 모든 값이 시트에서 켜진 칩으로 대응한다', () => {
  it('styles=[미식,자연]·activities=[역사문화] 면 시트에서 활동 역사문화가 켜져 있다', async () => {
    servePreference(PREF_A13);
    renderPage();
    await waitForPrefill();
    expect(preferenceValue('미식 · 자연 · 역사문화')).toBeOnTheScreen();

    await openSheet();

    expect(activityChip('history')).toBeSelected();
    // 스타일 자연이 켜져 있어도 활동 자연은 꺼져 있다(라벨 공유 아님).
    expect(activityChip('nature')).not.toBeSelected();
    for (const slug of [
      'themepark',
      'foodtour',
      'cafe',
      'exhibition',
      'nightview',
      'shopping',
    ]) {
      expect(activityChip(slug)).not.toBeSelected();
    }
    expectEveryRowLabelIsSelectedChip('미식 · 자연 · 역사문화');
  });
});

describe('PA-2 · ★ TRIP-1092 AC-2·AC-3·AC-10 — 활동 해제 → 적용 → 행·스냅숏에서 사라진다', () => {
  it('역사문화를 끄고 적용하면 행에서 빠지고, 제출 activities 는 [] 이고 PUT 은 없다', async () => {
    servePreference(PREF_A13);
    seedValidDraft();
    renderPage();
    await waitForPrefill();
    await openSheet();

    fireEvent.press(activityChip('history'));
    await waitFor(() => expect(activityChip('history')).not.toBeSelected());
    applySheet();
    await waitForSheetClosed();

    expect(preferenceValue('미식 · 자연')).toBeOnTheScreen();
    // 유일한 활동을 끄면 toggleMulti 가 null — 배선이 [] 로 담아야 프리필로 안 돌아간다(null-vs-empty).
    expect(useTripWizardStore.getState().prefActivityOverride).toEqual([]);

    fireEvent.press(next());

    await waitFor(() => expect(createHits()).toBe(1));
    expect(postedSnapshot().styles).toEqual(['미식', '자연']);
    expect(postedSnapshot().activities).toEqual([]);
    expect(putHits()).toBe(0);
  });
});

describe('PA-3 · TRIP-1092 AC-2 — 다시 열면 활동 칩이 적용한 값에서 시작한다', () => {
  it('역사문화를 끄고 적용한 뒤 다시 열면 역사문화가 꺼진 채다 (프리필로 되살아나지 않는다)', async () => {
    servePreference(PREF_A13);
    renderPage();
    await waitForPrefill();
    await openSheet();
    fireEvent.press(activityChip('history'));
    await waitFor(() => expect(activityChip('history')).not.toBeSelected());
    applySheet();
    await waitForSheetClosed();

    await openSheet();

    expect(activityChip('history')).not.toBeSelected();
  });
});

describe('PA-4 · TRIP-1092 AC-4 — 배지 정직성', () => {
  it('오버라이드 없으면 온보딩 배지가 있고, 활동을 바꿔 적용하면 배지가 사라지며 행 값은 전부 시트에서 켜진 칩이다', async () => {
    servePreference(PREF_A13);
    renderPage();
    await waitForPrefill();
    // 오버라이드 없음 → 배지.
    expect(
      screen.getByTestId('trip-wizard-preference-sparkle')
    ).toBeOnTheScreen();

    await openSheet();
    fireEvent.press(activityChip('nightview'));
    await waitFor(() => expect(activityChip('nightview')).toBeSelected());
    applySheet();
    await waitForSheetClosed();

    expect(screen.queryByTestId('trip-wizard-preference-sparkle')).toBeNull();
    expect(preferenceValue('미식 · 자연 · 역사문화 · 야경')).toBeOnTheScreen();

    // 배지를 뗀 행에 "여행에서 못 바꾼 온보딩 값"이 남지 않는다 — 다시 열어 전부 켜진 칩으로 확인.
    await openSheet();
    expectEveryRowLabelIsSelectedChip('미식 · 자연 · 역사문화 · 야경');
  });
});

describe('PA-5 · TRIP-1092 AC-5 (결정 2) — 두 축에 같은 라벨이 있으면 행에 한 번만', () => {
  it('styles=[미식,자연]·activities=[자연,야경] 이면 행은 "미식 · 자연 · 야경" 이다', async () => {
    servePreference(PREF_DUP);
    renderPage();
    await waitForPrefill();

    // 완전 일치 — "미식 · 자연 · 자연 · 야경"(중복)이면 이 노드를 못 찾아 red.
    expect(preferenceValue('미식 · 자연 · 야경')).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-preference-sparkle')
    ).toBeOnTheScreen();
  });
});

describe('PA-6 · ★ TRIP-1092 AC-6 (결정 2) — 활동 쪽 자연만 끄면 스타일 자연은 남는다', () => {
  it('활동 자연을 끄고 적용·제출하면 행에 자연이 한 번 남고, activities 에서만 자연이 빠진다', async () => {
    servePreference(PREF_DUP);
    seedValidDraft();
    renderPage();
    await waitForPrefill();
    await openSheet();
    expect(activityChip('nature')).toBeSelected();
    expect(chip('nature')).toBeSelected();

    fireEvent.press(activityChip('nature'));

    await waitFor(() => expect(activityChip('nature')).not.toBeSelected());
    // 교차 토글 금지 — 라벨이 같아도 스타일 자연은 그대로.
    expect(chip('nature')).toBeSelected();

    applySheet();
    await waitForSheetClosed();
    expect(preferenceValue('미식 · 자연 · 야경')).toBeOnTheScreen();

    fireEvent.press(next());

    await waitFor(() => expect(createHits()).toBe(1));
    expect(postedSnapshot().styles).toEqual(['미식', '자연']);
    expect(postedSnapshot().activities).toEqual(['야경']);
    expect(putHits()).toBe(0);
  });
});

describe('PA-7 · ★ TRIP-1092 축 분리 (쇼핑) — 한 축의 쇼핑을 눌러도 다른 축 쇼핑은 그대로', () => {
  it('활동 쇼핑 켬 → 스타일 쇼핑 켬 → 활동 쇼핑 끔, 매번 반대 축 상태가 안 바뀐다', async () => {
    servePreference(PREF_DUP);
    renderPage();
    await waitForPrefill();
    await openSheet();
    expect(activityChip('shopping')).not.toBeSelected();
    expect(chip('shopping')).not.toBeSelected();

    fireEvent.press(activityChip('shopping'));
    await waitFor(() => expect(activityChip('shopping')).toBeSelected());
    expect(chip('shopping')).not.toBeSelected();

    fireEvent.press(chip('shopping'));
    await waitFor(() => expect(chip('shopping')).toBeSelected());
    expect(activityChip('shopping')).toBeSelected();

    fireEvent.press(activityChip('shopping'));
    await waitFor(() => expect(activityChip('shopping')).not.toBeSelected());
    expect(chip('shopping')).toBeSelected();
  });
});

describe('PA-8 · TRIP-1092 AC-7 — 활동 칩을 안 건드리면 activities 는 온보딩 프리필 그대로', () => {
  it('시트를 안 열고 제출하면 activities 는 프리필 [역사문화] 다 (선제 green 앵커)', async () => {
    servePreference(PREF_A13);
    seedValidDraft();
    renderPage();
    await waitForPrefill();

    fireEvent.press(next());

    await waitFor(() => expect(createHits()).toBe(1));
    expect(postedSnapshot().styles).toEqual(['미식', '자연']);
    expect(postedSnapshot().activities).toEqual(['역사문화']);
  });

  it('스타일만 바꿔 적용해도 활동은 프리필 그대로 함께 커밋되고, 제출 activities 는 [역사문화] 다', async () => {
    servePreference(PREF_A13);
    seedValidDraft();
    renderPage();
    await waitForPrefill();
    await openSheet();

    fireEvent.press(chip('gourmet'));
    await waitFor(() => expect(chip('gourmet')).not.toBeSelected());
    applySheet();
    await waitForSheetClosed();

    // 적용은 두 축을 함께 커밋한다(01b Q1) — 활동 드래프트(=프리필)가 그대로 실린다.
    expect(useTripWizardStore.getState().prefActivityOverride).toEqual([
      '역사문화',
    ]);

    fireEvent.press(next());

    await waitFor(() => expect(createHits()).toBe(1));
    expect(postedSnapshot().styles).toEqual(['자연']);
    expect(postedSnapshot().activities).toEqual(['역사문화']);
  });
});

describe('PA-9 · TRIP-1092 AC-8 — 온보딩 취향 0개면 행은 플레이스홀더 (무회귀)', () => {
  it('styles·activities 모두 비면 행 값은 "취향 선택" 이고 온보딩 배지가 없다 (선제 green 앵커)', async () => {
    servePreference({
      ...PREFERENCE,
      styles: { value: [] },
      activities: { value: [] },
    });
    renderPage();
    await waitForPrefill();

    expect(preferenceValue('취향 선택')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-wizard-preference-sparkle')).toBeNull();
  });
});
