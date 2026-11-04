import { openNewTripWizard } from '@/features/create-trip';
import type { MustVisitSeedItem } from '@/features/create-trip';
import {
  captureDraftAtNextCall,
  freshWizardDraft,
  leavePreviousTripDraft,
  resetWizardDraft,
  wizardDraftData,
  withoutSeedFields,
} from '@/test-support/wizardDraftFixture';

/**
 * TRIP-1771 — 새 여행 진입의 한 진입점. 계약은 "push 가 불리는 **그 순간**의 드래프트"다:
 * 호출 뒤 상태로 재면 push → reset 순서의 구현도 green 이라 `captureDraftAtNextCall` 로만 잰다.
 * 라우터는 호출처 것을 받는다 — 여기선 `{ push }` 한 멤버짜리 가짜(expo-router 를 목하지 않는다).
 */

afterEach(resetWizardDraft);

const SEED: MustVisitSeedItem[] = [
  { sourcePoiId: 'poi-a', name: '광안리', imageUrl: null, region: null },
  { sourcePoiId: 'poi-b', name: '해운대', imageUrl: null, region: null },
];

function arrangePreviousTrip() {
  leavePreviousTripDraft();
  // 앵커 — 준비가 실제로 직전 흔적을 남겼어야 "비웠다"가 의미를 갖는다.
  expect(wizardDraftData()).not.toEqual(freshWizardDraft());
  const push = jest.fn();
  return { push, seen: captureDraftAtNextCall(push) };
}

describe('openNewTripWizard', () => {
  it('시드 없이 부르면 push 순간의 드래프트가 새 여행의 초기값이고, push 는 step1 로 1회다', () => {
    const { push, seen } = arrangePreviousTrip();

    openNewTripWizard({ push });

    expect(seen()).toEqual(freshWizardDraft());
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/trips/new/step1');
  });

  it('시드를 주면 push 순간에 나머지는 초기값, 꼭 갈 곳은 그 시드이고 셸 통과 표시가 켜져 있다', () => {
    const { push, seen } = arrangePreviousTrip();

    openNewTripWizard({ push }, SEED);

    const draft = seen();
    expect(withoutSeedFields(draft ?? {})).toEqual(
      withoutSeedFields(freshWizardDraft())
    );
    // 비우기 → 시드 순서가 계약이다 — 거꾸로면 reset 이 이 표시와 시드를 끈다.
    expect(draft?.mustVisits).toEqual(SEED);
    expect(draft?.preserveMustVisitsOnce).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/trips/new/step1');
  });
});
