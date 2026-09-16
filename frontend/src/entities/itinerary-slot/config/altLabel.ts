/**
 * TRIP-783 · AC-7 — "다른 후보 ›" 링크 문구의 단일 공용 상수(entities · config 세그먼트).
 *
 * 왜 config 인가: 이 값은 화면 로직이 아니라 카드가 그대로 그리는 **고정 카피**다. 지금까지
 * `DraftScreen.tsx`·`ItineraryEditScreen.tsx` 두 화면에 각자 로컬 상수로 복제돼 크로스스크린
 * 드리프트를 자동 심판이 못 잡았다(repo-traps itinerary 절). 새 카드(`SlotStopCard`)가 이 한 곳을
 * 소비해 그 드리프트를 없앤다 — 옛 두 로컬 상수 교체는 소비 화면 재작성 티켓(792/799) 몫(범위 밖).
 *
 * `›` 는 U+203A(single right-pointing angle quotation mark) — 텍스트 꼬리이지 chevron 글리프가 아니다.
 */
export const ALT_LABEL = '다른 후보 ›';
