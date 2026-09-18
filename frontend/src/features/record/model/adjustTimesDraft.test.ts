import fc from 'fast-check';

import { adjustTimesDraft } from './adjustTimesDraft';

/**
 * TRIP-613 · AC-2·AC-4 · BR-U5-05 · frontend-components §7 · PBT-U5-2 —
 * 방문 시각 편집의 **클라 선검증** 순수 함수(순서·완료없이도착·미래). 서버 재검증이 최종이라
 * 이건 UX 게이팅용(INV-2) — 위반이면 요청을 안 내보내고 인라인 오류를 그리게 한다.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 순서: completedAt < arrivedAt 이면 거부('order', BR-U5-05, **PBT-U5-2** 임의 조합 전수).
 *  - 완료없이도착: completedAt 만 있고 arrivedAt 이 없으면 거부('completed-without-arrived', BR-U5-05).
 *  - 미래: 제공된 시각 중 하나라도 now 보다 미래면 거부('future', §7).
 *  - 판별 유니온 반환({ok:true} | {ok:false,reason}) — 조용한 false 금지(INV-4 결).
 *  - ★ now 는 **주입 인자**다 — 실시계를 안 읽는다(같은 입력에 now 만 바꾸면 valid↔future 뒤집힘).
 *
 * (개념) *판별 유니온* = 성공/실패를 한 타입의 서로 다른 가지로 표현해 실패 사유를 잃지 않는다.
 * *PBT(속성 기반 테스트)* = 임의 입력 수백 개로 "완료<도착이면 항상 거부"가 늘 성립하나 확인한다.
 *
 * 3동작 뼈대: 준비=시각 쌍+now → 실행=adjustTimesDraft → 단언=판별 유니온.
 */

// 미래 규칙을 소거하려는 먼 미래 기준시각(순서/완료없이도착 케이스에서 미래가 끼어들지 않게).
const FAR_FUTURE = '3000-01-01T00:00:00';

describe('🔴 U1 · 순서 — completedAt < arrivedAt 이면 거부(BR-U5-05)', () => {
  it('완료(13:00)가 도착(14:00)보다 앞서면 {ok:false, reason:"order"}', () => {
    expect(
      adjustTimesDraft({
        arrivedAt: '2026-08-31T14:00:00',
        completedAt: '2026-08-31T13:00:00',
        now: FAR_FUTURE,
      })
    ).toEqual({ ok: false, reason: 'order' });
  });

  it('완료 == 도착(경계 ≥)은 위반이 아니다 — {ok:true}', () => {
    // BR-U5-05 는 completedAt ≥ arrivedAt 이라 같은 시각은 허용(체류 0, 음수 아님).
    expect(
      adjustTimesDraft({
        arrivedAt: '2026-08-31T14:00:00',
        completedAt: '2026-08-31T14:00:00',
        now: FAR_FUTURE,
      })
    ).toEqual({ ok: true });
  });
});

describe('🔴 U2 · 완료없이도착 불가 — completedAt 만 있으면 거부(BR-U5-05)', () => {
  it('arrivedAt 없이 completedAt 만 있으면 {ok:false, reason:"completed-without-arrived"}', () => {
    expect(
      adjustTimesDraft({
        arrivedAt: null,
        completedAt: '2026-08-31T14:00:00',
        now: FAR_FUTURE,
      })
    ).toEqual({ ok: false, reason: 'completed-without-arrived' });
  });

  it('둘 다 없음은 위반 아님(편집 없음/도착 전 정상) — {ok:true}', () => {
    expect(
      adjustTimesDraft({ arrivedAt: null, completedAt: null, now: FAR_FUTURE })
    ).toEqual({ ok: true });
  });
});

describe('🔴 U3·U4 · 미래 시각 불가 — 제공된 시각이 now 초과면 거부(§7)', () => {
  it('U3 · 도착이 now 보다 미래(완료 없음)면 {ok:false, reason:"future"}', () => {
    expect(
      adjustTimesDraft({
        arrivedAt: '2026-08-31T16:00:00',
        completedAt: null,
        now: '2026-08-31T15:00:00',
      })
    ).toEqual({ ok: false, reason: 'future' });
  });

  it('U4 · 도착은 과거인데 완료가 now 보다 미래면 거부(각 제공 시각 검사)', () => {
    // 순서(완료13:00... 아니, 완료가 미래라 도착보다 뒤 → 순서 OK)로 접히지 않고 미래로 잡히는지.
    expect(
      adjustTimesDraft({
        arrivedAt: '2026-08-31T13:00:00',
        completedAt: '2026-08-31T18:00:00',
        now: '2026-08-31T15:00:00',
      })
    ).toEqual({ ok: false, reason: 'future' });
  });
});

describe('🔴 U5 · 정상 — 과거·순서 정합이면 {ok:true}', () => {
  it('도착 13:20 · 완료 15:00 · now 20:00 → 통과', () => {
    expect(
      adjustTimesDraft({
        arrivedAt: '2026-08-31T13:20:00',
        completedAt: '2026-08-31T15:00:00',
        now: '2026-08-31T20:00:00',
      })
    ).toEqual({ ok: true });
  });
});

describe('🔴 U6 · ★now 주입 — 실시계를 안 읽는다', () => {
  it('같은 시각 입력에 now 만 바꾸면 future↔valid 가 뒤집힌다', () => {
    const arrivedAt = '2026-08-31T16:00:00';
    // now 가 도착보다 앞(15:00)이면 미래 → 거부.
    expect(
      adjustTimesDraft({
        arrivedAt,
        completedAt: null,
        now: '2026-08-31T15:00:00',
      })
    ).toEqual({ ok: false, reason: 'future' });
    // now 가 도착보다 뒤(20:00)면 과거 → 통과. 내부에서 Date.now() 를 읽으면 이 짝이 성립 못 한다.
    expect(
      adjustTimesDraft({
        arrivedAt,
        completedAt: null,
        now: '2026-08-31T20:00:00',
      })
    ).toEqual({ ok: true });
  });
});

describe('🔴 PBT-U5-2 · 임의 조합에서 완료<도착이면 항상 거부', () => {
  // fast-check v4: fc.date 는 noInvalidDate:true 없으면 Invalid Date 를 내 .toISOString() 이 throw
  // (visitStatus.test.ts 02b test-fix 실측). 두 날짜를 뽑아 strict 부등만 남기고, 이른 쪽=완료·늦은
  // 쪽=도착으로 강제(완료<도착) + now=FAR_FUTURE 로 미래 규칙을 소거해 순서 위반만 남긴다(조합 상쇄 방지).
  const dateArb = fc
    .date({
      min: new Date('2020-01-01T00:00:00Z'),
      max: new Date('2030-01-01T00:00:00Z'),
      noInvalidDate: true,
    })
    .map((d) => d.toISOString());

  it('completedAt < arrivedAt 이면 어떤 시각쌍에서도 {ok:false, reason:"order"}', () => {
    fc.assert(
      fc.property(dateArb, dateArb, (a, b) => {
        fc.pre(a !== b); // 등가는 순서 위반이 아니라 허용(≥) — 성질 밖이라 건너뛴다.
        const earlier = a < b ? a : b;
        const later = a < b ? b : a;
        const result = adjustTimesDraft({
          arrivedAt: later, // 도착이 늦다
          completedAt: earlier, // 완료가 이르다 → 완료<도착
          now: FAR_FUTURE,
        });
        expect(result).toEqual({ ok: false, reason: 'order' });
      })
    );
  });
});
