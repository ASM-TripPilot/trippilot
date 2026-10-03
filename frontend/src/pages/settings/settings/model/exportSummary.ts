import type { AccountExport } from '@/shared/api/generated/schemas';

/**
 * 내보내기 잘림 고지 조립 (AC-5 · INV-4) — 순수 함수.
 *
 * `truncatedSections` 가 비어 있으면(=전부 실림) 고지가 없다(`null`). 하나라도 있으면 그 목록을
 * 그대로 이어 붙여 사용자에게 보인다 — 서버가 "잘랐다"고 말했는데 화면이 안 말하면 사용자는 받은
 * 파일이 전부인 줄 안다(침묵 실패 금지, INV-4).
 */
export interface ExportSummary {
  truncatedLabel: string | null;
  sectionCount: number;
}

export function resolveExportSummary(exportData: AccountExport): ExportSummary {
  const truncated = exportData.truncatedSections;
  return {
    truncatedLabel:
      truncated.length === 0
        ? null
        : `일부 항목이 잘렸어요: ${truncated.join(', ')}`,
    sectionCount: exportData.sections.length,
  };
}
