import fc from 'fast-check';

import type { AccountExport } from '@/shared/api/generated/schemas';
import { resolveExportSummary } from './exportSummary';

/**
 * TRIP-608 AC-5 (INV-4) — 내보내기 잘림 고지 조립.
 *
 * 무엇을 보장하나: `GET /me/export` 응답의 `truncatedSections` 를 **조용히 삼키지 않는다**.
 * 비어 있으면(=전부 실림) 고지가 없고, 하나라도 있으면 그 목록을 그대로 이어 붙여 사용자에게
 * 보인다. INV-4(침묵 실패 금지)의 이 표면 구현이다 — 서버가 잘랐다고 말했는데 화면이 안 말하면
 * 사용자는 받은 파일이 전부인 줄 안다.
 *
 * 3동작 뼈대: 준비=export 응답 픽스처 → 실행=resolveExportSummary → 단언=라벨/개수.
 *
 * (개념) 이 함수는 **순수 함수**다 — 같은 입력이면 항상 같은 출력이고 네트워크·화면을 모른다.
 * 그래서 예시 몇 개가 아니라 임의 입력(PBT)으로 성질을 못 박을 수 있다.
 */

/** `AccountExport` 는 필수 5필드라 픽스처를 한 곳에서 채운다(items 는 자유 형태 — 빈 배열이면 충분). */
function makeExport(overrides: {
  truncatedSections: string[];
  sections: string[];
}): AccountExport {
  return {
    accountId: 'acc-1',
    exportedAt: '2026-08-30T00:00:00Z',
    sectionLimit: 500,
    truncatedSections: overrides.truncatedSections,
    sections: overrides.sections.map((section) => ({
      section,
      items: [],
      truncated: false,
    })),
  };
}

describe('TRIP-608 · resolveExportSummary (AC-5 · INV-4)', () => {
  it('잘린 항목이 없으면 고지 라벨은 null, 개수는 실린 섹션 수다', () => {
    // 준비: truncatedSections 빈 배열 = 전부 실림.
    const summary = resolveExportSummary(
      makeExport({ truncatedSections: [], sections: ['trips', 'saved'] })
    );

    // 단언(없어야 한다): 잘린 게 없으니 고지 라벨이 없다.
    expect(summary.truncatedLabel).toBeNull();
    // 단언: 섹션 개수는 실제 실린 섹션 수와 같다.
    expect(summary.sectionCount).toBe(2);
  });

  it('잘린 항목이 있으면 목록을 그대로 이어 붙인 고지를 낸다', () => {
    // 준비: 두 몫이 상한에 걸려 잘림.
    const summary = resolveExportSummary(
      makeExport({
        truncatedSections: ['trips', 'photos'],
        sections: ['trips', 'photos', 'reflections'],
      })
    );

    // 단언(완전일치): 고지 문구가 잘린 목록을 ', ' 로 이어 붙인 정확한 문자열이다.
    expect(summary.truncatedLabel).toBe('일부 항목이 잘렸어요: trips, photos');
    expect(summary.sectionCount).toBe(3);
  });

  it('성질(PBT): 빈 목록 ⟺ null, 비면 라벨이 모든 섹션명을 포함한다(조용히 안 삼킴)', () => {
    // (개념) property = "어떤 잘린 목록이 와도" 성립해야 하는 규칙. 예시 2개가 못 막는
    //  누락(예: 목록이 길면 앞 하나만 보여주기)을 임의 입력으로 잡는다.
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { maxLength: 8 }),
        (truncated) => {
          const summary = resolveExportSummary(
            makeExport({ truncatedSections: truncated, sections: [] })
          );

          if (truncated.length === 0) {
            expect(summary.truncatedLabel).toBeNull();
          } else {
            // 비어있지 않으면 라벨이 있어야 하고, 잘린 항목 전부가 그 안에 들어 있어야 한다.
            expect(summary.truncatedLabel).not.toBeNull();
            for (const item of truncated) {
              expect(summary.truncatedLabel).toContain(item);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
