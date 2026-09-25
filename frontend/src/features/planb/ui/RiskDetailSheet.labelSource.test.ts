/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

import { TRIGGER_LABELS } from '@/features/planb/model/triggerLabel';

/**
 * TRIP-562 → TRIP-749 · 트리거 제목 하드코딩 금지 가드 — 대상을 옛 i09 감시 목록 화면에서
 * i03 위험 상세 시트(`RiskDetailSheet.tsx`)로 **재조준**했다(감시 목록 화면은 이 티켓에서 삭제).
 *
 * 왜 필요한가: 시트 제목은 서버 `reason`("17시 이후 비 예보 70%")이 준다. 화면이 트리거 라벨
 * ("비 예보"·"휴무"…)을 제목 자리에 하드코딩하면 서버 문구가 조용히 가려진다. 렌더 테스트는 "주입한
 * 제목이 보인다"까지만 잴 수 있고, "소스에 다른 제목 후보가 숨어 있지 않다"는 소스 층만 본다.
 *
 * 무엇을 보장하나:
 *  - 🔴 시트 소스(주석 제외)에 트리거 라벨 4종(`TRIGGER_LABELS` 에서 도출) 리터럴 0건, BR-U4-01
 *    발명 kind('교통'·'체류 초과') 0건.
 *  - 옛 G2(아이콘을 triggerLabel.iconKey 경유로 고른다)는 폐지 — 시트엔 kind 별 아이콘이 없다(Q6).
 *  - 옛 G3 의 "DELAY 제외"·"'영업·휴무' 가림"도 걷었다 — 감시 카테고리명이 Figma 대로 '이동'·'영업'
 *    으로 바뀌어 라벨('이동 지연'·'휴무')과 더는 겹치지 않는다(02a ★10).
 *
 * 조합(전처리×탐지기) 실검증: `stripComments` 로 가공한 뒤 리터럴을 훑으므로, 가공이 주석 금칙어를
 * 지우고·코드 리터럴은 살리고·URL `://` 를 주석으로 오인하지 않는지를 G1 자가검사로 1회 확인한다
 * (문제로그 [[2026-07-31 stripComments가 URL의 슬래시를 주석으로 오인]] 계열).
 */

const SHEET = path.resolve(
  'src',
  'features',
  'planb',
  'ui',
  'RiskDetailSheet.tsx'
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

describe('🔴 G3 · 하드코딩 금칙(부정 짝 · BR-U4-01)', () => {
  it('RiskDetailSheet 소스에 트리거 라벨 4종·발명 kind 문자열이 없다(제목은 서버 reason 이 준다)', () => {
    const stripped = stripComments(fs.readFileSync(SHEET, 'utf8'));

    // 금칙 = 현재 라벨표 전체에서 도출(리터럴 목록을 적어 두면 개명 때 공허해진다 — 748 ★9).
    const labels = (
      Object.keys(TRIGGER_LABELS) as (keyof typeof TRIGGER_LABELS)[]
    ).map((kind) => TRIGGER_LABELS[kind].label);
    // 짝 앵커 — 도출한 금칙이 비지 않았다(4종).
    expect(labels).toHaveLength(4);
    for (const label of labels) {
      expect(stripped).not.toContain(label);
    }
    // BR-U4-01 발명 kind — '교통'·'체류 초과' 0건.
    expect(stripped).not.toContain('교통');
    expect(stripped).not.toContain('체류 초과');
  });
});
