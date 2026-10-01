/**
 * @jest-environment node
 */
import fc from 'fast-check';

import { sigunguLabel } from './regionMatch';

/**
 * TRIP-1074 — g02 숙소 선택 시트 카드의 동네 라벨을 reverse-geocode 주소에서 뽑는다(결정 2(a) 시군구 토큰).
 *
 * 무엇을 보장하나:
 *  - 둘째 토막이 `시·군·구`로 끝나면 그것이 라벨이다. 첫 토막(시도)은 보지 않는다 — 정식 명칭(`서울특별시`)과
 *    약칭(`서울`)을 함께 통과시키고, 시도 이름 표를 두지 않는다(TRIP-445).
 *  - 구가 있는 일반시는 둘째+셋째 토막을 잇는다(`수원시 영통구`, 01b Q1-A).
 *  - 시군구가 없는 주소(세종·시도 없는 주소·빈 값)는 `null` — 대체 문구를 만들지 않는다(01b Q2 · INV-1).
 *
 * 커버하지 않는 것: 카카오가 실제로 어떤 모양의 주소를 주는지(세종 지번·통합특별시 명칭) — 실스택 6-b 몫.
 */

describe('TRIP-1074 · sigunguLabel 예시 표 (AC-1 · 01b Q1-A · Q2)', () => {
  it.each<[string, string | null, string]>([
    ['서울특별시 마포구 양화로 45', '마포구', '1 도로명 · 특별시'],
    ['서울 마포구 서교동 395-166', '마포구', '2 지번 · 시도 약칭'],
    ['서울특별시 종로구 청계천로 279', '종로구', '3 기존 픽스처'],
    ['부산광역시 수영구 광안해변로 219', '수영구', '4 광역시 자치구'],
    ['부산 금정구 구서동 1', '금정구', '5 지번 기존 픽스처'],
    ['부산광역시 기장군 기장읍 기장해안로 268', '기장군', '6 광역시 군'],
    ['대구광역시 군위군 군위읍 동서길 1', '군위군', '7 광역시 편입 군'],
    ['제주특별자치도 제주시 첨단로 242', '제주시', '8 특별자치도 행정시'],
    ['강원특별자치도 강릉시 창해로 307', '강릉시', '9 특별자치도'],
    [
      '경기도 수원시 영통구 광교중앙로 140',
      '수원시 영통구',
      '10 일반시+구 (Q1-A)',
    ],
    ['경기 성남시 분당구 정자동 178-1', '성남시 분당구', '11 지번 일반시+구'],
    ['경북 포항시 남구 대잠동 1', '포항시 남구', '12 흔한 구 이름'],
    [
      '경기도 안성시 죽산면 죽산초교길 69-4',
      '안성시',
      '13 일반시+면 (잇지 않음)',
    ],
    ['세종특별자치시 한누리대로 2130', null, '14 세종 도로명 (Q2)'],
    ['세종특별자치시 조치원읍 정리 1', null, '15 세종 읍 (Q2)'],
    ['첨단로 242', null, '16 시도 없는 주소 (BE 픽스처)'],
    ['', null, '17a 빈 문자열'],
    ['   ', null, '17b 공백만'],
    ['전남광주통합특별시 광산구 첨단과기로 123', '광산구', '18 통합특별시'],
  ])('%s → %p (%s)', (address, expected) => {
    // 준비 = 주소 한 줄, 실행 = 라벨 뽑기, 단언 = 완전 일치(문자열 또는 null).
    expect(sigunguLabel(address)).toBe(expected);
  });
});

describe('TRIP-1074 · sigunguLabel 은 입력에 없는 글자를 만들지 않는다 (PBT · INV-1)', () => {
  const token = fc.oneof(
    fc.constantFrom(
      '서울특별시',
      '경기도',
      '세종특별자치시',
      '수원시',
      '영통구',
      '기장군',
      '조치원읍',
      '양화로',
      '45'
    ),
    fc.string({ maxLength: 6 })
  );

  it('결과는 null 이거나, 입력 토막 1~2개(각각 시·군·구로 끝남)를 공백 하나로 이은 것이다', () => {
    fc.assert(
      fc.property(
        fc.array(token, { maxLength: 5 }),
        fc.constantFrom(' ', '  '),
        (tokens, gap) => {
          const address = tokens.join(gap);
          const label = sigunguLabel(address);
          if (label === null) return;

          const inputTokens = address.trim().split(/\s+/);
          const parts = label.split(' ');
          expect(parts.length).toBeGreaterThanOrEqual(1);
          expect(parts.length).toBeLessThanOrEqual(2);
          parts.forEach((part) => {
            expect(inputTokens).toContain(part);
            expect(part).toMatch(/[시군구]$/);
          });
        }
      )
    );
  });
});
