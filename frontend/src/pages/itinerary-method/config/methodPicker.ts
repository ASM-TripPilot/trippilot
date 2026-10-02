/**
 * h01 시작 방법 화면(`ui/MethodPickerScreen`)의 진행 표시·안내 문구(TRIP-784 · Figma 3824:2128).
 * 화면 정합에서 이번에 바뀌는 값만 여기 모은다 — 세 방식 카드 문구는 화면이 그대로 소유한다.
 * 색·소요시간은 여기 두지 않는다(점 색 렌더는 ui 에 둬 raw-hex 스캔을 받게 한다). 배럴 없이
 * 화면이 직접 import 한다(`stay/config`·`auth/config` 선례 — features 관례).
 */

// 앱바 우측 진행 표시 — 전체 4단계 중 3단계째("3 / 4" + 점 4개 중 3채움).
export const METHOD_PROGRESS = { current: 3, total: 4 } as const;

// 상단 서브카피 · 하단 안내(Figma 정본 문구).
export const METHOD_SUBTITLE = '마음에 드는 방식을 골라주세요';
export const METHOD_SWITCH_NOTE = '어떤 방식이든 마지막엔 직접 고칠 수 있어요';
