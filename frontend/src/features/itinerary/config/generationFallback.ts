/**
 * h07 [완전AI] 일정 생성 · fallback 화면(`ui/GenerationFallbackScreen`)의 카피·진행 표시
 * (TRIP-791 · Figma `3831:2177`).
 *
 * 화면 카피의 정본은 Figma 다 — business-rules 에 문장 단위 근거가 없어(폴백 항상 표시는
 * BR-U3-11 이 정하지만 *문구*는 정하지 않는다) F값을 그대로 옮긴다. 색·소요시간은 여기 두지
 * 않는다(INV-3). 배럴 없이 화면이 직접 import 한다(`config/methodPicker.ts` 선례 — features 관례).
 *
 * ⚠️ 체크리스트 ①행(`꼭 갈 곳 N곳 배치`)은 N(주입값)이 붙어 화면이 조립한다 — 접미만 상수로
 * 두면 하드코딩/placeholder 검출(AC-4)의 취지가 흐려져 여기 두지 않는다.
 */

// 앱바 우측 진행 표시 — 4단계 마지막("4 / 4" + 막대 4개 전부 채움).
export const GENERATION_FALLBACK_PROGRESS = { current: 4, total: 4 } as const;

// 앱바 제목.
export const GENERATION_FALLBACK_TITLE = '일정 만들기';
// 지도 카드 좌상단 pill.
export const GENERATION_FALLBACK_MAP_PILL = '기본 동선으로 그렸어요';
// 메시지 카드 제목·본문(en-dash 없음 · 중점 U+00B7).
export const GENERATION_FALLBACK_MESSAGE_TITLE = 'AI 추천은 잠시 쉬어요';
export const GENERATION_FALLBACK_MESSAGE_BODY =
  '연결이 불안정해서 취향 반영 없이 기본 일정을 먼저 만들었어요 · 나중에 다시 짤 수 있어요';
// 체크리스트 ②③④(①은 화면이 N 을 붙여 조립).
export const GENERATION_FALLBACK_CHECK_ROUTE = '동선·거리 계산';
export const GENERATION_FALLBACK_CHECK_SKIPPED = '취향 반영 (건너뜀)';
export const GENERATION_FALLBACK_CHECK_DONE = '기본 일정 완성';
// 안내바.
export const GENERATION_FALLBACK_INFO = '준비되면 알림으로 알려드릴게요';
// 하단 CTA — 성공(폴백) 변형.
export const GENERATION_FALLBACK_VIEW_PLAN = '기본 일정 보기';
export const GENERATION_FALLBACK_MANUAL = '직접 짜기';
// 하드 실패 변형 — 히어로 문구 + 노트(기존 DraftScreen FAILED_NOTE 계열) + 재시도 CTA.
export const GENERATION_FALLBACK_FAILED_TITLE = '일정을 만들지 못했어요';
export const GENERATION_FALLBACK_FAILED_NOTE =
  '네트워크를 확인하고 다시 시도해주세요';
export const GENERATION_FALLBACK_RETRY = '다시 시도';
