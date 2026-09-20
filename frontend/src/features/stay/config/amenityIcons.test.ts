import { resolveAmenityIcon } from './amenityIcons';
import { AmenityGlyph } from '../ui/StayGlyphs';

/**
 * TRIP-727 (부모 TRIP-723) — 편의시설 코드 → 아이콘 매핑(AC-2). 01b 자율판정:
 *  - 한글(canon: 주차·조식·와이파이·오션뷰) + 영문(픽스처: parking·breakfast·wifi·ocean) **두 철자
 *    모두** 같은 아이콘에 건다.
 *  - 미지 값 = 기존 체크 글리프(`AmenityGlyph`) 폴백(INV-1 — 모르는 코드에 특정 아이콘 발명 금지).
 *  - 매핑표 위치 = `features/stay/config/`(신규, 배럴 없음).
 *
 * 왜 이 층인가: '어느 값이 어느 아이콘인가'는 SVG stroke/shape 라 화면 렌더로 못 본다(글리프 사각,
 * repo-traps §글리프 · SlotGlyphs `ICON_BY_KEY` 선례). 컴포넌트 참조 동일성(`toBe`)으로 매핑표를
 * 여기서 못박는다(`categoryPlaceholder.test.ts` 선례). 화면(StayDetailScreen.test.tsx S2b)은 아이콘
 * leaf 존재까지만, 색·모양 정합은 6-b.
 *
 * *(개념)* `toBe` = 참조 동일성 — 두 철자가 같은 컴포넌트 함수를 가리키면 통과. 리터럴 아이콘 값을
 * 정본이 안 줘서 발명하지 않고 "같다/다르다/폴백이다" 구조만 잰다.
 */

const PAIRS: [en: string, ko: string][] = [
  ['parking', '주차'],
  ['breakfast', '조식'],
  ['wifi', '와이파이'],
  ['ocean', '오션뷰'],
];

describe('resolveAmenityIcon — 한글·영문 두 철자 매핑 + 미지 폴백 (AC-2 · INV-1)', () => {
  it.each(PAIRS)('%s 와(과) %s 는 같은 아이콘을 가리킨다', (en, ko) => {
    expect(resolveAmenityIcon(en)).toBe(resolveAmenityIcon(ko));
  });

  it('알려진 4종은 서로 다른 아이콘이다(전부 폴백으로 뭉개지지 않는다)', () => {
    const icons = new Set(
      ['parking', 'breakfast', 'wifi', 'ocean'].map((v) =>
        resolveAmenityIcon(v)
      )
    );
    expect(icons.size).toBe(4);
  });

  it('알려진 값은 폴백(AmenityGlyph)이 아니다', () => {
    for (const [en, ko] of PAIRS) {
      expect(resolveAmenityIcon(en)).not.toBe(AmenityGlyph);
      expect(resolveAmenityIcon(ko)).not.toBe(AmenityGlyph);
    }
  });

  it('미지 값·빈 문자열은 폴백 AmenityGlyph 로 접힌다(INV-1)', () => {
    expect(resolveAmenityIcon('사우나')).toBe(AmenityGlyph);
    expect(resolveAmenityIcon('gym')).toBe(AmenityGlyph);
    expect(resolveAmenityIcon('')).toBe(AmenityGlyph);
  });
});
