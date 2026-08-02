import {
  CompanionType,
  type CreateTripRequest,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-203 AC-3 · AC-4 — 여행 생성 계약을 **타입으로** 잠근다.
 *
 * 무엇을 보장하나: 잘못된 여행 생성 요청이 **화면을 짜는 도중 컴파일 단계에서** 막힌다.
 *  - 여행지·날짜 범위는 빠질 수 없다(US-TRIP-01 · BR-U1-34, AC-3)
 *  - 동반 유형에 온보딩 값 `커플`을 넣을 수 없다(BR-U1-39, AC-4)
 *
 * ⚠️ **이 파일의 심판은 jest가 아니라 `pnpm run tsc` 다.** 아래 `@ts-expect-error` 는 "바로
 * 다음 줄에서 타입 오류가 나야 한다"는 선언이고, 오류가 **안 나면** 컴파일러가 스스로
 * `TS2578 Unused '@ts-expect-error' directive` 로 실패한다(02a §6-① 양방향 실측). jest는 이
 * 파일을 런타임으로도 돌리지만, 런타임에서 실제로 무언가를 재는 것은 마지막 enum 단언뿐이다.
 *
 * 왜 타입만으로는 부족한가: 생성물은 리포에 커밋돼 있어서 openapi가 조용히 뒤집혀도 재생성
 * 전까지 이 파일은 아무 말도 하지 않는다. 그래서 계약 **입력**은 `src/__tests__/
 * openapiContract.test.ts`(A-3)가, 도구가 뱉은 **출력 문자열**은 `src/__tests__/
 * staySearchGenerated.test.ts`(B-7·B-8)가 따로 본다 — 층이 셋인 이유다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** 잠그는 것이 서버 계약(필수 필드·enum 값)이라, 여행 도메인 코드가
 * 늘어도 이 단언들은 red를 내지 않는다. 갱신이 필요한 순간은 openapi가 그 계약을 바꾸는
 * 때뿐이고, 그때는 위 두 파일도 함께 손대야 한다.
 */

/** 필수 3필드를 모두 채운 최소 요청 — 아래 결손 사례들의 대조군이다. */
const COMPLETE: CreateTripRequest = {
  startDate: '2026-09-01',
  endDate: '2026-09-03',
  destinations: [{ seq: 1, region: '제주', nights: 2 }],
};

describe('AC-3 · 필수 3필드가 타입으로 잠긴다 (심판 = pnpm run tsc)', () => {
  it('startDate·endDate·destinations 중 하나라도 빠지면 컴파일되지 않는다', () => {
    // @ts-expect-error startDate 누락 — US-TRIP-01 "날짜 범위 필수"
    const missingStartDate: CreateTripRequest = {
      endDate: '2026-09-03',
      destinations: [{ seq: 1, region: '제주', nights: 2 }],
    };

    // @ts-expect-error endDate 누락 — US-TRIP-01 "날짜 범위 필수"
    const missingEndDate: CreateTripRequest = {
      startDate: '2026-09-01',
      destinations: [{ seq: 1, region: '제주', nights: 2 }],
    };

    // @ts-expect-error destinations 누락 — US-TRIP-01 "여행지 필수" · BR-U1-34
    const missingDestinations: CreateTripRequest = {
      startDate: '2026-09-01',
      endDate: '2026-09-03',
    };

    // 런타임에서는 값을 참조만 한다(미사용 변수 린트 회피). 진짜 단언은 위 세 directive이고,
    // 그것들이 소비되지 않으면 tsc가 TS2578로 빨개진다.
    expect([
      missingStartDate,
      missingEndDate,
      missingDestinations,
      COMPLETE,
    ]).toHaveLength(4);
  });

  it('필수 3필드만 채운 요청은 그대로 컴파일된다 (대조군 — 선택 필드는 선택으로 남는다)', () => {
    // directive 없이 컴파일된다는 것 자체가 단언이다. 여기에 오류가 나면 계약이 과도하게
    // 좁혀진 것(예: budgetTotal·title이 required로 바뀜)이고, tsc가 그 자리에서 실패한다.
    expect(COMPLETE.destinations).toHaveLength(1);
  });
});

describe('AC-4 · 동반 유형 enum에 커플이 없다 (BR-U1-39)', () => {
  it('CompanionType 자리에 커플을 넣으면 컴파일되지 않는다 (심판 = pnpm run tsc)', () => {
    // 온보딩 취향 축(PreferenceInput.companionTypes)은 [혼자, 커플, 친구, 가족, 부모님]이고
    // 여행 축(CompanionType)은 [혼자, 친구, 연인, 가족]이다 — **두 목록이 다르다.** 온보딩
    // 값을 여행 생성에 그대로 흘려보내는 배선이 생기면 여기서 막힌다.
    // (커플 → 연인 매핑 함수 자체는 이 칸의 산출물이 아니다 — TRIP-204.)
    // @ts-expect-error 서버 여행 enum에 커플은 없다
    const fromOnboarding: CompanionType = '커플';

    // 대조군 — 매핑 뒤의 값은 통과한다.
    const mapped: CompanionType = '연인';

    expect([fromOnboarding, mapped]).toHaveLength(2);
  });

  it('생성된 CompanionType 객체가 혼자·친구·연인·가족 4값만 갖는다 (런타임 짝)', () => {
    // 완전 일치로 잠근다 — 문자열 키는 삽입 순서를 보존하므로 생성물의 리터럴 순서가 곧
    // 이 배열이다. 부분집합으로 두면 커플이 끼어들어도 통과한다.
    expect(Object.keys(CompanionType)).toEqual([
      '혼자',
      '친구',
      '연인',
      '가족',
    ]);

    // 부정 짝 — 위 단언과 같은 it 안에 둔다(객체가 통째로 비면 부정만으로는 공허하다).
    expect('커플' in CompanionType).toBe(false);
  });
});
