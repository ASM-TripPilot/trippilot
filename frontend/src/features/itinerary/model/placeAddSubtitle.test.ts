import fc from 'fast-check';

import { PoiCategory } from '@/shared/api/index.schemas';

import { placeAddSubtitle } from './placeAddSubtitle';
import type { PlaceAddSubtitleInput } from './placeAddSubtitle';

/**
 * TRIP-1433 — h13 모양 행(장소 추가·즉석 방문 피커) 부제. 같은 이름 장소를 서버가 준 지역·주소로 가른다.
 * 1줄 = [지역(있을 때만), #태그…, 카테고리] · 2줄 = 주소(있을 때만). null·undefined·빈 문자열·공백뿐은
 * 전부 "없음"이고, 없으면 지금 부제(#태그 · 카테고리) 그대로 — 값을 지어내지 않는다.
 */

const ADDRESS_A = '서울특별시 종로구 사직로 161';
const ADDRESS_B = '서울특별시 마포구 월드컵북로 400';

const base = (tags: string[], category: PlaceAddSubtitleInput['category']) => ({
  tags,
  category,
});

describe('placeAddSubtitle', () => {
  it.each<[string, PlaceAddSubtitleInput, string[], string | null]>([
    [
      '지역·주소 둘 다 있으면 지역이 맨 앞, 주소는 원문',
      { ...base(['고궁'], '명소'), region: '종로구', address: ADDRESS_A },
      ['종로구', '#고궁', '명소'],
      ADDRESS_A,
    ],
    [
      '둘 다 null 이면 지금 부제 그대로, 주소 없음',
      { ...base(['한식'], '맛집'), region: null, address: null },
      ['#한식', '맛집'],
      null,
    ],
    [
      '둘 다 키가 없으면(undefined) null 과 같다',
      base(['한식'], '맛집'),
      ['#한식', '맛집'],
      null,
    ],
    [
      '빈 문자열은 없음과 같다',
      { ...base(['한식'], '맛집'), region: '', address: '' },
      ['#한식', '맛집'],
      null,
    ],
    [
      '공백뿐(스페이스·탭)도 없음과 같다',
      { ...base(['한식'], '맛집'), region: '   ', address: '\t' },
      ['#한식', '맛집'],
      null,
    ],
    [
      '전각 공백뿐도 없음과 같다',
      { ...base(['한식'], '맛집'), region: '　', address: ' 　 ' },
      ['#한식', '맛집'],
      null,
    ],
    [
      '지역만 있으면 1줄에만 붙고 주소는 없다',
      { ...base(['한식'], '맛집'), region: '중구', address: null },
      ['중구', '#한식', '맛집'],
      null,
    ],
    [
      '주소만 있으면 1줄은 그대로, 주소만 생긴다',
      { ...base(['한식'], '맛집'), region: null, address: ADDRESS_B },
      ['#한식', '맛집'],
      ADDRESS_B,
    ],
    [
      '태그가 없으면 지역 · 카테고리',
      { ...base([], '명소'), region: '종로구', address: null },
      ['종로구', '명소'],
      null,
    ],
    [
      '태그가 여럿이면 지역 뒤에 태그를 순서대로',
      { ...base(['한식', '노포'], '맛집'), region: '종로구', address: null },
      ['종로구', '#한식', '#노포', '맛집'],
      null,
    ],
  ])('%s', (_label, input, parts, address) => {
    // 준비 = 표의 입력 · 실행 = 함수 호출 · 단언 = 두 줄의 조각
    expect(placeAddSubtitle(input)).toEqual({ parts, address });
  });

  describe('속성', () => {
    // 없음 7종 — null·undefined·빈 문자열·공백뿐(스페이스·탭·줄바꿈·전각 공백).
    const missing = fc.constantFrom<string | null | undefined>(
      null,
      undefined,
      '',
      ' ',
      '   ',
      '\t\n',
      '　'
    );
    // 있음 — 앞뒤 공백 없는 글자(앞뒤 공백 붙은 값을 다듬을지는 계약이 정하지 않는다).
    const present = fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((s) => s.trim() === s && s !== '');
    const maybe = fc.oneof(missing, present);
    const tags = fc.array(
      fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim() !== ''),
      { maxLength: 3 }
    );
    const category = fc.constantFrom(...Object.values(PoiCategory));
    const isPresent = (v: string | null | undefined): v is string =>
      typeof v === 'string' && v.trim() !== '';

    it('지금 부제 조각은 그대로 뒤에 남고, 지역은 있을 때만 맨 앞에 한 칸 붙는다', () => {
      fc.assert(
        fc.property(maybe, maybe, tags, category, (region, address, t, c) => {
          const current = [...t.map((tag) => `#${tag}`), c];

          const out = placeAddSubtitle({
            tags: t,
            category: c,
            region,
            address,
          });

          expect(out.parts.slice(-current.length)).toEqual(current);
          expect(out.parts).toEqual(
            isPresent(region) ? [region, ...current] : current
          );
          expect(out.parts.every((part) => part.trim() !== '')).toBe(true);
        })
      );
    });

    it('주소는 있으면 원문 그대로, 없으면 null', () => {
      fc.assert(
        fc.property(maybe, maybe, tags, category, (region, address, t, c) => {
          const out = placeAddSubtitle({
            tags: t,
            category: c,
            region,
            address,
          });

          expect(out.address).toBe(isPresent(address) ? address : null);
        })
      );
    });
  });
});
