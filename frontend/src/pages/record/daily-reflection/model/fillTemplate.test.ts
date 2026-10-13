import { fillTemplate, isGuideText, GUIDE_TEXTS } from './fillTemplate';

/** TRIP-1212 · 서버·AI 가 미치환으로 내려준 `{region}` 류 템플릿 글자를 사용자에게 보이지 않게 한다. */
describe('fillTemplate', () => {
  const ctx = {
    region: '부산',
    startDate: '2026-10-01',
    endDate: '2026-10-03',
  };

  it('알려진 자리표시자를 값으로 치환한다', () => {
    expect(fillTemplate('{region} · {start_date}~{end_date}', ctx)).toBe(
      '부산 · 2026-10-01~2026-10-03'
    );
  });

  it('값이 없으면 자리표시자를 지우고 남은 구분자를 정리한다(중괄호 0)', () => {
    const out = fillTemplate('{region} · {start_date}~{end_date}', {});
    expect(out).not.toMatch(/[{}]/);
    expect(out).toBe('');
  });

  it('일부만 없으면 있는 값만 남긴다', () => {
    const out = fillTemplate('{region} · {start_date}~{end_date}', {
      region: '부산',
    });
    expect(out).not.toMatch(/[{}]/);
    expect(out).toBe('부산');
  });

  it('모르는 자리표시자({poi:1.name})도 지운다', () => {
    expect(fillTemplate('오늘 {poi:1.name} 다녀왔어요', ctx)).toBe(
      '오늘 다녀왔어요'
    );
  });

  it('템플릿이 없으면 문장을 그대로 둔다', () => {
    expect(fillTemplate('광안리를 다녀왔어요.', ctx)).toBe(
      '광안리를 다녀왔어요.'
    );
  });
});

describe('isGuideText', () => {
  it('서버 기본 안내문은 안내문이다(공백 차이 무시)', () => {
    for (const g of GUIDE_TEXTS) {
      expect(isGuideText(`  ${g}\n`)).toBe(true);
    }
  });
  it('사용자 글은 아니다', () => {
    expect(isGuideText('오늘 좋았다')).toBe(false);
  });
});
