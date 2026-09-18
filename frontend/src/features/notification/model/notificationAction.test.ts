import { notificationAction } from './notificationAction';

/**
 * TRIP-576 · l01 · AC-4·5·6 — `notificationAction(kind, actionType, actionPayload) → route|null`
 * 라우팅 사영을 **표로 잠근다**. 순수 함수라 화면·서버 없이 값만 검사한다.
 *
 * 무엇을 보장하나(3동작 뼈대 = 준비: kind·actionType·payload → 실행: notificationAction → 단언: route|null):
 *  - **AC-4**: PLAN_B + `{tripId}` → `/trips/{tripId}/planb`. tripId 없으면 null(액션 없음).
 *  - **AC-5**: REFLECTION + `{tripId, date}` → `/trips/{tripId}/records/reflection/{date}`.
 *  - **AC-6**: REFLECTION 인데 date·tripId 불완전(또는 payload null) → null(데이터없음 회고 = 액션·라우팅 0).
 *  - **kind 폴백**: actionType 이 `TRIP_ITINERARY` 든 null 이든 route 는 kind+payload 로 결정된다
 *    (계약 드리프트 — REFLECTION·PLAN_B 용 actionType 이 계약에 없다, 브리프 5.①). 두 actionType 에서
 *    같은 결과를 잠가 "actionType 우선, 없으면 kind 폴백"이 kind 로 떨어짐을 증명.
 *  - 딥링크 없는 kind(STAY·TRIP_*·SLOT_PRE·COMMUNITY·SYSTEM) → 전부 null(인앱함 표시만).
 *
 * 커버하지 않는 것: 실제 화면 이동(6-b 실기 — REFLECTION 대상 라우트는 U5 미착수). 여기선 경로 문자열만.
 *
 * (개념) 순수 함수 = 같은 입력이면 항상 같은 출력, 바깥 상태를 안 건드림. 그래서 렌더 없이 값만 비교한다.
 */

describe('notificationAction · AC-4 PLAN_B 라우팅', () => {
  it('PLAN_B + {tripId} → /trips/{tripId}/planb (actionType=null)', () => {
    expect(notificationAction('PLAN_B', null, { tripId: 't1' })).toBe(
      '/trips/t1/planb'
    );
  });

  it('PLAN_B 는 actionType=TRIP_ITINERARY 여도 같은 결과(kind 폴백)', () => {
    expect(
      notificationAction('PLAN_B', 'TRIP_ITINERARY', { tripId: 't1' })
    ).toBe('/trips/t1/planb');
  });

  it('PLAN_B 인데 tripId 없으면 null (payload {} · null)', () => {
    expect(notificationAction('PLAN_B', null, {})).toBeNull();
    expect(notificationAction('PLAN_B', null, null)).toBeNull();
  });
});

describe('notificationAction · AC-5 REFLECTION 완료 라우팅', () => {
  it('REFLECTION + {tripId, date} → /trips/{tripId}/records/reflection/{date}', () => {
    expect(
      notificationAction('REFLECTION', null, {
        tripId: 't1',
        date: '2026-08-29',
      })
    ).toBe('/trips/t1/records/reflection/2026-08-29');
  });

  it('REFLECTION 도 actionType 값에 관계없이 kind+payload 로 결정된다', () => {
    expect(
      notificationAction('REFLECTION', 'TRIP_ITINERARY', {
        tripId: 't1',
        date: '2026-08-29',
      })
    ).toBe('/trips/t1/records/reflection/2026-08-29');
  });
});

describe('notificationAction · AC-6 데이터없음 회고 = 액션없음(null)', () => {
  it('REFLECTION 인데 date 없음 → null', () => {
    expect(notificationAction('REFLECTION', null, { tripId: 't1' })).toBeNull();
  });

  it('REFLECTION 인데 tripId 없음 → null', () => {
    expect(
      notificationAction('REFLECTION', null, { date: '2026-08-29' })
    ).toBeNull();
  });

  it('REFLECTION + payload null → null', () => {
    expect(notificationAction('REFLECTION', null, null)).toBeNull();
  });
});

describe('notificationAction · 딥링크 없는 kind 는 전부 null', () => {
  it.each(['STAY', 'TRIP_PRE', 'TRIP_DAY', 'SLOT_PRE', 'COMMUNITY', 'SYSTEM'])(
    '%s → null (payload 가 있어도 딥링크 없음)',
    (kind) => {
      expect(
        notificationAction(
          kind as Parameters<typeof notificationAction>[0],
          null,
          { tripId: 't1' }
        )
      ).toBeNull();
    }
  );
});
