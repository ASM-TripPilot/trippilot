import fc from 'fast-check';

import type { Reflection } from '@/shared/api/generated/schemas';

import { resolveDisplayNarrative } from './reflectionFallback';

/**
 * TRIP-571 · AC-1(PBT-U5-F1 · 블로킹)·AC-2(BR-U5-35/INV-U5-06) — 표시본 결정 단일 지점.
 *
 * 무엇을 보장하나:
 *  - **AC-1(속성)**: 어떤 회고 응답이 와도 표시본이 **비어 있지 않다**(trim 후에도). 응답 자체 결측,
 *    narrative 빈/공백, editedNarrative null, stats 결측 그 어떤 조합이어도 빈 화면을 안 그린다.
 *  - **AC-2(케이스)**: 폴백 3단 우선순위 — ① 서버 narrative(서버가 이미 edited??draft 로 결정) 우선
 *    → ② 결측/빈문자열이면 editedNarrative ?? draftNarrative → ③ 그마저 없으면 stats 로 조립한 BASIC.
 *
 * 왜 이렇게 테스트하나(02a ★1·★2·★3):
 *  - 클라 함수는 1차 결정자가 아니라 **빈 화면 방지 최후수단**(맹점①) — 서버 `narrative` 가 이미
 *    표시본이므로 서버 우선을 못박고, 결측일 때만 방어적으로 재조립한다.
 *  - BASIC(3단)이 statsCard(0채움)에 기대므로 stats 가 없어도 문장이 생겨 PBT 가 성립한다.
 *
 * (개념) **PBT**: 예제 대신 "어떤 응답에도 성립해야 하는 성질"을 적으면 fast-check 가 임의 입력을
 *   수백 개 만들어 반례를 찾는다. `fc.assert(fc.property(...))` = 반례가 있으면 throw(리포 CI 차단).
 *   **trim().length>0**: 양끝 공백을 걷은 뒤 문자 수 — 공백만 문자열도 "비었다"로 잡는다.
 *
 * 3동작: 준비=임의/특정 응답 → 실행=resolveDisplayNarrative(res) → 단언=표시본 문자열.
 */

const NORMAL = '오늘은 광안리와 미술관을 둘러본 하루였어요.';

/** 계약 위반을 일부러 만드는 arbitrary — 빈/공백/결측/정상 텍스트(visitStatus 가짜필드 주입 선례 동형). */
const maybeText = fc.oneof(
  fc.constant(''),
  fc.constant('   '),
  fc.constant(undefined),
  fc.constant(NORMAL),
  fc.string()
);

const statsArb = fc.oneof(
  fc.constant(undefined),
  fc.record({
    visitCount: fc.nat({ max: 20 }),
    distanceKm: fc.double({ min: 0, max: 100, noNaN: true }),
    distanceSource: fc.constantFrom('ROUTE', 'VISIT_LINE'),
    photoCount: fc.nat({ max: 20 }),
  })
);

/** Reflection|undefined 임의 생성 — 필드 결측 조합까지 만든다(requiredKeys:[] 로 키 자체를 빠뜨림). */
const reflectionArb = fc.oneof(
  fc.constant(undefined),
  fc.record(
    {
      dayDate: fc.constant('2026-06-11'),
      narrative: maybeText,
      draftNarrative: maybeText,
      editedNarrative: fc.oneof(
        fc.constant(null),
        fc.constant(undefined),
        fc.constant('내가 고친 회고예요.'),
        fc.string()
      ),
      source: fc.constantFrom('AI', 'RULE', 'BASIC'),
      stats: statsArb,
      generatedAt: fc.constant('2026-06-11T09:00:00Z'),
      updatedAt: fc.constant('2026-06-11T10:00:00Z'),
    },
    { requiredKeys: [] }
  )
);

describe('AC-1 · resolveDisplayNarrative — 표시본은 항상 비어 있지 않다 (PBT-U5-F1)', () => {
  it('임의의 회고 응답(결측·빈·공백·null 조합)에도 trim 후 길이가 0보다 크다', () => {
    fc.assert(
      fc.property(reflectionArb, (res) => {
        const display = resolveDisplayNarrative(
          res as unknown as Reflection | undefined
        );
        expect(typeof display).toBe('string');
        expect(display.trim().length).toBeGreaterThan(0);
      })
    );
  });

  it('탐지기 자가검사 — 공백만 문자열은 "비었다"로 잡힌다(단언이 공허하지 않다)', () => {
    // trim().length>0 매처가 실제로 공백을 거른다는 것을 실문자열로 확인.
    expect('   '.trim().length).toBe(0);
    expect('a'.trim().length).toBe(1);
  });
});

describe('AC-2 · 폴백 3단 우선순위 (BR-U5-35/INV-U5-06)', () => {
  function reflection(over: Partial<Reflection>): Reflection {
    return {
      dayDate: '2026-06-11',
      narrative: '서버가 정한 표시본입니다.',
      draftNarrative: '생성된 초안입니다.',
      editedNarrative: null,
      source: 'RULE',
      stats: {
        visitCount: 4,
        distanceKm: 12,
        distanceSource: 'VISIT_LINE',
        photoCount: 6,
      },
      generatedAt: '2026-06-11T09:00:00Z',
      updatedAt: '2026-06-11T10:00:00Z',
      ...over,
    };
  }

  it('① 서버 narrative 가 비어있지 않으면 그대로 쓴다(서버 우선 — 클라 재판정 금지)', () => {
    const display = resolveDisplayNarrative(
      reflection({
        narrative: '서버가 정한 표시본입니다.',
        editedNarrative: '고친 문장',
        draftNarrative: '초안 문장',
      })
    );
    // 서버 narrative 가 있으면 edited/draft 를 재조립하지 않는다.
    expect(display).toBe('서버가 정한 표시본입니다.');
  });

  it('② narrative 가 빈 문자열이면 editedNarrative 를 쓴다', () => {
    const display = resolveDisplayNarrative(
      reflection({
        narrative: '',
        editedNarrative: '내가 고친 회고',
        draftNarrative: '초안',
      })
    );
    expect(display).toBe('내가 고친 회고');
  });

  it('③ narrative 비고 editedNarrative 가 null 이면 draftNarrative 를 쓴다', () => {
    const display = resolveDisplayNarrative(
      reflection({
        narrative: '   ',
        editedNarrative: null,
        draftNarrative: '생성된 초안',
      })
    );
    expect(display).toBe('생성된 초안');
  });

  it('④ narrative·edited·draft 전부 결측이면 stats 로 조립한 BASIC 문장(비지 않음)', () => {
    const display = resolveDisplayNarrative(
      reflection({ narrative: '', editedNarrative: null, draftNarrative: '' })
    );
    // BASIC 카드 문장 — 내용 문구는 발명하지 않고 "비지 않음"만 계약으로 잠근다(6-b 픽셀 소관).
    expect(display.trim().length).toBeGreaterThan(0);
  });

  it('⑤ 응답 자체가 undefined 여도 BASIC 문장으로 비지 않는다(네트워크 실패 방어)', () => {
    const display = resolveDisplayNarrative(undefined);
    expect(display.trim().length).toBeGreaterThan(0);
  });
});
