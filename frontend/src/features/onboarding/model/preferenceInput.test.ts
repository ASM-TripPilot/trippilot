import { toPreferenceInput } from './preferenceInput';

/**
 * TRIP-471 — 온보딩 취향 slug → 서버 PreferenceInput 번역기.
 *
 * 무엇을 보장하나: 화면 slug('low'·'relaxed'…)가 서버 도메인 값('저가'·'느긋하게'…)으로
 * 정확히 번역되고, 동행 'pet' 특례(petFlag)와 미선택 축(null)이 옳게 처리된다. 이 매핑이
 * 틀리면 서버가 422(enum 위반)를 내거나 사용자가 고른 취향이 조용히 뒤바뀐다.
 */

const EMPTY = {
  styles: null,
  pace: null,
  budget: null,
  companions: null,
  foods: null,
  transports: null,
  activities: null,
};

describe('toPreferenceInput — 축별 slug→서버값 번역(TRIP-471)', () => {
  it('7축 대표 slug 가 서버 한국어 enum 값으로 번역된다', () => {
    const result = toPreferenceInput({
      styles: ['rest', 'art', 'shopping'],
      pace: 'relaxed',
      budget: 'luxury',
      companions: ['solo', 'family'],
      foods: ['korean', 'asian'],
      transports: ['walk', 'transit'],
      activities: ['nature', 'nightview'],
    });

    expect(result.styles).toEqual(['휴양', '문화예술', '쇼핑']);
    expect(result.pace).toBe('느긋하게');
    expect(result.budgetTier).toBe('럭셔리');
    expect(result.companionTypes).toEqual(['혼자', '가족']);
    expect(result.foodTastes).toEqual(['한식', '아시안']);
    expect(result.transportModes).toEqual(['도보', '대중교통']);
    expect(result.activities).toEqual(['자연', '야경']);
  });

  it("동행 'pet' 은 companionTypes 가 아니라 petFlag=true 로 간다(서버 enum 에 없음)", () => {
    const result = toPreferenceInput({
      ...EMPTY,
      companions: ['couple', 'pet'],
    });
    expect(result.companionTypes).toEqual(['커플']); // pet 제외
    expect(result.petFlag).toBe(true);
  });

  it('동행에 pet 이 없으면 petFlag=false', () => {
    const result = toPreferenceInput({ ...EMPTY, companions: ['solo'] });
    expect(result.petFlag).toBe(false);
  });

  it('미선택 축은 null 로 남는다(서버: 미설정으로 초기화)', () => {
    const result = toPreferenceInput(EMPTY);
    expect(result.styles).toBeNull();
    expect(result.pace).toBeNull();
    expect(result.budgetTier).toBeNull();
    expect(result.companionTypes).toBeNull();
    expect(result.petFlag).toBe(false); // 동행 축 미선택이면 반려동물도 아님
    expect(result.budgetRawAmount).toBeNull();
  });

  it('알 수 없는 slug 는 조용히 버린다(가비지 전송 방지)', () => {
    const result = toPreferenceInput({ ...EMPTY, styles: ['rest', 'bogus'] });
    expect(result.styles).toEqual(['휴양']);
  });
});
