/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-562 · AC-3 가드 사정거리 갭 방어 — 화면이 **아이콘을 triggerLabel(kind).iconKey 경유**로
 * 고르는지 소스로 잠근다(오케 교정: 실효 링크를 이름→아이콘 경로로 옮김).
 *
 * 왜 필요한가: 종류 집합 4종 잠금(`planbTriggerKindStructure.test.ts`, 선재 green)은
 * `triggerLabel.ts` **만** 스캔하고 새 `TriggerWatchlistScreen.tsx` 는 안 본다. 감시 행 **이름**은
 * 이제 Figma 카테고리 상수(날씨·이동 지연·영업·휴무)라 그 축이 아니지만, **아이콘**은 kind→iconKey
 * 매핑을 triggerLabel 이 소유하므로(BR-U4-01 종류 완전성과 이어짐) 화면이 kind→아이콘을 하드코딩하면
 * 그 소유가 무력해진다. 이 스캔이 아이콘 경로를 새 화면까지 넓힌다.
 *
 * 무엇을 보장하나:
 *  - 🔴 화면 소스가 `triggerLabel` 을 참조한다(아이콘의 kind→iconKey 출처, 긍정 앵커).
 *  - 🔴 화면 소스(주석 제외)에 활성 트리거 제목 리터럴·발명 kind 문자열 0건. **카테고리명(날씨·
 *    이동 지연·영업·휴무)은 정당한 화면/모델 상수라 금칙 아님** — '이동 지연'은 카테고리명이자
 *    triggerLabel DELAY 값이라 겹쳐 금칙에서 제외한다.
 *
 * 조합(전처리×탐지기) 실검증: `stripComments` 로 가공한 뒤 리터럴을 훑으므로, 가공이 주석 금칙어를
 * 지우고·코드 리터럴은 살리고·URL `://` 를 주석으로 오인하지 않는지를 G1 자가검사로 1회 확인한다
 * (문제로그 [[2026-07-31 stripComments가 URL의 슬래시를 주석으로 오인]] 계열).
 */

const SCREEN = path.resolve(
  'src',
  'features',
  'planb',
  'ui',
  'TriggerWatchlistScreen.tsx'
);

/** 주석을 걷어낸다. `:` 뒤 `//`(URL)은 주석으로 오인하지 않는다(리포 확립 룩비하인드). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('G1 · 전처리×탐지기 자가검사', () => {
  it('주석 속 금칙어는 걷히고, 코드 리터럴은 살아남으며, URL 슬래시는 보존된다', () => {
    const sample = [
      '// 교통 트리거는 없다(BR-U4-01, 주석).',
      "const url = 'https://figma.com/design/x';",
      "const bad = '교통';",
    ].join('\n');

    const stripped = stripComments(sample);

    // 주석 속 금칙어는 사라진다(수호 주석이 부정 단언을 red 로 만드는 것 방지).
    expect(stripped).not.toContain('트리거는 없다');
    // 코드 리터럴 금칙어는 남아 탐지된다(가짜 통과 방지).
    expect(stripped).toContain("const bad = '교통';");
    expect(stripped.includes('교통')).toBe(true);
    // URL 의 `://` 는 주석으로 오인되지 않아 보존된다.
    expect(stripped).toContain('https://figma.com/design/x');
  });
});

describe('🔴 G2 · 화면이 triggerLabel 경유(아이콘 iconKey · 긍정 앵커)', () => {
  it('TriggerWatchlistScreen.tsx 소스가 triggerLabel 을 참조한다', () => {
    const stripped = stripComments(fs.readFileSync(SCREEN, 'utf8'));
    expect(stripped).toContain('triggerLabel');
  });
});

describe('🔴 G3 · 하드코딩 금칙(부정 짝 · BR-U4-01)', () => {
  it('화면 소스에 활성 트리거 제목 리터럴·발명 kind 문자열이 없다(카테고리명은 허용)', () => {
    const stripped = stripComments(fs.readFileSync(SCREEN, 'utf8'));

    // 활성 트리거 제목(triggerLabel 값)은 화면이 하드코딩하지 않는다 — 서버 reason·사영이 준다.
    // '이동 지연' 은 카테고리명이자 DELAY 값이라 겹쳐 제외(카테고리 상수로 정당).
    for (const label of ['비 예보', '휴무 확인', '변경 요청']) {
      expect(stripped).not.toContain(label);
    }
    // BR-U4-01 발명 kind — '교통'·'체류 초과' 0건.
    expect(stripped).not.toContain('교통');
    expect(stripped).not.toContain('체류 초과');
  });
});
