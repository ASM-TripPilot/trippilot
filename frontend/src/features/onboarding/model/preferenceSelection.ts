/**
 * 취향 축 토글 순수 규칙 (US-ONB-05·15 · AC5) — `toggleMulti`(복수 축)·`toggleSingle`(단일 축).
 *
 * TRIP-610 에서 실구현을 `shared/pref/preferenceSelection.ts` 로 승격했다(설정 l05 취향 수정이
 * 같은 규칙을 재사용하는데 features 간 import 가 막혀 shared 가 유일 경로). 여기는 온보딩 소비처가
 * 기존 경로(`@/features/onboarding/model/preferenceSelection`)로 계속 부를 수 있게 재수출만 한다 —
 * 동작·시그니처 불변이라 `preferenceSelection.test.ts` 는 수정 없이 그대로 green.
 *
 * 위치 근거: `docs/structure.md`의 "재사용 공개 API" 표에 이 경로로 등재된 기존 계약.
 */

export { toggleMulti, toggleSingle } from '@/shared/pref/preferenceSelection';
