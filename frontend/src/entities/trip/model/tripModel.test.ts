import type {
  Trip,
  TripStatus,
  TripDestination,
  MyTripCardVM,
  MyTripBadge,
  PastTripCardVM,
} from '@/entities/trip/model';

/**
 * TRIP-808 · AC-1 — entities/trip/model 이 trip 도메인의 **공개 창구**임을 잠근다(806 place·807 stay 동형).
 *
 * 무엇을 보장하나:
 *  - 🔴 서버 계약 타입(`Trip`·`TripStatus`·`TripDestination`)을 entities 가 **재수출**한다 — 새 타입을
 *    만드는 게 아니라 `@/shared/api/generated/schemas` 의 원본을 그대로 다시 내보내(re-export) "여기가
 *    trip 도메인 진입점"이라는 표시. 서버 계약의 정본은 여전히 `shared/api`(`api` 세그먼트 0).
 *  - 🔴 카드 뷰모델 `MyTripCardVM`·`MyTripBadge`(h06)·`PastTripCardVM`(j07)을 entities 가 **정의**한다 —
 *    지금은 `features/itinerary/ui/MyTripCard`·`features/record/model/recordsCalendar` 로컬에 있던 것을
 *    이리로 옮긴다(바이트 동일 형태).
 *
 * *(개념 — re-export)*: `export type { Trip } from '@/shared/api/...'` 처럼 원본을 그대로 다시 내보내는
 *  것. 이 파일(entities/trip/model)이 없으면 위 import 가 모듈 해석에 실패해 **`pnpm tsc` 가 red** 다.
 *  타입 import 는 런타임(jest)에 지워지므로, 계약 형태로 객체를 구성해 "타입이 있다"를 tsc 가 심판한다
 *  — 그래서 이 파일은 jest 에선 green, **tsc 가 진짜 심판**이다(아래 02 실행 방법 참고).
 *
 * 3동작 뼈대: 준비=entities/trip/model import → 실행=계약 형태 객체 구성 → 단언=키 존재·형태 일치.
 */

describe('🔴 AC-1 · entities/trip/model 재수출 + 카드 뷰모델', () => {
  it('M1-1 · Trip·TripStatus·TripDestination 타입이 재수출된다(계약 형태로 구성 가능)', () => {
    // 재수출이 없으면 tsc red. 런타임에선 구성 객체의 키 존재만 확인한다.
    const status: TripStatus = 'PLANNED';
    const destination: TripDestination = { seq: 1, region: '부산', nights: 3 };
    const trip: Trip = {
      tripId: 't1',
      title: '서귀포시 여행',
      startDate: '2026-06-10',
      endDate: '2026-06-13',
      party: 2,
      preferenceSnapshot: {},
      destinations: [destination],
      status,
      createdAt: '2026-09-13T00:00:00Z',
      updatedAt: '2026-09-13T00:00:00Z',
    };

    expect(trip).toHaveProperty('tripId', 't1');
    expect(trip.destinations[0]).toHaveProperty('nights', 3);
    expect(trip.status).toBe('PLANNED');
  });

  it('M1-2 · MyTripCardVM·MyTripBadge 를 정의한다(tripId·title·metaLine·badge·extra)', () => {
    const badge: MyTripBadge = 'done';
    const vm = {
      tripId: 't1',
      title: '서귀포시 여행',
      metaLine: '6월 10일 ~ 13일 · 3박 4일 · 2명',
      badge,
      extra: '확정 장소 12곳',
    } satisfies MyTripCardVM;

    expect(vm).toEqual({
      tripId: 't1',
      title: '서귀포시 여행',
      metaLine: '6월 10일 ~ 13일 · 3박 4일 · 2명',
      badge: 'done',
      extra: '확정 장소 12곳',
    });
  });

  it('M1-3 · MyTripBadge 는 null 도 받고, extra 도 null 이 될 수 있다(itinerary 미도착 degrade)', () => {
    // 배지 미정·부가정보 없음 — 계약이 열어 둔 값(글리프 fill 아니라 값으로 판별, INV-1 정신).
    const degraded = {
      tripId: 't2',
      title: '제주 여행',
      metaLine: '7월 1일 ~ 3일 · 2박 3일 · 1명',
      badge: null,
      extra: null,
    } satisfies MyTripCardVM;

    expect(degraded.badge).toBeNull();
    expect(degraded.extra).toBeNull();
  });

  it('M1-4 · PastTripCardVM 을 정의한다(tripId·title + 널 가능 dateRangeLabel·nightsLabel)', () => {
    // 날짜/박수 라벨은 못 만들면 null(가짜 날짜·가짜 "0박" 금지, j07 정직 degrade).
    const withLabels = {
      tripId: 't9',
      title: '부산 여행',
      dateRangeLabel: '2026.5.1–5.3',
      nightsLabel: '2박 3일',
    } satisfies PastTripCardVM;
    const bare = {
      tripId: 't10',
      title: '광안리 여행',
      dateRangeLabel: null,
      nightsLabel: null,
    } satisfies PastTripCardVM;

    expect(withLabels).toHaveProperty('dateRangeLabel', '2026.5.1–5.3');
    expect(bare.dateRangeLabel).toBeNull();
    expect(bare.nightsLabel).toBeNull();
  });
});
