import type { Trip } from '@/shared/api/generated/schemas';

import { pickDoneBar } from './doneBar';

/**
 * TRIP-928 · 01b Q1 — 배너의 "완성" 판정은 카드 배지와 **같은 함수**(`deriveTripCardFace`)를 거친다.
 * 이 파일은 그 함수를 "PARTIAL 만 완성"으로 바꿔 끼운다. 배너가 카드 규칙을 따라가면 PARTIAL 여행을
 * 고르고, `status==='CONFIRMED'` 를 따로 적어 둔 구현이면 CONFIRMED 여행을 골라 red 가 된다.
 * (카드 규칙 Mapping A 를 고칠 때 한 곳만 고치면 배너도 따라온다는 보장.)
 */

jest.mock('./tripCardFace', () => ({
  deriveTripCardFace: (_status?: string, generationState?: string) =>
    generationState === 'PARTIAL'
      ? { statusLine: '', badge: 'done', resume: false }
      : { statusLine: '', badge: 'draft', resume: true },
}));

function trip(tripId: string, updatedAt: string): Trip {
  return {
    tripId,
    title: `${tripId} 여행`,
    startDate: '2099-06-10',
    endDate: '2099-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt,
    baseCount: 0,
    itineraryDayCount: 0,
  };
}

describe('🔴 pickDoneBar · 완성 판정은 deriveTripCardFace 를 거친다 (01b Q1)', () => {
  it('카드 규칙이 바뀌면 배너 대상도 따라 바뀐다', () => {
    // 준비 — 확정 여행이 더 최근이지만, 바꿔 끼운 카드 규칙에선 PARTIAL 만 완성이다.
    const pick = pickDoneBar(
      [
        {
          trip: trip('trip-confirmed', '2026-08-20T00:00:00.000Z'),
          itinerary: { status: 'CONFIRMED', generationState: 'COMPLETE' },
        },
        {
          trip: trip('trip-partial', '2026-08-10T00:00:00.000Z'),
          itinerary: { status: 'PLANNED', generationState: 'PARTIAL' },
        },
      ],
      []
    );

    expect(pick?.target.tripId).toBe('trip-partial');
  });
});
