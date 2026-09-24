/**
 * 약관 **문서 제목**(TRIP-937 열람 헤더·재동의 행) — Figma c06 문구. 온보딩 체크박스 라벨
 * (`useTermsConsent` 의 TERMS_LABELS — '개인정보 수집·이용' 등)과 다르다: 심사자가 찾는 이름은
 * '개인정보 처리방침'이다. 설정 행 라벨은 `features/settings` 가 이 파일을 import 할 수 없어
 * `settingsSections.ts` 에 같은 문구를 따로 둔다.
 *
 * 선택 약관(MARKETING 등)은 Figma 문구가 없어 서버 코드를 그대로 보인다(재동의 목록에 올 수 있다 — 01 Q9).
 */
const TERMS_DOCUMENT_TITLES: Record<string, string> = {
  TERMS_OF_SERVICE: '서비스 이용약관',
  PRIVACY_POLICY: '개인정보 처리방침',
  LOCATION_TERMS: '위치정보 이용약관',
};

export function termsDocumentTitle(termsType: string): string {
  return TERMS_DOCUMENT_TITLES[termsType] ?? termsType;
}
