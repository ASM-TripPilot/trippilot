import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

/**
 * 위저드 드래프트(모듈 싱글턴) 테스트 헬퍼 — TRIP-1012 "새 진입점은 이동 직전 드래프트를 비운다".
 *
 * 초기값을 손으로 적지 않는다: 스토어 초기값(`INITIAL_DRAFT`)은 비공개라, zustand 의
 * `getInitialState()`(스토어가 처음 만들어진 순간의 상태 객체)에서 액션(함수)을 뺀 값을 쓴다.
 * 드래프트 필드가 늘어도 이 헬퍼는 고칠 필요가 없다.
 */

export type WizardDraftData = Record<string, unknown>;

/** 상태 객체에서 액션을 뺀 값만 — 비교 대상은 데이터다. */
export function wizardDraftData(
  state: object = useTripWizardStore.getState()
): WizardDraftData {
  return Object.fromEntries(
    Object.entries(state).filter(([, value]) => typeof value !== 'function')
  );
}

/** 새 여행의 얼굴 — 스토어가 처음 만들어졌을 때의 값. */
export function freshWizardDraft(): WizardDraftData {
  return wizardDraftData(useTripWizardStore.getInitialState());
}

/** 시드 3필드를 뺀 나머지 — d02 CTA 는 비운 뒤 시드만 다시 심는다. */
export function withoutSeedFields(draft: WizardDraftData): WizardDraftData {
  const rest = { ...draft };
  delete rest.mustVisits;
  delete rest.mustVisitsInitialized;
  delete rest.preserveMustVisitsOnce;
  return rest;
}

/** 직전 여행이 남긴 드래프트 — 모든 데이터 필드를 초기값과 다르게 채운다(브리프 B1). */
export function leavePreviousTripDraft(): void {
  const store = useTripWizardStore.getState();
  store.addDestination('부산', 1);
  store.setPeriod('1n2d', '2026-10-10', '2026-10-11');
  store.setParty(3);
  store.selectCompanion('가족');
  store.setBudgetText('500,000');
  store.setPrefStyleOverride(['힐링']);
  store.setPrefActivityOverride(['역사문화']);
  store.setCreatedTripId('trip-prev');
  store.seedMustVisitsFromD02([
    {
      sourcePoiId: 'poi-prev-1',
      name: '예전 곳 1',
      imageUrl: null,
      region: null,
    },
    {
      sourcePoiId: 'poi-prev-2',
      name: '예전 곳 2',
      imageUrl: null,
      region: null,
    },
  ]);
  store.removeMustVisit('poi-prev-2');
}

/**
 * 다음 한 번의 호출 **그 순간**의 드래프트를 붙잡는다 — "push 전에 비웠나"를 재는 창구.
 * `mockImplementationOnce` 라 다음 테스트로 새지 않는다(`mockClear` 는 구현을 안 지운다).
 */
export function captureDraftAtNextCall(
  fn: jest.Mock
): () => WizardDraftData | undefined {
  let seen: WizardDraftData | undefined;
  fn.mockImplementationOnce(() => {
    seen = wizardDraftData();
  });
  return () => seen;
}

/** 파일 최상위 `afterEach` 용 — describe 안에만 걸면 앞 테스트의 드래프트가 샌다. */
export function resetWizardDraft(): void {
  useTripWizardStore.getState().reset();
}
