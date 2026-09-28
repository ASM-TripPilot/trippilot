import { shellTabHref } from './BottomTabBar';

/**
 * TRIP-1076 (1) · US-SHELL-03 — 탭 key 를 라우트 경로로 바꾸는 단일 함수.
 *
 * 왜 홈만 '/(tabs)' 인가: expo-router 의 괄호 폴더는 URL 에 안 나타나서 `(tabs)/index` 와
 * `(onboarding)/index` 가 둘 다 '/' 다. '/' 로 보내면 가드에 닫힌 온보딩 쪽으로 풀려 아무 일도 안 일어날
 * 수 있다(브리프 (1) 가설). 그룹 이름을 붙인 '/(tabs)' 는 탭 쪽 하나로만 풀린다.
 *
 * 왜 BottomTabBar 에서 가져오나: 탭 key 타입(`ShellTabKey`)이 사는 파일이 그 key 의 경로도 안다.
 * 별도 파일(`shared/ui/shellTabHref.ts`)은 `sharedUiStructure` AC-G2(shared/ui 비테스트 파일은
 * 전부 className 으로 스타일링)에 걸려 계약을 옮겼다(02a C1 개정).
 *
 * 3동작 뼈대: 준비=탭 key → 실행=함수 호출 → 단언=경로 문자열 완전 일치.
 */

describe('shellTabHref · 탭 key → 경로 (TRIP-1076 AC-1)', () => {
  it('🔴 U1 · 홈은 그룹 이름을 붙인 "/(tabs)" 로 간다 ("/" 가 아니다)', () => {
    expect(shellTabHref('home')).toBe('/(tabs)');
  });

  it.each(['explore', 'itinerary', 'records', 'my'] as const)(
    '🔴 U2 · %s 탭은 "/" + 탭 key 경로로 간다',
    (key) => {
      expect(shellTabHref(key)).toBe(`/${key}`);
    }
  );
});
