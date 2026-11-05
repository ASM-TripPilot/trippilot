// TRIP-1799 · 웹 번들용 — `expo-clipboard` 웹 구현은 writeText 가 실패하면 execCommand 로 폴백하고 그 결과를 안 보고
// true 를 돌려줘 "복사 안 됐는데 복사했어요" 가 된다(INV-4). 그래서 패키지를 불러오지 않고 writeText 성공만 true 로 본다.
// 웹 복사는 https·사용자 클릭 안에서만 허용되므로 호출부는 클릭 핸들러 첫 동작으로 부른다.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// 시그니처 대조 — 실 모듈(index.ts) 타입이 바뀌면 여기서 빨개진다(tsc 는 소비처를 index.ts 로만 푼다).
void ({ copyText } satisfies Pick<typeof import('./index'), 'copyText'>);
