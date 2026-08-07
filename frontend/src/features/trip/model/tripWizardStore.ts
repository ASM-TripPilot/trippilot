import { create, type StateCreator } from 'zustand';

import type {
  CompanionType,
  TripDestination,
} from '@/shared/api/generated/schemas';

import { mergeMustVisitSeeds, type MustVisitSeedItem } from './mustVisitSeed';
import type { PeriodPresetCode } from './tripWizardStep1';

/**
 * 위저드 1/2 드래프트 — 화면 밖에 사는 세션 메모리 상자(TRIP-205, 01b §10.1 · D3).
 * `persist` 없음 — Zustand는 서버가 모르는 UI 상태만 둔다(frontend/README.md). 뒤로 갔다
 * 재진입해도 값이 남는 것(BR-U1-33)은 이 모듈이 앱 생존 중 유지되는 모듈 싱글턴이라
 * 저절로 성립한다 — 기기 저장소가 필요한 요구가 아니다. **예외는 시드 3필드뿐이다**:
 * 위저드 셸이 진입마다 `resetMustVisits()`로 그 셋만 비운다(TRIP-288 D1 · AC-1). 사용자가
 * 손으로 채운 축은 그 초기화에서도 그대로 남는다.
 *
 * `touched` — 사용자가 어떤 축을 건드렸는지 집합으로 기억한다. `validateTripDraft`(TRIP-204)는
 * 페일클로즈라 빈 드래프트에서도 위반 3개를 낸다 — 그대로 문구로 뿌리면 아무것도 안 고른
 * 사용자에게 오류가 뜬다(AC-10c). 이 칸은 문구를 그리지 않으므로(D3 — 표시는 TRIP-206)
 * 여기서는 `touched`를 쌓아 두기만 한다.
 *
 * `create(` 리터럴을 그대로 남기는 이유는 `preferenceStore.ts`와 같다 — 구조 가드 정규식
 * `/\bcreate\(/`가 `create<T>(...)` 제네릭 표기는 오탐 없이 지나치므로, 타입은
 * `StateCreator` 변수로 먼저 확정하고 `create(그변수)` 형태로 호출한다.
 */

export type TripWizardField =
  'destinations' | 'period' | 'party' | 'companion' | 'budget';

export interface TripWizardDraft {
  destinations: TripDestination[];
  startDate?: string;
  endDate?: string;
  presetCode?: PeriodPresetCode;
  party: number;
  companionType?: CompanionType;
  /** 예산 입력 원문(콤마 포함 가능) — 사람이 친 그대로 담긴다. 파싱은 순수 함수
   * (`budgetAmount.ts`) 몫이다. 프리필은 여기 쓰지 않는다 — 파생값이라 쓰는 경로 자체가
   * 없다(01b 불변식 — 프리필이 `setBudgetText`를 타면 touched가 켜져 자기 자신을 잠근다,
   * TRIP-207 02a §2-2). */
  budgetText: string;
  /** 아직 소비자가 없다(문구를 안 그리므로) — TRIP-206이 이 값을 읽어 오류 문구를 건다. */
  touched: TripWizardField[];
  /** 제출 성공 응답이 준 `tripId`(01b D7). 라우트(`/trips/new/step2`)가 id를 안 나르므로
   * 여기 담아 둔다 — g02(TRIP-84·TRIP-193)가 읽는 소비자다. */
  createdTripId?: string;
  /** '꼭 갈 곳' 시드(TRIP-209) — 담은 목록의 **복사본**이라 원본과 독립이다(BR-U1-37).
   * 서버 응답이 아니라 자체 뷰모델을 담는다(frontend/README.md §66 — 서버 상태의 단일
   * 소유자는 Query 캐시다). */
  mustVisits: MustVisitSeedItem[];
  mustVisitsInitialized: boolean;
  /** 사용자가 x로 뺀 `sourcePoiId`들(TRIP-288 D7) — 재시드가 되살리지 않게 기억해 둔다.
   * 판정 기준은 이 집합 하나뿐이라, 탐색에서 담기를 풀었다 다시 담아도 여전히 제외다.
   * **`INITIAL_DRAFT`에 있다는 것이 계약의 절반이다** — 새 진입(`reset`)이면 예전 제외가
   * 함께 비워진다. 안 그러면 새 여행에서 "담았는데 안 들어오는" 새 증상이 생긴다. */
  excludedMustVisitPoiIds: string[];
  addDestination(regionName: string, nights: number): void;
  removeDestination(regionName: string): void;
  /** `presetCode`가 `undefined`면 "어떤 칩도 선택 안 됨" — 프리셋이 아닌 출처(등록 숙소
   * 날짜, TRIP-208)로 기간을 채우는 경로다. 상태 필드가 이미 `presetCode?`(초기 `undefined`)라
   * 새 코드값이나 별도 액션을 만들지 않는다(01b D10 — 새 코드값은 `PERIOD_PRESETS`가 곧
   * 칩 목록이라 5번째 칩을 낳는다). */
  setPeriod(
    presetCode: PeriodPresetCode | undefined,
    startDate: string,
    endDate: string
  ): void;
  /** 1 미만은 1로 접는다(BR-U1-39 하한) — 화면의 `−` 비활성과 별개로 여기서도 방어한다. */
  setParty(next: number): void;
  selectCompanion(type: CompanionType): void;
  /** 사람 경로 — 원문을 판단 없이 담고 `touched`에 `'budget'`을 켠다. **빈 문자열을 넣는
   * 것도 "건드린 것"이다**(01b D6 ③) — 그래야 지운 상태가 재진입에도 보존된다(AC-1c). */
  setBudgetText(next: string): void;
  setCreatedTripId(tripId: string): void;
  /** **첫 호출만** 반영한다 — 재조회·리렌더마다 다시 채우면 사용자가 x로 뺀 항목이
   * 되살아나고, 자기가 뺀 곳이 여행에 등록되는 것을 보게 된다. */
  initMustVisits(items: MustVisitSeedItem[]): void;
  /** 재시드 문(TRIP-288) — `initMustVisits`와 달리 **여러 번 불려도 일하되 더하기만** 한다.
   * 두 문을 나눈 이유는 "2회차 무시"가 첫 문의 계약이기 때문이다(그 계약을 무르면 사용자가
   * 뺀 항목이 되살아난다). 더할 게 없으면 `mustVisits`를 갈아 끼우지 않는다 — 이 액션은
   * 화면 효과가 매 렌더 부르는 자리라, 갈아 끼우면 렌더 루프가 된다. */
  addMustVisits(items: MustVisitSeedItem[]): void;
  /** **첫 일치 하나만** 뺀다 — `filter`는 같은 식별자가 둘 있을 때 전부 지운다(아래
   * `removeDestination` 주석의 사고와 같은 함정이다). 뺀 곳은 `excludedMustVisitPoiIds`에
   * 적어 둔다 — 안 적으면 다음 재시드가 그 자리에 같은 곳을 다시 넣는다. */
  removeMustVisit(sourcePoiId: string): void;
  /** 진입 초기화(TRIP-288 D1) — **시드 3필드만** 되돌린다. `reset()`과 문을 나눈 이유는
   * 범위다: 위저드에 새로 들어오는 것은 "새 여행을 시작한다"지 "지금까지 친 것을 버린다"가
   * 아니라, 사용자가 손으로 채운 축(여행지·기간·인원·동반·예산·`touched`)은 재진입에도
   * 남아야 한다(BR-U1-33 · AC-1은 초기화 대상으로 시드 3개만 열거한다).
   * `createdTripId`도 남긴다 — 정본이 수명을 정하지 않았고, step1의 두 소비자가 화면 지역
   * 상태(`pendingMustVisits`)와 짝이라 새 마운트에서는 발화하지 않는다(02a §9-2). */
  resetMustVisits(): void;
  reset(): void;
}

const INITIAL_DRAFT = {
  destinations: [] as TripDestination[],
  startDate: undefined as string | undefined,
  endDate: undefined as string | undefined,
  presetCode: undefined as PeriodPresetCode | undefined,
  party: 1,
  companionType: undefined as CompanionType | undefined,
  budgetText: '',
  touched: [] as TripWizardField[],
  createdTripId: undefined as string | undefined,
  mustVisits: [] as MustVisitSeedItem[],
  mustVisitsInitialized: false,
  excludedMustVisitPoiIds: [] as string[],
};

/** 이미 켜져 있으면 그대로 둔다 — 집합이지 로그가 아니다(같은 축을 여러 번 건드려도
 * 중복으로 쌓이지 않는다). */
function withTouched(
  touched: TripWizardField[],
  field: TripWizardField
): TripWizardField[] {
  return touched.includes(field) ? touched : [...touched, field];
}

/** 목록 순서대로 1..N을 다시 매긴다 — 제거 뒤에도 `seq`에 구멍이 나면 서버가 방문 순서를
 * 읽을 수 없다. */
function renumberSeq(destinations: TripDestination[]): TripDestination[] {
  return destinations.map((destination, index) => ({
    ...destination,
    seq: index + 1,
  }));
}

const createTripWizardDraft: StateCreator<TripWizardDraft> = (set) => ({
  ...INITIAL_DRAFT,
  addDestination: (regionName, nights) =>
    set((state) => ({
      destinations: renumberSeq([
        ...state.destinations,
        { seq: 0, region: regionName, nights },
      ]),
      touched: withTouched(state.touched, 'destinations'),
    })),
  removeDestination: (regionName) =>
    set((state) => {
      // `filter`로 지우면 같은 지역을 두 번 담았을 때(시트가 중복을 걸러내지 않는다)
      // 이름이 같은 항목이 전부 사라진다 — 부산 하나를 지우려다 부산 전부를 잃는다
      // (5-c, code-critic W-3 실측). `findIndex` + 그 한 자리만 잘라내 "첫 일치 하나만"
      // 지운다. 사용자가 누른 *그* 칩을 정확히 짚지는 못한다 — `onRemoveDestination`이
      // 지역 이름만 받고 `seq`는 안 받기 때문(승인된 화면 테스트가 `toHaveBeenCalledWith('부산')`
      // 문자열 인자 하나로 고정돼 있어 여기서 시그니처를 못 바꾼다) — 다만 "둘 다 조용히
      // 사라지는" 상태는 없앤다.
      const index = state.destinations.findIndex(
        (one) => one.region === regionName
      );
      const nextDestinations =
        index === -1
          ? state.destinations
          : [
              ...state.destinations.slice(0, index),
              ...state.destinations.slice(index + 1),
            ];
      return {
        destinations: renumberSeq(nextDestinations),
        touched: withTouched(state.touched, 'destinations'),
      };
    }),
  setPeriod: (presetCode, startDate, endDate) =>
    set((state) => ({
      presetCode,
      startDate,
      endDate,
      touched: withTouched(state.touched, 'period'),
    })),
  setParty: (next) =>
    set((state) => ({
      party: Math.max(1, next),
      touched: withTouched(state.touched, 'party'),
    })),
  selectCompanion: (type) =>
    set((state) => ({
      companionType: type,
      touched: withTouched(state.touched, 'companion'),
    })),
  setBudgetText: (next) =>
    set((state) => ({
      budgetText: next,
      touched: withTouched(state.touched, 'budget'),
    })),
  setCreatedTripId: (tripId) => set({ createdTripId: tripId }),
  initMustVisits: (items) =>
    set((state) =>
      state.mustVisitsInitialized
        ? {}
        : { mustVisits: items, mustVisitsInitialized: true }
    ),
  addMustVisits: (items) =>
    set((state) => {
      const mustVisits = mergeMustVisitSeeds({
        current: state.mustVisits,
        incoming: items,
        excluded: state.excludedMustVisitPoiIds,
      });
      // 순수 함수가 같은 배열을 돌려줬는데 여기서 `[...mustVisits]`로 감싸면 참조가 새로
      // 생겨 루프가 그대로 산다 — 층마다 따로 지켜야 하는 성질이다.
      if (mustVisits === state.mustVisits && state.mustVisitsInitialized) {
        return {};
      }
      return { mustVisits, mustVisitsInitialized: true };
    }),
  removeMustVisit: (sourcePoiId) =>
    set((state) => {
      // `touched`는 건드리지 않는다 — 시드는 `[다음]` 게이트의 축이 아니라서, 여기서
      // 켜면 엉뚱한 축의 오류 문구 게이트가 열린다.
      const index = state.mustVisits.findIndex(
        (one) => one.sourcePoiId === sourcePoiId
      );
      if (index === -1) {
        return {};
      }
      return {
        mustVisits: [
          ...state.mustVisits.slice(0, index),
          ...state.mustVisits.slice(index + 1),
        ],
        // 집합이지 로그가 아니다(`withTouched`와 같은 판단) — 같은 곳을 두 번 빼도
        // 한 번만 쌓인다.
        excludedMustVisitPoiIds: state.excludedMustVisitPoiIds.includes(
          sourcePoiId
        )
          ? state.excludedMustVisitPoiIds
          : [...state.excludedMustVisitPoiIds, sourcePoiId],
      };
    }),
  // 초기값은 `INITIAL_DRAFT`에서 꺼내되, **어떤 키를 비울지는 손으로 적은 목록이다.**
  // 시드 관련 필드를 새로 추가하면 여기에도 반드시 넣어야 한다 — 빠뜨려도 tsc·테스트가
  // 아무것도 안 잡고, 그 필드만 이전 여행 값을 물고 넘어온다(TRIP-288 증상 A의 재발).
  resetMustVisits: () =>
    set({
      mustVisits: INITIAL_DRAFT.mustVisits,
      mustVisitsInitialized: INITIAL_DRAFT.mustVisitsInitialized,
      excludedMustVisitPoiIds: INITIAL_DRAFT.excludedMustVisitPoiIds,
    }),
  reset: () => set(INITIAL_DRAFT),
});

export const useTripWizardStore = create(createTripWizardDraft);
