/**
 * TRIP-465 · 사진 없는 일정 슬롯의 카테고리 플레이스홀더 — **틴트/아이콘 선택 순수 모듈**.
 *
 * `slot.imageUrl` 이 null 인 h25 카드에서 사진 자리에 그릴 78×78 대체 타일의 두 값을 고른다:
 * 카테고리 → 배경 틴트 tailwind 토큰 + 중앙 아이콘 키. 매핑 정본은 Figma 노드 2989:1731
 * (브리프 §토큰 스냅표, 01_brief:80~89). 알려진 7종 밖(액티비티·경계코드·미지·null·빈 문자열)은
 * 전부 폴백 한 규칙으로 접는다 — 빈 자리도 크래시도 아닌 정직한 기본 타일(INV-1 정신, 실사진 발명 아님).
 */

export interface CategoryPlaceholder {
  /** 78×78 플레이스홀더 배경 틴트 tailwind className (예: `'bg-primary-pale'`). */
  tintClass: string;
  /** 중앙 카테고리 아이콘 선택 키. 카테고리마다 다른 아이콘을 고른다(틴트가 겹쳐도 아이콘은 별개). */
  iconKey: string;
}

// 알려진 7종 매핑(정본 = Figma 2989:1731). 틴트는 명소↔문화(info-bg)·맛집↔쇼핑(primary-pale)이
// 겹치지만 아이콘 키는 전부 별개다 — 겹치는 틴트에서도 서로 다른 그림을 그린다.
const CATEGORY_MAP: Record<string, CategoryPlaceholder> = {
  명소: { tintClass: 'bg-info-bg', iconKey: 'sight' },
  맛집: { tintClass: 'bg-primary-pale', iconKey: 'food' },
  카페: { tintClass: 'bg-surface-strong', iconKey: 'cafe' },
  야경: { tintClass: 'bg-presence-blue-bg', iconKey: 'night' },
  자연: { tintClass: 'bg-success-bg', iconKey: 'nature' },
  쇼핑: { tintClass: 'bg-primary-pale', iconKey: 'shopping' },
  문화: { tintClass: 'bg-info-bg', iconKey: 'culture' },
};

// 폴백 타일 — 회색 틴트 + 이미지(사진 프레임) 아이콘. 이 아이콘 키는 위 7종 어디에도 없다.
const FALLBACK: CategoryPlaceholder = {
  tintClass: 'bg-surface-soft',
  iconKey: 'image',
};

export function resolveCategoryPlaceholder(
  category: string | null | undefined
): CategoryPlaceholder {
  if (category === null || category === undefined) return FALLBACK;
  // hasOwnProperty 로 조회한다 — 평범한 객체 인덱싱(`CATEGORY_MAP[category]`)은 `'constructor'`·
  // `'__proto__'`·`'toString'` 같은 프로토타입 키에서 undefined 가 아니라 상속 멤버(함수)를
  // 돌려줘 `?? FALLBACK` 이 안 먹는다 → 분해 시 tintClass=undefined 로 틴트가 조용히 소실된다.
  // 자유 string category(서버가 무엇이든 실을 수 있음)를 "알려진 7종 밖은 전부 폴백"으로 총괄한다.
  return Object.prototype.hasOwnProperty.call(CATEGORY_MAP, category)
    ? CATEGORY_MAP[category]
    : FALLBACK;
}
