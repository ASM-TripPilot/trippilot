import { create, type StateCreator } from 'zustand';

import type {
  CompanionType,
  TripDestination,
} from '@/shared/api/index.schemas';

import { mergeMustVisitSeeds, type MustVisitSeedItem } from './mustVisitSeed';
import { MAX_TRIP_NIGHTS, nightsSum } from './tripDraft';
import { deriveEndDate, type PeriodPresetCode } from './tripWizardStep1';

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
  /** 여행 단위 취향 오버라이드(TRIP-669 D1) — `undefined`=오버라이드 없음(프리필 사용),
   * 배열(빈 `[]` 포함)=오버라이드. 전해제도 `[]`로 담아 프리필로 되돌아가지 않게 한다
   * (null-vs-empty — 배선이 `toggleMulti`의 `null`을 `[]`로 매핑). 계정 취향은 안 건드린다
   * (BR-U1-38 — 여기 담는 건 여행 로컬 값이다). */
  prefStyleOverride?: string[];
  /** 활동 축 오버라이드(TRIP-1092) — `prefStyleOverride`와 같은 규약이고 서로 독립이다(자연·쇼핑이
   * 두 축에 같은 라벨로 있어 한 필드로 합치면 "활동 자연만 끔"을 못 담는다). */
  prefActivityOverride?: string[];
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
  /** d02 CTA가 방금 `seedMustVisitsFromD02`로 심었다는 1회성 표시 — 위저드 셸이
   * 마운트 시 이 값을 보고 `resetMustVisits()`를 건너뛴다(그 뒤 스스로 끈다). 그 외 진입은
   * 항상 `false`라 평소대로 비워진다. */
  preserveMustVisitsOnce: boolean;
  /** 꼭 갈 곳 고르기 완료(위저드 **안** 재진입)가 켜는 1회성 표시(TRIP-1113 결정 2) — 셸이 마운트 시
   * 이 값을 보면 `createdTripId`를 비우지 않고 스스로 끈다. 그래야 돌아온 step1이 여행을 또 만들지
   * 않고 고친다(PATCH). `INITIAL_DRAFT`에 있어 새 진입의 `reset()`이 함께 끈다. */
  preserveCreatedTripIdOnce: boolean;
  /** `regionCode` — 지역 피커가 쥔 행정구역 코드(TRIP-1042 AC-12). 꼭 갈 곳 고르기가 이 코드로 지역을
   * 가르고, 생성 요청에도 그대로 실린다. 안 주면 비어 있다(서버가 이름으로 찾는다). */
  addDestination(regionName: string, nights: number, regionCode?: string): void;
  removeDestination(seq: number): void;
  /** 해당 seq destination 의 nights 를 교체(하한 `minNightsFor` — 도시 하나면 0, 여럿이면 1). seq 미일치면 no-op. add/remove 는
   * 무변경 재사용(TRIP-666 여행지 편집 시트). */
  setNights(seq: number, nights: number): void;
  /** `presetCode`가 `undefined`면 "어떤 칩도 선택 안 됨" — 프리셋이 아닌 출처(등록 숙소
   * 날짜, TRIP-208)로 기간을 채우는 경로다. 상태 필드가 이미 `presetCode?`(초기 `undefined`)라
   * 새 코드값이나 별도 액션을 만들지 않는다(01b D10 — 새 코드값은 `PERIOD_PRESETS`가 곧
   * 칩 목록이라 5번째 칩을 낳는다). */
  setPeriod(
    presetCode: PeriodPresetCode | undefined,
    startDate: string,
    endDate: string
  ): void;
  /** 시작 날짜만 고른다(TRIP-1027) — 끝은 `시작 + Σnights`로 파생된다. 여행지가 0곳이면 끝 =
   * 시작(당일). 프리셋 출처가 아니므로 `presetCode`는 비운다. */
  setStartDate(startDate: string): void;
  /** 1 미만은 1로 접는다(BR-U1-39 하한) — 화면의 `−` 비활성과 별개로 여기서도 방어한다. */
  setParty(next: number): void;
  selectCompanion(type: CompanionType): void;
  /** 사람 경로 — 원문을 판단 없이 담고 `touched`에 `'budget'`을 켠다. **빈 문자열을 넣는
   * 것도 "건드린 것"이다**(01b D6 ③) — 그래야 지운 상태가 재진입에도 보존된다(AC-1c). */
  setBudgetText(next: string): void;
  /** 여행 단위 취향 오버라이드 커밋(TRIP-669) — 빈 배열도 그대로 저장한다(최소 0 허용).
   * `undefined`(오버라이드 없음)와 `[]`(전해제한 오버라이드)를 서로 다른 상태로 남긴다. */
  setPrefStyleOverride(styles: string[]): void;
  /** 활동 축 오버라이드 커밋(TRIP-1092) — 규약은 `setPrefStyleOverride`와 같다. */
  setPrefActivityOverride(activities: string[]): void;
  setCreatedTripId(tripId: string): void;
  /** `preserveCreatedTripIdOnce`만 켠다 — 켜는 곳은 꼭 갈 곳 고르기 완료 한 곳이다(d02 새 진입의
   * `seedMustVisitsFromD02`에 합치면 새 여행이 옛 id를 물고 간다 — TRIP-601 가드 c). */
  keepCreatedTripIdOnce(): void;
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
   * `createdTripId`도 남긴다 — 정본이 수명을 정하지 않았다. 비우는 것은 셸 마운트(TRIP-601 가드 c)와
   * `reset()`이고, 남아 있으면 step1은 그 여행을 새로 만들지 않고 고친다(TRIP-1113). */
  resetMustVisits(): void;
  /** d02 "이 장소들로 여행 만들기" 전용 시드 문 — 사용자 결정으로 신설(자동 재시드 폐지 뒤,
   * 이 명시적 액션만은 살린다). `preserveMustVisitsOnce`를 함께 켠다 — 이 CTA는 늘 새 위저드
   * 진입을 동반해(`router.push('/trips/new/step1')`) 셸(`app/trips/new/_layout.tsx`)이 마운트
   * 시 `resetMustVisits()`로 방금 심은 시드를 지워 버리는데, 그 한 번만 건너뛰라는 신호다. */
  seedMustVisitsFromD02(items: MustVisitSeedItem[]): void;
  reset(): void;
}

const INITIAL_DRAFT = {
  destinations: [] as TripDestination[],
  startDate: undefined as string | undefined,
  endDate: undefined as string | undefined,
  presetCode: undefined as PeriodPresetCode | undefined,
  party: 1,
  // 동반 기본값 '혼자'(TRIP-1045, `PartyPicker`) — 기본값이라 `touched`는 켜지 않는다.
  companionType: '혼자' as CompanionType | undefined,
  budgetText: '',
  // `undefined`=오버라이드 없음. `INITIAL_DRAFT`에 이 키를 둬야 병합형 `reset()`이 지운다(SO-4).
  prefStyleOverride: undefined as string[] | undefined,
  prefActivityOverride: undefined as string[] | undefined,
  touched: [] as TripWizardField[],
  createdTripId: undefined as string | undefined,
  mustVisits: [] as MustVisitSeedItem[],
  mustVisitsInitialized: false,
  excludedMustVisitPoiIds: [] as string[],
  preserveMustVisitsOnce: false,
  preserveCreatedTripIdOnce: false,
};

/** 이미 켜져 있으면 그대로 둔다 — 집합이지 로그가 아니다(같은 축을 여러 번 건드려도
 * 중복으로 쌓이지 않는다). */
function withTouched(
  touched: TripWizardField[],
  field: TripWizardField
): TripWizardField[] {
  return touched.includes(field) ? touched : [...touched, field];
}

/** 여행지 목록이 바뀐 뒤의 끝 날짜(TRIP-1027) — 시작이 있으면 `시작 + Σnights`로 다시 계산하고,
 * 없으면 끝을 건드리지 않는다(시작 없이 끝만 생기는 상태를 만들지 않는다). */
function endAfter(
  state: TripWizardDraft,
  destinations: TripDestination[]
): string | undefined {
  return state.startDate
    ? deriveEndDate(state.startDate, nightsSum(destinations))
    : state.endDate;
}

/** 도시당 박수 하한 — **도시가 하나일 때만 0박(당일치기)이 합법이다**. 여러 도시에서 한 도시만 0박이면
 *  그 도시의 방문일이 없다는 뜻이라 의미가 모호하다(결정: 다도시는 도시당 최소 1박). */
export function minNightsFor(destinationCount: number): number {
  return destinationCount === 1 ? 0 : 1;
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
  addDestination: (regionName, nights, regionCode) =>
    set((state) => {
      // 두 번째 도시를 담으면 하한이 1 로 올라간다 — 기존 도시가 0박이었다면 1박으로 올린다.
      const raised =
        state.destinations.length + 1 >= 2
          ? state.destinations.map((one) =>
              one.nights < 1 ? { ...one, nights: 1 } : one
            )
          : state.destinations;
      // 새로 담는 도시도 같은 하한을 지난다 — 다도시가 되는 순간 0박 도시를 만들 수 없다.
      const floor = minNightsFor(raised.length + 1);
      const destinations = renumberSeq([
        ...raised,
        {
          seq: 0,
          region: regionName,
          nights: Math.max(floor, nights),
          regionCode,
        },
      ]);
      return {
        destinations,
        endDate: endAfter(state, destinations),
        touched: withTouched(state.touched, 'destinations'),
      };
    }),
  removeDestination: (seq) =>
    set((state) => {
      // `seq`로 지운다(TRIP-364) — 이름과 달리 목록 안에서 유일하다(renumberSeq가 1..N을
      // 매긴다). 같은 지역을 두 번 담아도 사용자가 누른 *그* 칩을 정확히 짚는다. 이름으로
      // 지우던 옛 구현은 첫 일치만 지워 "누른 것을 지우지 못하던" 뿌리였고(더 전에는 `filter`로
      // 전부 지워 "부산 하나를 지우려다 부산 전부를 잃던" 버그였다), 코드/seq 식별로 그 뿌리를
      // 없앤다. 못 찾는 seq는 조용히 무동작(filter가 아무것도 안 지움).
      const destinations = renumberSeq(
        state.destinations.filter((one) => one.seq !== seq)
      );
      return {
        destinations,
        endDate: endAfter(state, destinations),
        touched: withTouched(state.touched, 'destinations'),
      };
    }),
  setNights: (seq, nights) =>
    set((state) => {
      // 해당 seq의 nights만 갈아 끼운다 — `map`이 seq 미일치 항목은 원본 그대로 되돌려주므로
      // 못 찾는 seq는 저절로 no-op이다(seq 재번호는 nights만 바뀌어 필요 없다). 하한은
      // `minNightsFor` 하나로 접는다 — 도시 하나면 0박(당일치기), 여럿이면 최소 1박(01b D1 + 0박 결정).
      // 상한은 박수 **합** `MAX_TRIP_NIGHTS`(TRIP-1219 a) — 다른 도시 몫을 뺀 만큼까지만 오른다.
      // renumberSeq는 여기서 안 부른다: 목록 길이·순서가 그대로라 seq도 그대로다.
      const floor = minNightsFor(state.destinations.length);
      const othersSum = state.destinations.reduce(
        (total, one) => (one.seq === seq ? total : total + one.nights),
        0
      );
      const ceiling = Math.max(floor, MAX_TRIP_NIGHTS - othersSum);
      const destinations = state.destinations.map((one) =>
        one.seq === seq
          ? { ...one, nights: Math.min(ceiling, Math.max(floor, nights)) }
          : one
      );
      return { destinations, endDate: endAfter(state, destinations) };
    }),
  setPeriod: (presetCode, startDate, endDate) =>
    set((state) => ({
      presetCode,
      startDate,
      endDate,
      touched: withTouched(state.touched, 'period'),
    })),
  setStartDate: (startDate) =>
    set((state) => ({
      presetCode: undefined,
      startDate,
      endDate: deriveEndDate(startDate, nightsSum(state.destinations)),
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
  setPrefStyleOverride: (styles) => set({ prefStyleOverride: styles }),
  setPrefActivityOverride: (activities) =>
    set({ prefActivityOverride: activities }),
  setCreatedTripId: (tripId) => set({ createdTripId: tripId }),
  keepCreatedTripIdOnce: () => set({ preserveCreatedTripIdOnce: true }),
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
  seedMustVisitsFromD02: (items) =>
    set({
      mustVisits: items,
      mustVisitsInitialized: true,
      excludedMustVisitPoiIds: [],
      preserveMustVisitsOnce: true,
    }),
  reset: () => set(INITIAL_DRAFT),
});

export const useTripWizardStore = create(createTripWizardDraft);
