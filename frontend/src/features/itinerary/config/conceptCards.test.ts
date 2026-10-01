/**
 * @jest-environment node
 */
// TRIP-794 · D6 — 컨셉 카드 설명 문구는 config 단일 출처, 화면 하드코딩 금지.
//
// 무엇을 보장하나:
//  - G1: CONCEPT_DESCRIPTIONS 5키 = TRIP-1043 중립 문구(완전일치, QA #041 결정 1a).
//  - G2: 설명 문구에 INV-3 소요시간(분/시간/소요) 0 + 탐지기 자가검사.
//  - G3: ConceptPickerScreen.tsx 가 config 를 import(긍정) ∧ 설명 문자열을 인라인 리터럴로 0건(부정)
//        — "화면 하드코딩 금지"를 소스로 기계 강제(값이 화면에 직접 박히면 red).
//  - G4: 설명 문구가 개인화를 주장하지 않는다('취향'·'잘 맞아요' 0) — 받칠 데이터가 없다(INV-1 취지).
import fs from 'fs';
import path from 'path';

import { CONCEPT_DESCRIPTIONS } from './conceptCards';

const SCREEN = path.resolve(
  'src/features/itinerary/ui/ConceptPickerScreen.tsx'
);

// 주석을 걷는다(블록 먼저). 줄 주석 바로 앞이 ':' 이면 URL 슬래시라 주석으로 안 본다(리포 규약).
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

describe('🔴 G1 · 설명 문구 5종은 TRIP-1043 중립 문구와 완전일치', () => {
  it('meal·cafe·culture·outdoor·shopping 값이 결정 문구와 같다', () => {
    expect(CONCEPT_DESCRIPTIONS).toEqual({
      meal: '근처 식당',
      cafe: '쉬어 가기',
      culture: '전시·박물관',
      outdoor: '공원·산책로',
      shopping: '상점·시장',
    });
  });
});

describe('🔴 G2 · INV-3 — 설명 문구에 소요시간 0', () => {
  it('탐지기 자가검사 후 5개 값에 분/시간/소요 0', () => {
    // 자가검사 — 탐지기가 진짜로 소요시간을 잡는가.
    expect(DURATION_TEXT.test('30분')).toBe(true);
    expect(DURATION_TEXT.test('근처 로컬 맛집')).toBe(false);

    const offenders = Object.entries(CONCEPT_DESCRIPTIONS)
      .filter(([, value]) => DURATION_TEXT.test(value))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G3 · 화면 하드코딩 금지 — 설명은 config 에서만 온다', () => {
  it('ConceptPickerScreen 이 config 를 import(긍정) ∧ 설명 문자열 인라인 0(부정)', () => {
    const source = stripComments(fs.readFileSync(SCREEN, 'utf8'));

    // 긍정 짝 — 화면이 config/conceptCards 를 실제로 문다(빈 파일·미배선 공허 통과 방지).
    expect(source).toContain('config/conceptCards');

    // 부정 — 설명 5문구가 화면 소스에 리터럴로 박혀 있으면 안 된다(하드코딩 금지).
    const inlined = Object.values(CONCEPT_DESCRIPTIONS).filter((value) =>
      source.includes(value)
    );
    expect(inlined).toEqual([]);
  });
});

const PERSONALIZED_TEXT = /(취향|잘 맞아요)/;

describe('🔴 G4 · 설명 문구가 개인화를 주장하지 않는다 (INV-1 취지)', () => {
  it('탐지기 자가검사 후 5개 값에 취향·잘 맞아요 0', () => {
    // 자가검사 — 옛 문구는 잡고, 중립 문구는 안 잡는다.
    expect(PERSONALIZED_TEXT.test('미술 취향과 잘 맞아요')).toBe(true);
    expect(PERSONALIZED_TEXT.test('전시·박물관')).toBe(false);

    const offenders = Object.entries(CONCEPT_DESCRIPTIONS)
      .filter(([, value]) => PERSONALIZED_TEXT.test(value))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });
});
