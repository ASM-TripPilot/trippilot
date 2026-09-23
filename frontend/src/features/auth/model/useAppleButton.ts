import { useEffect, useState, type ComponentType } from 'react';

type AppleButtonComponent = ComponentType<{ onPress: () => void }>;

/**
 * 이 기기에서 애플 로그인을 쓸 수 있으면 공식 애플 버튼 컴포넌트를, 아니면 null 을 돌려준다
 * (TRIP-932). 판정 전·false(Android)·판정 실패는 전부 null — 누르면 실패할 버튼을 보여 주지
 * 않는 fail-closed 선택이다(Q2). 그래서 catch 가 조용한 것은 INV-4 위반이 아니라 "버튼 없음"이
 * 그 실패의 표면이다.
 *
 * 애플 어댑터는 `await import` 로만 부른다(SDK 를 앱 시작 정적 그래프에서 떼는 경계). 그 호출을
 * async 함수 안 try 로 감싼 것은 의도다 — --experimental-vm-modules 없이 도는 integration
 * jest 에서는 `import()` 가 reject 가 아니라 **호출 자리에서 동기 throw** 하므로, try 밖에서
 * 부르면 렌더가 통째로 죽는다.
 *
 * 이 파일은 useSocialLogin(→ shared/api)을 import 하지 않는다 — 개발 프리뷰가 이 훅만 쓰고도
 * 네트워크 계층을 끌어오지 않게 하려는 것이다.
 */
export function useAppleButton(): AppleButtonComponent | null {
  const [AppleButton, setAppleButton] = useState<AppleButtonComponent | null>(
    null
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const apple = await import('../lib/appleAuthorize');
        if ((await apple.isAppleSignInAvailable()) && active) {
          // 함수형 업데이트로 넘긴다 — 컴포넌트(함수)를 그대로 주면 React 가 updater 로 호출한다.
          setAppleButton(() => apple.AppleSignInButton);
        }
      } catch {
        // fail-closed(Q2) — 위 주석 참고.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return AppleButton;
}
