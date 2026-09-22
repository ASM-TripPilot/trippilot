/**
 * TRIP-794 · D6 — h09 컨셉 카드 정적 설명 문구(config 단일 출처, 화면 하드코딩 금지).
 *
 * 값은 브리프 §D 표. 화면(`ConceptPickerScreen`)이 `CONCEPT_DESCRIPTIONS[key]`로 읽어 카드 설명을
 * 그린다 — 화면 소스에 문구를 직접 박으면 `conceptCards.test.ts` G3(소스 스캔)가 red 로 잡는다.
 * 배럴 없이 화면이 직접 import 한다(`config/methodPicker.ts`·`placeCategoryChips.ts` 선례 — features 관례).
 *
 * 소요시간·색은 여기 두지 않는다(INV-3 — 이 문구는 데이터가 아니라 발명 카피다). 컨셉별 후보 수("3곳")·
 * 배지("AI 추천"·"컨셉 매칭")는 이를 받칠 BE 계약이 아직 없어(BR-U3-24·INV-1 closed-set) 여기에도 화면에도
 * 두지 않는다(계약 도착 후 별 티켓).
 */
export const CONCEPT_DESCRIPTIONS: Record<string, string> = {
  meal: '근처 로컬 맛집',
  cafe: '전시 보고 쉬어가기 좋아요',
  culture: '미술 취향과 잘 맞아요',
  outdoor: '바다·공원 가까워요',
  shopping: '근처 상권',
};
