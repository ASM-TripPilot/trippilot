import fc from 'fast-check';

import type { AccountExport } from '@/shared/api/index.schemas';
import { buildExportFile, resolveExportSummary } from './exportSummary';

/**
 * TRIP-608 AC-5 (INV-4) — 내보내기 잘림 고지 조립.
 *
 * 무엇을 보장하나: `GET /me/export` 응답의 `truncatedSections` 를 **조용히 삼키지 않는다**.
 * 비어 있으면(=전부 실림) 고지가 없고, 하나라도 있으면 그 목록을 그대로 이어 붙여 사용자에게
 * 보인다. INV-4(침묵 실패 금지)의 이 표면 구현이다 — 서버가 잘랐다고 말했는데 화면이 안 말하면
 * 사용자는 받은 파일이 전부인 줄 안다.
 *
 * 3동작 뼈대: 준비=export 응답 픽스처 → 실행=resolveExportSummary → 단언=라벨.
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
  it('잘린 항목이 없으면 고지 라벨은 null 이다', () => {
    // 준비: truncatedSections 빈 배열 = 전부 실림.
    const summary = resolveExportSummary(
      makeExport({ truncatedSections: [], sections: ['trips', 'saved'] })
    );

    // 단언(없어야 한다): 잘린 게 없으니 고지 라벨이 없다.
    expect(summary.truncatedLabel).toBeNull();
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

// TRIP-1422 — 내보내기를 글자 덩어리가 아니라 `.json` 파일로 넘긴다(처리방침 §5 "파일로").
// 이 describe 는 그 파일의 **이름과 내용**만 본다(순수 함수 — 실제 쓰기·공유는 SettingsPage.hookMock 이 본다).
describe('buildExportFile — 내보내기 파일의 이름과 내용', () => {
  /** 서버가 보낸 값을 JSON 으로 한 번 오가게 한 모양 — 파일이 "응답 그대로"인지 잴 기준이다. */
  const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

  const sectionArb = fc.record({
    section: fc.string(),
    items: fc.array(fc.dictionary(fc.string(), fc.jsonValue()), {
      maxLength: 3,
    }),
    truncated: fc.boolean(),
  });
  const exportArb: fc.Arbitrary<AccountExport> = fc.record({
    accountId: fc.string(),
    exportedAt: fc.oneof(
      fc
        .date({
          min: new Date('2000-01-01T00:00:00Z'),
          max: new Date('2099-12-31T23:59:59Z'),
          noInvalidDate: true,
        })
        .map((d) => d.toISOString()),
      // 날짜로 못 읽는 글자만 — V8 은 "12" 같은 짧은 숫자도 날짜로 읽어 내므로(실측) 그런 것은 걸러 낸다.
      fc.string().filter((text) => Number.isNaN(Date.parse(text)))
    ),
    sectionLimit: fc.integer({ min: 1, max: 2000 }),
    truncatedSections: fc.array(fc.string(), { maxLength: 4 }),
    sections: fc.array(sectionArb, { maxLength: 4 }),
  });

  it('성질(PBT): 파일 내용을 다시 읽으면 응답과 같다 — 필드를 빼거나 머리 줄을 붙이지 않는다', () => {
    // (개념) JSON.parse 가 성공해야 하므로 앞에 "TripPilot 내보내기 (…)" 같은 머리 줄이 붙으면 바로 red 다.
    //  잘린 섹션이 있는 응답은 examples 로 반드시 한 번 태운다(무작위 운에 맡기지 않는다).
    const truncatedExample = makeExport({
      truncatedSections: ['photos'],
      sections: ['trips', 'photos'],
    });
    fc.assert(
      fc.property(exportArb, (data) => {
        const file = buildExportFile(data);

        expect(JSON.parse(file.content)).toEqual(asJson(data));
      }),
      { numRuns: 200, examples: [[truncatedExample]] }
    );
  });

  it('내용은 2칸 들여쓰기 JSON 이다(파일 앱·메일에서 사람이 읽을 수 있게)', () => {
    const data = makeExport({ truncatedSections: [], sections: ['trips'] });

    const file = buildExportFile(data);

    expect(file.content).toBe(JSON.stringify(data, null, 2));
  });

  it('이름은 내보낸 순간의 서울 날짜를 넣은 trippilot-export-YYYY-MM-DD.json 이다', () => {
    const data = makeExport({ truncatedSections: [], sections: [] });

    const file = buildExportFile({
      ...data,
      exportedAt: '2026-08-30T00:00:00Z',
    });

    expect(file.name).toBe('trippilot-export-2026-08-30.json');
  });

  it.each([
    [
      '서울 자정 1초 전',
      '2026-08-30T14:59:59Z',
      'trippilot-export-2026-08-30.json',
    ],
    ['서울 자정', '2026-08-30T15:00:00Z', 'trippilot-export-2026-08-31.json'],
    [
      '서울에선 이미 새해',
      '2026-12-31T15:00:00.000Z',
      'trippilot-export-2027-01-01.json',
    ],
    [
      '+09:00 표기',
      '2026-08-30T23:30:00+09:00',
      'trippilot-export-2026-08-30.json',
    ],
  ])('경계 — %s(%s)면 이름은 %s', (_label, exportedAt, expected) => {
    const data = makeExport({ truncatedSections: [], sections: [] });

    const file = buildExportFile({ ...data, exportedAt });

    expect(file.name).toBe(expected);
  });

  it.each([[''], ['not-a-date'], ['2026-13-45T00:00:00Z']])(
    '내보낸 시각을 날짜로 못 읽으면(%j) 던지지 않고 trippilot-export.json 으로 짓는다',
    (exportedAt) => {
      const data = makeExport({ truncatedSections: [], sections: [] });

      const file = buildExportFile({ ...data, exportedAt });

      expect(file.name).toBe('trippilot-export.json');
    }
  );

  it('성질(PBT): 이름에는 콜론이 없고 늘 trippilot-export[-YYYY-MM-DD].json 꼴이다', () => {
    fc.assert(
      fc.property(exportArb, (data) => {
        const { name } = buildExportFile(data);

        expect(name).not.toContain(':');
        expect(name).toMatch(/^trippilot-export(-\d{4}-\d{2}-\d{2})?\.json$/);
      }),
      { numRuns: 200 }
    );
  });
});
