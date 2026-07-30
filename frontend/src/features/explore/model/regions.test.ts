import fc from 'fast-check';

import { filterRegions, REGIONS } from './regions';

/**
 * TRIP-183 e00·d1b 지역 목록 — 프론트 상수(Q1)와 검색 필터(Q4).
 *
 * 왜 상수인가: `GET /regions` 계약이 없다(`frontend-components.md` §2가 `⚠️ 계약 미존재`로
 * 이미 표기). 콘텐츠도 스텁 제주 5곳이라 지금 엔드포인트를 만들어도 반환값이 하나뿐이다.
 * 실 벤더 어댑터가 붙을 때 이 상수를 서버 응답으로 교체한다.
 */
describe('REGIONS — Figma e00·d1b 실측 6개', () => {
  it('Figma가 그린 6개 지역을 순서까지 그대로 담는다', () => {
    // 준비·실행 없음(상수). 단언 — 순서가 화면 그리드 순서이므로 순서까지 잠근다.
    expect(REGIONS.map((r) => r.name)).toEqual([
      '부산',
      '경주',
      '서울',
      '제주',
      '강릉',
      '여수',
    ]);
  });

  it('코드는 testID에 쓰이므로 ASCII 소문자이고 서로 겹치지 않는다', () => {
    const codes = REGIONS.map((r) => r.code);

    // 한 객체로 묶어 실패 diff에서 둘을 한 번에 본다.
    expect({
      allAscii: codes.every((c) => /^[a-z]+$/.test(c)),
      unique: new Set(codes).size === codes.length,
    }).toEqual({ allAscii: true, unique: true });
  });

  it('이름은 서버 질의값을 겸한다 — GET /stays/search?region= 에 그대로 실린다', () => {
    // `region`은 자유 문자열 계약이고 스텁 콘텐츠가 '제주'로 매칭된다.
    expect(REGIONS.find((r) => r.code === 'jeju')?.name).toBe('제주');
  });
});

describe('filterRegions — 상수 목록 클라이언트 필터(서버 없이 성립)', () => {
  it('빈 문자열이면 전체를 그대로 돌려준다', () => {
    expect(filterRegions('')).toEqual(REGIONS);
  });

  it('공백만 있어도 전체다 — 트림 후 판정한다', () => {
    expect(filterRegions('   ')).toEqual(REGIONS);
  });

  it('부분 일치로 좁힌다', () => {
    expect(filterRegions('제').map((r) => r.code)).toEqual(['jeju']);
  });

  it('앞뒤 공백은 무시한다', () => {
    expect(filterRegions('  부산 ').map((r) => r.code)).toEqual(['busan']);
  });

  it('일치가 없으면 빈 배열 — 전체로 되돌아가지 않는다', () => {
    // "결과 없으면 전부 보여주기"는 흔한 실수고, 사용자에겐 필터가 고장난 것으로 보인다.
    expect(filterRegions('없는지역')).toEqual([]);
  });

  it('속성: 어떤 질의에도 결과는 REGIONS의 부분집합이고 순서를 보존한다', () => {
    fc.assert(
      fc.property(fc.string(), (query) => {
        const got = filterRegions(query);
        const codes = got.map((r) => r.code);
        const allCodes = REGIONS.map((r) => r.code);

        // 부분집합
        expect(codes.every((c) => allCodes.includes(c))).toBe(true);
        // 순서 보존 — 원본에서 걸러낸 순서와 같다
        expect(codes).toEqual(allCodes.filter((c) => codes.includes(c)));
      }),
      { numRuns: 300 }
    );
  });
});
