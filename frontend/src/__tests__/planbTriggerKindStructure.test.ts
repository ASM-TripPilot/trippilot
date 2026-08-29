/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

import { TRIGGER_LABELS } from '@/features/planb/model/triggerLabel';

/**
 * TRIP-561 · AC-5 · BR-U4-01 — triggerLabel **종류 집합 고정** 구조가드.
 *
 * 무엇을 보장하나:
 *  - 🔴 종류는 **정확히 4종**(WEATHER·CLOSURE·DELAY·MANUAL) — 5번째 kind 를 늘리지 않는다.
 *  - 🔴 소스 어디에도 `교통`·`체류 초과` 문자열 0건 — '교통'은 존재하지 않는 종류, '체류 초과'는
 *    DELAY 의 payload 변형이지 별도 kind 가 아니다(BR-U4-01).
 *  - 🔴 라벨 모듈은 RN 을 런타임 import 하지 않는다(node-safe, replanScope.ts 계열).
 *
 * 왜 런타임 import + 소스 스캔 이중인가(planbScopeStructure.test.ts ★6 동형): "정확히 4종"은
 * 실물 표(`TRIGGER_LABELS`)를 import 해 키를 재는 것이 강하다. "금칙어 0건"은 헬퍼·주석 어디에
 * 숨어도 잡으려면 소스 스캔이라야 한다.
 *
 * 전처리×탐지기 조합(G1): 소스를 stripComments 로 가공한 뒤 금칙어를 훑으므로, 가공이 탐지
 * 대상을 지우거나(주석 속) 살려두는지(코드 리터럴)·URL 슬래시(`://`)를 오인하지 않는지를 G1 에서
 * 실측한다(문제로그 [[2026-07-31 stripComments가 URL의 슬래시를 주석으로 오인]] 계열).
 */

const LABEL_SOURCE = path.resolve(
  'src',
  'features',
  'planb',
  'model',
  'triggerLabel.ts'
);

/** 주석을 걷어낸다. `:` 뒤 `//`(URL)은 주석으로 오인하지 않는다(리포 확립 룩비하인드). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('G1 · 전처리×탐지기 자가검사', () => {
  it('주석 속 교통은 걷히고, 코드 리터럴 교통은 살아남으며, URL 슬래시는 보존된다', () => {
    const sample = [
      '// 교통 트리거는 없다(BR-U4-01).',
      "const url = 'https://figma.com/design/x';",
      "const bad = '교통';",
    ].join('\n');

    const stripped = stripComments(sample);

    // 주석의 교통은 사라진다(수호 주석이 부정 단언을 red 로 만드는 것 방지).
    expect(stripped).not.toContain('트리거는 없다');
    // 코드 리터럴 교통은 남아 탐지된다(가짜 통과 방지).
    expect(stripped).toContain("const bad = '교통';");
    expect(stripped.includes('교통')).toBe(true);
    // URL 의 `://` 는 주석으로 오인되지 않아 그대로 보존된다.
    expect(stripped).toContain('https://figma.com/design/x');
  });
});

describe('🔴 G2 · 종류 정확히 4종 (런타임 · 긍정 앵커)', () => {
  it('TRIGGER_LABELS 키가 정확히 WEATHER·CLOSURE·DELAY·MANUAL 4종이다', () => {
    expect(Object.keys(TRIGGER_LABELS).sort()).toEqual(
      ['CLOSURE', 'DELAY', 'MANUAL', 'WEATHER'].sort()
    );
  });
});

describe('🔴 G3 · 금칙어 0건 (부정 짝 · BR-U4-01)', () => {
  it('triggerLabel.ts 소스(주석 제외)에 교통·체류 초과 문자열이 없고, 4 kind 리터럴은 실재한다', () => {
    const stripped = stripComments(fs.readFileSync(LABEL_SOURCE, 'utf8'));

    // 부정 — 발명 금칙어 0건.
    expect(stripped.includes('교통')).toBe(false);
    expect(stripped.includes('체류 초과')).toBe(false);

    // 긍정 앵커 — 4 kind 리터럴이 실제로 소스에 있다(빈/무관 파일 공허 통과 방지).
    for (const kind of ['WEATHER', 'CLOSURE', 'DELAY', 'MANUAL']) {
      expect(stripped).toContain(kind);
    }
  });
});

describe('🔴 G4 · node-safe (경계 · RN 미참조)', () => {
  it('triggerLabel.ts 소스에 react-native 계열 런타임 import 가 없다', () => {
    const stripped = stripComments(fs.readFileSync(LABEL_SOURCE, 'utf8'));
    // 순수 데이터 모듈이라 RN 을 런타임으로 안 문다(replanScope.ts 선례). 구조가드 node 환경에서
    // import 해도 안전해야 한다. `import type` 은 타입 전용이라 런타임 import 가 아니다.
    expect(stripped).not.toMatch(/import\s+[^;]*from\s+['"]react-native['"]/);
    expect(stripped).not.toMatch(/from\s+['"]react-native-svg['"]/);
  });
});
