import fc from 'fast-check';

import {
  fillTemplate,
  isGuideText,
  isTemplateOnly,
  GUIDE_TEXTS,
} from './fillTemplate';

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

// TRIP-1425 · Q-111 — 템플릿뿐인 문장은 회고가 아니다(페이지가 stats 문장으로 바꾼다).
describe('isTemplateOnly — 자리표시자·구분자·공백뿐인가', () => {
  it.each<[string, boolean]>([
    ['{region} · {start_date}~{end_date}', true],
    ['{region}', true],
    ['  {start_date} ~ {end_date}  ', true],
    ['{poi:1.name} · {visit_count}', true],
    ['{region}에서 보낸 {start_date}', false],
    ['{start_date}~{end_date}의 바다', false],
    ['광안리를 다녀왔어요.', false],
    ['{region} · 1', false],
    [GUIDE_TEXTS[0], false],
  ])('%j → %s', (text, expected) => {
    expect(isTemplateOnly(text)).toBe(expected);
  });

  // 자리표시자 키엔 중괄호를, 낱말엔 공백·구분자를 넣지 않는다(02a ★17).
  const placeholder = fc
    .string({
      unit: fc.constantFrom('a', '_', ':', '.', '1', '지'),
      minLength: 1,
    })
    .map((key) => `{${key}}`);
  const separator = fc.constantFrom(' ', '·', '~', ' · ');
  const templateTokens = fc.array(fc.oneof(placeholder, separator), {
    maxLength: 6,
  });
  const word = fc.string({
    unit: fc.constantFrom('바', '다', '곳', 'A', '1', '.'),
    minLength: 1,
  });

  it('자리표시자가 하나 이상이고 나머지가 구분자·공백뿐이면 늘 참이다 (PBT)', () => {
    fc.assert(
      fc.property(
        templateTokens,
        placeholder,
        templateTokens,
        (before, one, after) => {
          expect(isTemplateOnly([...before, one, ...after].join(''))).toBe(
            true
          );
        }
      )
    );
  });

  it('구분자가 아닌 글자가 하나라도 끼면 늘 거짓이다 (PBT)', () => {
    fc.assert(
      fc.property(templateTokens, word, templateTokens, (before, w, after) => {
        expect(isTemplateOnly([...before, w, ...after].join(''))).toBe(false);
      })
    );
  });
});

// TRIP-1425 · 하루 회고는 시작=끝=그날이라 `{start_date}~{end_date}` 가 `X~X` 로 보이면 안 된다.
describe('fillTemplate — 시작과 끝이 같은 날이면 한 번만', () => {
  const SAME = { startDate: '2026-10-02', endDate: '2026-10-02' };

  it('템플릿 전체: 지역 · 날짜 하나', () => {
    expect(
      fillTemplate('{region} · {start_date}~{end_date}', {
        region: '부산',
        ...SAME,
      })
    ).toBe('부산 · 2026-10-02');
  });

  it('다른 글과 섞여도 날짜는 하나다', () => {
    expect(fillTemplate('{start_date}~{end_date}의 바다', SAME)).toBe(
      '2026-10-02의 바다'
    );
  });

  it('어떤 날짜·앞뒤 말이든 그날 날짜는 정확히 한 번 나온다 (PBT)', () => {
    const isoDay = fc
      .date({
        min: new Date('2000-01-01T00:00:00Z'),
        max: new Date('2099-12-31T00:00:00Z'),
        noInvalidDate: true,
      })
      .map((d) => d.toISOString().slice(0, 10));
    // 앞뒤 말엔 숫자·`-`·`~` 를 넣지 않는다 — 날짜 개수 세기가 흔들린다(02a ★17).
    const words = fc.string({
      unit: fc.constantFrom('바', '다', '에', '서', '의', ' '),
    });
    fc.assert(
      fc.property(isoDay, words, words, (day, before, after) => {
        const out = fillTemplate(`${before}{start_date}~{end_date}${after}`, {
          startDate: day,
          endDate: day,
        });
        expect(out.split(day).length - 1).toBe(1);
        expect(out).not.toContain(`${day}~${day}`);
      })
    );
  });
});
