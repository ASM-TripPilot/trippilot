import type { StyleAnalysisEnvelope } from '@/shared/api/generated/schemas';

import { buildStyleCardModel } from './styleCardModel';

/**
 * TRIP-606 · l03 스타일 요약 카드 — `buildStyleCardModel`: 서버 응답(Envelope)을 화면이 그대로 그릴
 * 값 묶음(판별 유니온 VM)으로 접는 순수 함수. (개념) 순수 함수 = 입력만으로 출력 결정, 조회·부수효과·시계 없음.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-M1(BR-U6-24) official=true → descriptors·3축 값·sampleTripCount·updatedAt 이 **응답 값 그대로**(재계산 0).
 *  - 🔴 AC-M2(INV-U5-09) official=false → kind:'insufficient'+current 만. preview.descriptors 있어도 VM 에 안 실림.
 *  - 🔴 AC-M3(BR-U6-24) traitGauges 임의 조합(0/5 경계) → VM 게이지 값 = 입력값(클라 재계산 금지).
 *
 * 왜 이렇게 테스트하나(02a ★1·★7):
 *  - Envelope 두 얼굴(official→analysis / false→preview, 하나만 참)을 kind 로 접어 화면 재판정을 없앤다.
 *    insufficient VM 은 타입상 descriptors 필드가 없어 화면이 preview 를 그릴 코드 경로가 구조적으로 부재.
 *  - avgDwellMinutes(INV-3 유일 예외)는 이 카드 비노출(Q2) — VM 에 안 담기는 것까지 잠근다.
 *
 * 커버하지 않는 것: 표시 문자열(메타줄·안내문)·dot 렌더는 화면 몫(StyleSummaryCard). 순수 함수는 값만 낸다.
 */

/** 정식 분석 envelope — 값을 손대지 않는지 보려고 실제 값을 다 채운다. */
function officialEnvelope(
  over: Partial<StyleAnalysisEnvelope> = {}
): StyleAnalysisEnvelope {
  return {
    official: true,
    progress: { current: 14, required: 10 },
    analysis: {
      descriptors: ['#바다', '#미식'],
      traitGauges: { easygoing: 4, foodAffinity: 4, activeness: 3 },
      categoryBreakdown: [],
      avgPlacesPerDay: 3.2,
      avgRadiusKm: 5.1,
      avgDwellMinutes: 72,
      sampleTripCount: 6,
      updatedAt: '2026-08-28T09:00:00Z',
    },
    preview: null,
    ...over,
  };
}

describe('🔴 AC-M1 · 정식 매핑(값 무변형, BR-U6-24)', () => {
  it('official envelope 는 descriptors·3축 값·sampleTripCount·updatedAt 을 응답 값 그대로 담는다', () => {
    // Arrange: 서버가 만든 정식 분석.
    const env = officialEnvelope();

    // Act: 뷰모델로 접는다.
    const vm = buildStyleCardModel(env);

    // Assert: 재계산 0 — 라벨만 입히고 값은 그대로.
    expect(vm.kind).toBe('official');
    if (vm.kind !== 'official') throw new Error('kind 가 official 이 아니다');
    expect(vm.gauges).toEqual([
      { label: '여유로움', value: 4 },
      { label: '미식 취향', value: 4 },
      { label: '활동성', value: 3 },
    ]);
    expect(vm.descriptors).toEqual(['#바다', '#미식']);
    expect(vm.sampleTripCount).toBe(6);
    // updatedAt 은 raw ISO 그대로(포맷은 화면 몫) — 잘라 넣거나 바꾸지 않는다.
    expect(vm.updatedAt).toBe('2026-08-28T09:00:00Z');
    // Q2 — avgDwellMinutes(INV-3 예외)는 이 카드 비노출: VM 에 담기지 않는다.
    expect(vm).not.toHaveProperty('avgDwellMinutes');
  });
});

describe('🔴 AC-M2 · 미달 매핑(preview 미유출, INV-U5-09)', () => {
  it('official=false 는 kind:insufficient+current 만 담고 preview.descriptors 를 싣지 않는다', () => {
    // Arrange: 임계 미만 — analysis 는 null, preview 에 온보딩 취향 미리보기가 왔다.
    const env: StyleAnalysisEnvelope = {
      official: false,
      progress: { current: 4, required: 10 },
      analysis: null,
      preview: { descriptors: ['#바다'] },
    };

    // Act
    const vm = buildStyleCardModel(env);

    // Assert: 미리보기를 정식처럼 실어 나르지 않는다(INV-U5-09).
    expect(vm.kind).toBe('insufficient');
    if (vm.kind !== 'insufficient')
      throw new Error('kind 가 insufficient 가 아니다');
    expect(vm.current).toBe(4);
    expect(vm).not.toHaveProperty('descriptors');
    expect(vm).not.toHaveProperty('gauges');
  });
});

describe('🔴 AC-M3 · 값 무변형(0~5 경계 전수, BR-U6-24)', () => {
  // traitGauges 값 도메인은 0~5 유한 정수라 전수(6값)가 랜덤 PBT 보다 완전(ponytail lite, 02a §5).
  it.each([0, 1, 2, 3, 4, 5])(
    '세 축이 모두 %i 이면 VM 게이지 세 값이 그대로 %i 이다',
    (v) => {
      const env = officialEnvelope({
        analysis: {
          descriptors: [],
          traitGauges: { easygoing: v, foodAffinity: v, activeness: v },
          categoryBreakdown: [],
          avgPlacesPerDay: 0,
          avgRadiusKm: 0,
          sampleTripCount: 0,
          updatedAt: '2026-08-28T09:00:00Z',
        },
      });

      const vm = buildStyleCardModel(env);
      if (vm.kind !== 'official') throw new Error('official 이어야 한다');
      expect(vm.gauges.map((g) => g.value)).toEqual([v, v, v]);
    }
  );

  it.each([
    [{ easygoing: 0, foodAffinity: 5, activeness: 3 }, [0, 5, 3]],
    [{ easygoing: 5, foodAffinity: 0, activeness: 2 }, [5, 0, 2]],
  ] as const)('혼합 값 %o 도 축 순서대로 그대로 담긴다', (gauges, expected) => {
    const env = officialEnvelope({
      analysis: {
        descriptors: [],
        traitGauges: gauges,
        categoryBreakdown: [],
        avgPlacesPerDay: 0,
        avgRadiusKm: 0,
        sampleTripCount: 0,
        updatedAt: '2026-08-28T09:00:00Z',
      },
    });

    const vm = buildStyleCardModel(env);
    if (vm.kind !== 'official') throw new Error('official 이어야 한다');
    expect(vm.gauges.map((g) => g.value)).toEqual([...expected]);
  });
});
