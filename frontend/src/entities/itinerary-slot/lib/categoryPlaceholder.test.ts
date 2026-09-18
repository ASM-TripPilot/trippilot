import {
  resolveCategoryPlaceholder,
  type CategoryPlaceholder,
} from './categoryPlaceholder';

/**
 * TRIP-465 · 카테고리 플레이스홀더 **틴트/아이콘 매핑**의 1차 심판(순수 함수).
 *
 * 무엇을 보장하나:
 *  - 🔴 **AC-3** 알려진 7종(명소·맛집·카페·야경·자연·쇼핑·문화)이 각각 **정확한 틴트 토큰**을
 *    낸다. 매핑 정본은 Figma 노드 2989:1731(브리프 §화면·IO 토큰표, 01_brief:80~89).
 *  - 🔴 **AC-4** 7종 밖(액티비티·경계코드 `SIGHT`·미지 한글·`null`·`undefined`·빈 문자열)은 전부
 *    폴백 틴트 `bg-surface-soft` 로 접힌다 — 빈 자리도 크래시도 아닌 **정직한 기본 타일**.
 *  - 🔴 **AC-3/4 아이콘** 7종은 서로 다른 아이콘 키를 갖고(틴트가 겹치는 명소↔문화·맛집↔쇼핑도
 *    아이콘은 별개, 01_brief:80~89), 폴백 아이콘 키는 그 7종 어느 것과도 다르다. iconKey 는
 *    함수가 돌려주는 **문자열**이라 jest 가 볼 수 있다(아이콘 *색·모양* fill 정합은 jest 사각 →
 *    [검증] 스크린샷 전용, 01b §jest 사각).
 *
 * *(개념)* **순수 판정 함수**: 네트워크·시계·렌더를 모르고 입력→출력만 있는 함수. 그래서 매핑표를
 *   그대로 테스트표로 옮겨 비공허하게 잠근다(`resolveItineraryDestination` 선례).
 * *(개념)* `.toBe(x)` = 원시값(문자열) **완전 일치**. `bg-primary-pale` 을 `bg-primary` 로 오타 내면
 *   부분포함이 아니라 정확일치라 즉시 red. `new Set([...]).size` = 배열의 **서로 다른 값 개수**.
 *
 * 3동작 뼈대: 준비=카테고리 문자열 → 실행=`resolveCategoryPlaceholder(cat)` → 단언=틴트·아이콘 키.
 */

/** AC-3 매핑표(01_brief:80~89, 정본=Figma 2989:1731). 한글 라벨 → 틴트 tailwind 토큰. */
const TINT_CASES: { category: string; tintClass: string }[] = [
  { category: '명소', tintClass: 'bg-info-bg' },
  { category: '맛집', tintClass: 'bg-primary-pale' },
  { category: '카페', tintClass: 'bg-surface-strong' },
  { category: '야경', tintClass: 'bg-presence-blue-bg' },
  { category: '자연', tintClass: 'bg-success-bg' },
  { category: '쇼핑', tintClass: 'bg-primary-pale' },
  { category: '문화', tintClass: 'bg-info-bg' },
];

/** AC-4 폴백 대상 — enum 밖·경계코드·미지·부재·빈 문자열. 전부 한 규칙(bg-surface-soft)으로 접힌다. */
const FALLBACK_INPUTS: {
  label: string;
  category: string | null | undefined;
}[] = [
  { label: '액티비티(enum 밖 한글)', category: '액티비티' },
  { label: 'SIGHT(경계 코드)', category: 'SIGHT' },
  { label: '관광(미지 한글)', category: '관광' },
  { label: 'null', category: null },
  { label: 'undefined', category: undefined },
  { label: '빈 문자열', category: '' },
];

const FALLBACK_TINT = 'bg-surface-soft';

describe('🔴 resolveCategoryPlaceholder · AC-3 — 7종 카테고리 → 정확한 틴트 토큰', () => {
  it.each(TINT_CASES)(
    '$category → $tintClass',
    ({ category, tintClass }: { category: string; tintClass: string }) => {
      // 준비·실행 — 한글 카테고리 하나를 순수 함수에 넣는다.
      // 단언 — Figma 매핑표가 지정한 틴트 토큰과 정확히 같다.
      expect(resolveCategoryPlaceholder(category).tintClass).toBe(tintClass);
    }
  );
});

describe('🔴 resolveCategoryPlaceholder · AC-4 — 매핑 밖은 전부 폴백 틴트로 접힌다', () => {
  it.each(FALLBACK_INPUTS)(
    '$label → bg-surface-soft',
    ({ category }: { category: string | null | undefined }) => {
      // 단언 — 알 수 없는/없는 카테고리는 예외 없이 폴백 틴트(빈 자리·크래시 아님).
      expect(resolveCategoryPlaceholder(category).tintClass).toBe(
        FALLBACK_TINT
      );
    }
  );
});

describe('🔴 resolveCategoryPlaceholder · AC-3/4 — 아이콘 키는 카테고리마다 다르고, 폴백은 그 밖이다', () => {
  it('7종은 서로 다른 아이콘 키를 갖고, 각 키는 비어 있지 않다', () => {
    // 준비·실행 — 7종의 결과를 모은다.
    const iconKeys = TINT_CASES.map(
      ({ category }) => resolveCategoryPlaceholder(category).iconKey
    );

    // 단언 ① — 하나라도 빈 키가 없다(아이콘을 실제로 고른다).
    iconKeys.forEach((key: string) => expect(key).not.toBe(''));
    // 단언 ② — 7개가 전부 서로 다르다(명소↔문화·맛집↔쇼핑은 틴트가 겹쳐도 아이콘은 별개).
    expect(new Set(iconKeys).size).toBe(7);
  });

  it('폴백 아이콘 키는 7종 어느 것과도 겹치지 않는다', () => {
    // 준비·실행 — 7종 키 집합 + 폴백 키(액티비티로 폴백 유도).
    const categoryKeys = new Set(
      TINT_CASES.map(
        ({ category }) => resolveCategoryPlaceholder(category).iconKey
      )
    );
    const fallback: CategoryPlaceholder =
      resolveCategoryPlaceholder('액티비티');

    // 단언 — 폴백 아이콘은 카테고리 7종 아이콘과 다른 별개 그림(01_brief:89 '이미지 아이콘').
    expect(fallback.iconKey).not.toBe('');
    expect(categoryKeys.has(fallback.iconKey)).toBe(false);
  });
});
