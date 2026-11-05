/**
 * TRIP-1799 · shared/clipboard — 기기 클립보드에 글자를 넣는 입구(네이티브).
 *
 * 무엇을 보장하나:
 *  - `copyText` 는 reject 하지 않는다. 성공(`setStringAsync` 가 true)만 true, 그 밖(모듈 없음·로드 throw·거절)은
 *    false 다 — 호출부는 false 일 때 "복사했어요" 를 띄우지 않는다(INV-4).
 *  - 글자는 가공 없이 그대로 넘긴다(무엇을 복사할지는 호출부 몫).
 *  - `expo-clipboard` 는 로드 순간 `requireNativeModule` 로 던지므로 **호출 시점에 `require`** 한다 — 정적 import 면
 *    재빌드 전 dev build 가 라우트 평가 때 부팅부터 죽는다(`shared/photo` 와 같은 이유 · ESLint 가 정적 import 를 막는다).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    const Clipboard =
      require('expo-clipboard') as typeof import('expo-clipboard');
    return (await Clipboard.setStringAsync(text)) === true;
  } catch {
    return false;
  }
}
