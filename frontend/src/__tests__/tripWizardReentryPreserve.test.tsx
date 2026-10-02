import { render, screen } from '@testing-library/react-native';

import TripWizardLayout from '@/app/trips/new/_layout';
import type { MustVisitSeedItem } from '@/features/create-trip/model/mustVisitSeed';
import { useTripWizardStore } from '@/features/create-trip/model/tripWizardStore';

/**
 * TRIP-1113 결정 2 — 위저드 **안** 재진입(꼭 갈 곳 고르기 완료)은 이미 만든 여행 id 를 지키고,
 * 새 진입은 지금처럼 비운다.
 *
 * 무엇을 보장하나: `keepCreatedTripIdOnce()` 가 켠 1회성 표식이 있으면 셸 마운트가 `createdTripId`
 * 를 비우지 않고 표식을 끈다. 다음 마운트부터는 다시 비운다. 새 진입의 `reset()` 은 표식까지 끈다.
 * 기존 GC-1~4(`tripWizardEntryReset.test.tsx`)는 이 파일과 별개로 무변경이다.
 *
 * ⚠️ jest 는 실제 셸 재마운트 여부를 못 본다(`expo-router` 통째 목) — 여기서는 "마운트되면 무엇이
 * 남는가"까지만 잠근다. 재마운트가 안 되는 경우는 셸 효과가 아예 안 돌아 id 가 그대로 남는다.
 * `Stack` 목은 호이스트 규칙 때문에 모듈에서 `require` 한다(`tripWizardEntryReset` 머리말과 같다).
 */

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const stackMock = require('@/test-support/expoRouterStackMock');
  return { __esModule: true, ...stackMock };
});

const store = () => useTripWizardStore.getState();
const seedIds = () => store().mustVisits.map((one) => one.sourcePoiId);

function seed(sourcePoiId: string): MustVisitSeedItem {
  return {
    sourcePoiId,
    name: `장소-${sourcePoiId}`,
    imageUrl: null,
    region: null,
  };
}

beforeEach(() => {
  store().reset();
});

afterEach(() => {
  store().reset();
});

describe('GP · 셸 보존 표식 (TRIP-1113 AC-8)', () => {
  it('🔴 GP-1 표식이 켜진 채 셸이 마운트되면 이미 만든 여행 id 가 남는다', () => {
    store().setCreatedTripId('trip-A');
    store().keepCreatedTripIdOnce();

    render(<TripWizardLayout />);

    expect(store().createdTripId).toBe('trip-A');
    expect(screen.getByTestId('gate-stack')).toBeOnTheScreen();
  });

  it('🔴 GP-2 표식은 한 번만 쓰인다 — 다음 마운트는 다시 id 를 비운다', () => {
    store().setCreatedTripId('trip-A');
    store().keepCreatedTripIdOnce();
    const first = render(<TripWizardLayout />);
    expect(store().createdTripId).toBe('trip-A');

    first.unmount();
    render(<TripWizardLayout />);

    expect(store().createdTripId).toBeUndefined();
  });

  it('🔴 GP-3 꼭 갈 곳 고르기 완료 상태(시드 표식 + id 표식)면 시드와 id 가 둘 다 남는다', () => {
    store().seedMustVisitsFromD02([seed('poi-1')]);
    store().setCreatedTripId('trip-A');
    store().keepCreatedTripIdOnce();

    render(<TripWizardLayout />);

    expect(store().createdTripId).toBe('trip-A');
    expect(seedIds()).toEqual(['poi-1']);
  });

  it('🔴 GP-4 새 진입의 reset() 은 표식까지 끈다 — 그 뒤 마운트는 id 를 비운다', () => {
    store().keepCreatedTripIdOnce();
    store().reset();
    store().setCreatedTripId('trip-B');

    render(<TripWizardLayout />);

    expect(store().createdTripId).toBeUndefined();
  });
});
