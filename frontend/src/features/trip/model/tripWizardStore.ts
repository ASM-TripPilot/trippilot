import { create, type StateCreator } from 'zustand';

import type {
  CompanionType,
  TripDestination,
} from '@/shared/api/generated/schemas';

import type { PeriodPresetCode } from './tripWizardStep1';

/**
 * 위저드 1/2 드래프트 — 화면 밖에 사는 세션 메모리 상자(TRIP-205, 01b §10.1 · D3).
 * `persist` 없음 — Zustand는 서버가 모르는 UI 상태만 둔다(frontend/README.md). 뒤로 갔다
 * 재진입해도 값이 남는 것(BR-U1-33)은 이 모듈이 앱 생존 중 유지되는 모듈 싱글턴이라
 * 저절로 성립한다 — 기기 저장소가 필요한 요구가 아니다.
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

export type TripWizardField = 'destinations' | 'period' | 'party' | 'companion';

export interface TripWizardDraft {
  destinations: TripDestination[];
  startDate?: string;
  endDate?: string;
  presetCode?: PeriodPresetCode;
  party: number;
  companionType?: CompanionType;
  /** 아직 소비자가 없다(문구를 안 그리므로) — TRIP-206이 이 값을 읽어 오류 문구를 건다. */
  touched: TripWizardField[];
  /** 제출 성공 응답이 준 `tripId`(01b D7). 라우트(`/trips/new/step2`)가 id를 안 나르므로
   * 여기 담아 둔다 — g02(TRIP-84·TRIP-193)가 읽는 소비자다. */
  createdTripId?: string;
  addDestination(regionName: string, nights: number): void;
  removeDestination(regionName: string): void;
  setPeriod(
    presetCode: PeriodPresetCode,
    startDate: string,
    endDate: string
  ): void;
  /** 1 미만은 1로 접는다(BR-U1-39 하한) — 화면의 `−` 비활성과 별개로 여기서도 방어한다. */
  setParty(next: number): void;
  selectCompanion(type: CompanionType): void;
  setCreatedTripId(tripId: string): void;
  reset(): void;
}

const INITIAL_DRAFT = {
  destinations: [] as TripDestination[],
  startDate: undefined as string | undefined,
  endDate: undefined as string | undefined,
  presetCode: undefined as PeriodPresetCode | undefined,
  party: 1,
  companionType: undefined as CompanionType | undefined,
  touched: [] as TripWizardField[],
  createdTripId: undefined as string | undefined,
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
  setCreatedTripId: (tripId) => set({ createdTripId: tripId }),
  reset: () => set(INITIAL_DRAFT),
});

export const useTripWizardStore = create(createTripWizardDraft);
