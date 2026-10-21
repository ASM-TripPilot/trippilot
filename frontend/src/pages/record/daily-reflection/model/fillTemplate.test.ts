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

  it('채울 수 없는 자리표시자({poi:1.name})가 낀 문장은 통째로 뺀다 — "오늘 다녀왔어요" 같은 깨진 문장을 만들지 않는다 (TRIP-1497)', () => {
    expect(fillTemplate('오늘 {poi:1.name} 다녀왔어요', ctx)).toBe('');
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

// TRIP-1497 · 통계 자리표시자 — 값이 있으면 채우고, 없으면 그 문장을 뺀다(깨진 문장 금지, BR-U5-31: 쓰는 값은 기록된 stats 에서만).
describe('fillTemplate · 통계 자리표시자 (TRIP-1497)', () => {
  const stats = { visitCount: 3, distanceKm: 4.2, photoCount: 2 };

  it('F1 방문 수·거리·사진 수를 stats 값으로 채운다', () => {
    expect(
      fillTemplate(
        '{visit_count}곳 · {distance_km}km · 사진 {photo_count}장',
        stats
      )
    ).toBe('3곳 · 4.2km · 사진 2장');
  });

  it('F2 거리 값이 없으면 그 문장만 빠지고 나머지 문장은 남는다', () => {
    expect(
      fillTemplate(
        '광안리에서 시작했어요. 오늘 {distance_km}km 걸었어요. 좋았어요.',
        {
          visitCount: 3,
        }
      )
    ).toBe('광안리에서 시작했어요. 좋았어요.');
  });

  it('F3 문장 하나뿐인데 채울 값이 없으면 빈 문자열이다(화면이 stats 문장으로 폴백)', () => {
    expect(fillTemplate('{visit_count}곳을 다녀왔어요', {})).toBe('');
  });

  it('F4 region·날짜는 종전대로 — 값이 없어도 문장을 빼지 않고 자리표시자만 걷는다', () => {
    expect(fillTemplate('{region}에서 보낸 하루', {})).toBe('에서 보낸 하루');
  });

  it('F6 소수점·시각의 점에서 문장을 자르지 않는다 — 자리표시자가 앞 조각에만 있어도 뒤 조각이 남지 않는다', () => {
    expect(
      fillTemplate('오늘은 약 {distance_km}km, 하루 평균 3.5km 걸었어요.', {})
    ).toBe('');
    expect(fillTemplate('오전 9.30에 {poi:1.name} 도착, 즐거웠어요.', {})).toBe(
      ''
    );
  });

  it('F7 가운뎃점으로 이은 캡션은 못 채우는 조각만 빠진다 — 알려진 값은 남는다', () => {
    expect(
      fillTemplate('{visit_count}곳 · {distance_km}km · 사진 {photo_count}장', {
        visitCount: 3,
        photoCount: 2,
      })
    ).toBe('3곳 · 사진 2장');
  });

  it('F8 거리는 소수 첫째 자리로 반올림한다', () => {
    expect(
      fillTemplate('{distance_km}km 걸었어요', { distanceKm: 4.2345 })
    ).toBe('4.2km 걸었어요');
  });

  it('F9 {constructor} 같은 객체 기본 키도 모르는 자리표시자다 — 함수 문자열이 본문에 찍히지 않는다', () => {
    expect(fillTemplate('좋았어요. {constructor} 최고', {})).toBe('좋았어요.');
  });

  it('F5 어떤 자리표시자·값이든 결과에 중괄호가 남지 않는다 (PBT)', () => {
    const key = fc.constantFrom(
      'region',
      'start_date',
      'end_date',
      'visit_count',
      'distance_km',
      'photo_count',
      'poi:1.name',
      'x'
    );
    const word = fc.constantFrom(
      '바다',
      '오늘',
      '곳을',
      '걸었어요.',
      '좋았다.'
    );
    fc.assert(
      fc.property(
        fc.array(fc.tuple(word, key), { minLength: 1, maxLength: 4 }),
        fc.option(fc.integer({ min: 0, max: 99 }), { nil: undefined }),
        (parts, n) => {
          const text = parts.map(([w, k]) => `${w} {${k}}`).join(' ');
          const out = fillTemplate(text, { visitCount: n, photoCount: n });
          expect(out).not.toMatch(/[{}]/);
        }
      )
    );
  });
});
