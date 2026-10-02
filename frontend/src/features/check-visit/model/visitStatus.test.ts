import fc from 'fast-check';

import { deriveVisitStatus, type VisitStatus } from './visitStatus';

/**
 * TRIP-565 · AC-4 (INV-U5-01) — 방문 상태는 세 timestamp 에서만 파생한다.
 *
 * 무엇을 보장하나:
 *  - 임의의 (arrivedAt, completedAt, skippedAt) nullable 조합에서 우선순위
 *    skipped > completed > arrived > upcoming 으로 SKIPPED|COMPLETED|IN_PROGRESS|UPCOMING 이 나온다.
 *  - 저장된 status enum 문자열을 만들지도 읽지도 않는다(입력에 status 자리가 없고, 있어도 무시).
 *
 * jest = 가짜 입력으로 규칙을 확인. fast-check = 임의 입력 수백 개로 속성이 항상 성립하나 확인(PBT).
 */

/** nullable 시각 arbitrary — null·undefined·ISO 문자열 셋 다 낸다(VisitCheck 필드가 `?` 옵셔널). */
const maybeTs = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc
    .date({
      min: new Date('2020-01-01'),
      max: new Date('2030-01-01'),
      noInvalidDate: true,
    })
    .map((d) => d.toISOString())
);

describe('AC-4 · deriveVisitStatus — 세 timestamp 파생 (PBT)', () => {
  it('임의 nullable 조합에서 우선순위 skipped>completed>arrived>upcoming 으로 파생한다', () => {
    fc.assert(
      fc.property(
        maybeTs,
        maybeTs,
        maybeTs,
        (arrivedAt, completedAt, skippedAt) => {
          const status = deriveVisitStatus({
            arrivedAt,
            completedAt,
            skippedAt,
          });

          if (skippedAt != null) {
            expect(status).toBe('SKIPPED');
          } else if (completedAt != null) {
            expect(status).toBe('COMPLETED');
          } else if (arrivedAt != null) {
            expect(status).toBe('IN_PROGRESS');
          } else {
            expect(status).toBe('UPCOMING');
          }
        }
      )
    );
  });
});

describe('AC-4 · 진리표 — 4모서리 + 우선순위 충돌', () => {
  const T = '2026-08-31T14:20:00';
  const cases: Array<{
    name: string;
    arrivedAt: string | null;
    completedAt: string | null;
    skippedAt: string | null;
    expected: VisitStatus;
  }> = [
    {
      name: '전부 null → UPCOMING',
      arrivedAt: null,
      completedAt: null,
      skippedAt: null,
      expected: 'UPCOMING',
    },
    {
      name: '도착만 → IN_PROGRESS',
      arrivedAt: T,
      completedAt: null,
      skippedAt: null,
      expected: 'IN_PROGRESS',
    },
    {
      name: '완료 → COMPLETED',
      arrivedAt: null,
      completedAt: T,
      skippedAt: null,
      expected: 'COMPLETED',
    },
    {
      name: '건너뜀 → SKIPPED',
      arrivedAt: null,
      completedAt: null,
      skippedAt: T,
      expected: 'SKIPPED',
    },
    {
      name: '도착+완료 → COMPLETED(완료가 도착 이김)',
      arrivedAt: T,
      completedAt: T,
      skippedAt: null,
      expected: 'COMPLETED',
    },
    {
      name: '도착+건너뜀 → SKIPPED',
      arrivedAt: T,
      completedAt: null,
      skippedAt: T,
      expected: 'SKIPPED',
    },
    {
      name: '셋 다 → SKIPPED(건너뜀 최우선)',
      arrivedAt: T,
      completedAt: T,
      skippedAt: T,
      expected: 'SKIPPED',
    },
  ];

  it.each(cases)('$name', ({ arrivedAt, completedAt, skippedAt, expected }) => {
    expect(deriveVisitStatus({ arrivedAt, completedAt, skippedAt })).toBe(
      expected
    );
  });
});

describe('AC-4 · ★INV-U5-01 — 저장된 status 를 읽지 않는다', () => {
  it('가짜 status 필드가 섞여도 timestamps 만 따른다', () => {
    // timestamps 가 전부 null 이면 UPCOMING 이어야 한다 — 섞인 status:'COMPLETED' 를 읽으면 red.
    const misleading = {
      arrivedAt: null,
      completedAt: null,
      skippedAt: null,
      status: 'COMPLETED',
    } as unknown as Parameters<typeof deriveVisitStatus>[0];

    expect(deriveVisitStatus(misleading)).toBe('UPCOMING');
  });
});
