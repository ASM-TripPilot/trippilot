import type { ImageLicense } from '@/shared/api/index.schemas';

// `import type` + 글자 비교만 쓴다 — `ImageLicense.TYPE3` 값 import 는 생성 스키마 수백 모듈을 부팅 경로에 싣는다.

/** 관광공사 사진 이용 조건(공공누리) 표시 문구 — 한 곳. `short` 는 작은 칸, `full` 은 큰 칸, `a11y` 는 낭독. */
export const PHOTO_CREDIT = {
  full: '사진: 한국관광공사',
  short: '한국관광공사',
  a11y: '사진 출처 한국관광공사',
} as const;

/**
 * 서버 POI 사진을 자를지(fit)·출처를 달지(showCredit) 정하는 순수 판정.
 * 서버 사진이 아니면(번들 표지·로드 실패) 유형과 무관하게 cover + 출처 없음. 서버 사진이면 TYPE1 만 cover,
 * TYPE3·null·undefined(유형 미수집)는 자르지 않는다(contain). 출처는 서버 사진이면 항상.
 */
export function resolvePhotoPolicy(input: {
  imageLicense: ImageLicense | null | undefined;
  hasServerPhoto: boolean;
}): { fit: 'cover' | 'contain'; showCredit: boolean } {
  if (!input.hasServerPhoto) return { fit: 'cover', showCredit: false };
  return {
    fit: input.imageLicense === 'TYPE1' ? 'cover' : 'contain',
    showCredit: true,
  };
}
