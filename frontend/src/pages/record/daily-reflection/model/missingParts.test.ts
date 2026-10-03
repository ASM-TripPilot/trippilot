import fc from 'fast-check';

import type { ReflectionStats } from '@/shared/api/generated/schemas';

import { missingParts } from './missingParts';

/**
 * TRIP-571 · AC-3 (BR-U5-34) — 부분 데이터면 누락을 명시한다(조용히 칸을 지우지 않는다).
 * TRIP-763 · AC-1 — mapNotice 를 단일 문자열 → **2필드 계약** `{title, body} | null` 로 확장.
 * TRIP-1118 — 지도 자리 사유를 **이유별로** 고른다(QA 5회차 #22: 권한 허용인데 "GPS 미동의" 가 떴다).
 *
 * 무엇을 보장하나:
 *  - photoCount===0 → `hidePhotoGrid=true`(하이라이트/사진 그리드 자리에 "사진 없음").
 *  - visitCount<2 → `distanceDash=true`(거리 "—").
 *  - mapNotice 는 늘 `{reason, title, body}` 다. 방문 ≤1 → few-visits(권한 무관) / 방문 ≥2·권한 거부 →
 *    permission / 그 밖(허용·모름·미주입) → no-route(BR-U5-55 실동선 미실장). 어느 사유에도 "미동의" 없음.
 *
 * 왜 이렇게 테스트하나(02a ★4·★5):
 *  - 판정은 사유 키로 잰다. 문구 전문은 아침 판단 대상이라 "확정 문구" describe **한 곳에서만** 잠근다.
 *  - `distanceKm` 은 required number(null 없음)라 "—"는 값이 아니라 **판정 플래그**(distanceDash)로
 *    표현한다 — VISIT_LINE 근사가 방문점 2개 이상을 이어야 성립하므로 1곳 이하는 이동거리가 무의미(01b Q2).
 *
 * 3동작: 준비=stats(+권한) → 실행=missingParts → 단언=플래그·사유 키·문구.
 */

type Permission = 'granted' | 'denied' | 'unknown';
type Reason = 'few-visits' | 'permission' | 'no-route';
type NewParts = {
  hidePhotoGrid: boolean;
  distanceDash: boolean;
  mapNotice: { reason: Reason; title: string; body: string } | null;
};

// 새 계약(두 번째 인자 권한 · reason 필드)으로 부른다. 구현 전 타입을 거스르지 않게 캐스팅(구현 후에도 호환).
const judge = missingParts as unknown as (
  stats: ReflectionStats,
  permission?: Permission
) => NewParts;

const REASONS: readonly Reason[] = ['few-visits', 'permission', 'no-route'];
/** 소요시간 표기 탐지기(INV-3) — reflectionStructure G6 과 같은 식. */
const DURATION_TEXT = /(소요|\d+\s*분|\d+\s*시간)/;

function stats(over: Partial<ReflectionStats> = {}): ReflectionStats {
  return {
    visitCount: 4,
    distanceKm: 12,
    distanceSource: 'VISIT_LINE',
    photoCount: 6,
    ...over,
  };
}

describe('AC-3 · missingParts — 누락 표기(BR-U5-34)', () => {
  it('사진 0장이면 사진 그리드를 생략 신호로 표시한다', () => {
    expect(missingParts(stats({ photoCount: 0 })).hidePhotoGrid).toBe(true);
  });

  it('사진이 1장 이상이면 그리드를 생략하지 않는다(짝)', () => {
    expect(missingParts(stats({ photoCount: 3 })).hidePhotoGrid).toBe(false);
  });

  it('방문 2곳 미만이면 사유는 few-visits 이고 2필드가 비지 않으며 "미동의"가 없다 + 거리 "—" (TRIP-1118 뒤집기)', () => {
    const parts = judge(stats({ visitCount: 1 }));
    const notice = parts.mapNotice;

    expect(notice?.reason).toBe('few-visits');
    expect(notice?.title.trim()).toBeTruthy();
    expect(notice?.body.trim()).toBeTruthy();
    // 옛 계약은 body 에 "미동의로" 를 요구했다 — 권한과 무관한 거짓 사유라 이제는 없어야 한다(INV-4).
    expect(`${notice?.title} ${notice?.body}`).not.toContain('미동의');
    expect(parts.distanceDash).toBe(true);
  });

  it('방문 0곳도 few-visits 사유 2필드 + 대시(1곳 이하 전부)', () => {
    const parts = judge(stats({ visitCount: 0 }));

    expect(parts.mapNotice?.reason).toBe('few-visits');
    expect(parts.mapNotice?.title).toBeTruthy();
    expect(parts.mapNotice?.body).toBeTruthy();
    expect(parts.distanceDash).toBe(true);
  });

  it('방문 2곳 이상이면(권한 미주입=모름) 사유는 no-route 이고 거리 대시는 없다 (TRIP-1118 뒤집기 — 옛 null)', () => {
    const parts = judge(stats({ visitCount: 2 }));

    expect(parts.mapNotice).not.toBeNull();
    expect(parts.mapNotice?.reason).toBe('no-route');
    expect(parts.distanceDash).toBe(false);
  });
});

describe('🔴 TRIP-1118 AC-2~5 · 사유 진리표 — 방문 수가 먼저, 그다음 권한', () => {
  it.each<[number, Permission | undefined, Reason]>([
    [0, 'denied', 'few-visits'],
    [1, 'denied', 'few-visits'],
    [1, 'granted', 'few-visits'],
    [2, 'denied', 'permission'],
    [7, 'denied', 'permission'],
    [2, 'granted', 'no-route'],
    [2, 'unknown', 'no-route'],
    [2, undefined, 'no-route'],
  ])('방문 %i · 권한 %s → %s', (visitCount, permission, expected) => {
    const notice = judge(stats({ visitCount }), permission).mapNotice;

    expect(notice?.reason).toBe(expected);
  });
});

/**
 * 확정 문구 — 브리프 보수안(아침 판단 Q1). 카피가 바뀌면 **이 표 한 곳만** 고친다. 다른 테스트는 키와
 * 의미 앵커로만 잰다(02a ★4).
 */
describe('🔴 TRIP-1118 · 확정 문구 3종(아침 판단 대상 — 이번 구현 값)', () => {
  it.each<[Reason, number, Permission, string, string]>([
    ['few-visits', 1, 'granted', '동선 없음', '방문 기록이 2곳 미만이에요'],
    [
      'permission',
      2,
      'denied',
      '위치 권한 꺼짐',
      '위치 권한이 꺼져 있어 이동 경로를 기록하지 않아요',
    ],
    [
      'no-route',
      2,
      'granted',
      '동선 지도 없음',
      '실제 이동 경로 지도는 아직 지원하지 않아요',
    ],
  ])(
    '%s 사유의 제목·본문이 확정 문구와 완전 일치한다',
    (reason, visitCount, permission, title, body) => {
      expect(judge(stats({ visitCount }), permission).mapNotice).toEqual({
        reason,
        title,
        body,
      });
    }
  );
});

describe('🔴 TRIP-1118 AC-4·5 · 의미 앵커 — 권한을 말하는 건 permission 뿐, 세 사유는 서로 다르다', () => {
  it('permission 만 "권한"을 말하고, few-visits·no-route 는 권한을 단정하지 않으며, 세 본문이 모두 다르다', () => {
    const fewVisits = judge(stats({ visitCount: 1 }), 'granted').mapNotice;
    const permission = judge(stats({ visitCount: 2 }), 'denied').mapNotice;
    const noRoute = judge(stats({ visitCount: 2 }), 'granted').mapNotice;
    const text = (n: typeof fewVisits) => `${n?.title} ${n?.body}`;

    expect(text(permission)).toContain('권한');
    expect(text(fewVisits)).not.toContain('권한');
    expect(text(noRoute)).not.toContain('권한');
    expect(
      new Set([fewVisits?.body, permission?.body, noRoute?.body]).size
    ).toBe(3);
  });
});

describe('🔴 TRIP-1118 AC-6 · 속성(PBT) — 어떤 입력이든 사유는 정확히 하나이고 정직하다', () => {
  it('임의 방문·사진 × 권한(3값+미주입)에서 사유 1개 · 2필드 비지 않음 · 미동의·소요시간 없음 · 방문≤1 이면 few-visits', () => {
    fc.assert(
      fc.property(
        fc.nat(),
        fc.nat(),
        fc.constantFrom<Permission | undefined>(
          'granted',
          'denied',
          'unknown',
          undefined
        ),
        (visitCount, photoCount, permission) => {
          const parts = judge(stats({ visitCount, photoCount }), permission);
          const notice = parts.mapNotice;

          expect(notice).not.toBeNull();
          expect(REASONS.filter((r) => r === notice?.reason)).toHaveLength(1);
          expect(notice?.title.trim()).not.toBe('');
          expect(notice?.body.trim()).not.toBe('');
          expect(`${notice?.title} ${notice?.body}`).not.toContain('미동의');
          expect(`${notice?.title} ${notice?.body}`).not.toMatch(DURATION_TEXT);
          if (visitCount <= 1) expect(notice?.reason).toBe('few-visits');
          // 무회귀 — 대시·사진 신호의 의미는 그대로.
          expect(parts.distanceDash).toBe(visitCount < 2);
          expect(parts.hidePhotoGrid).toBe(photoCount === 0);
        }
      ),
      { numRuns: 300 }
    );
  });
});
