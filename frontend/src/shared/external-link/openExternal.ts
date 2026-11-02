import * as Linking from 'expo-linking';

/** 앱(iOS/Android): OS 가 주소를 처리할 앱을 연다. 거절은 호출부 사다리가 받는다. */
export function openExternal(url: string): Promise<void> {
  // 누름 직후 동기 단언하는 기존 테스트가 있어 첫 await 전에 부른다. 목이 undefined 를 줘도 Promise 를 보장한다.
  return Promise.resolve(Linking.openURL(url)).then(() => undefined);
}

/** 앱(iOS/Android): OS 설정 앱의 이 앱 페이지를 연다. */
export function openAppSettings(): Promise<void> {
  return Promise.resolve(Linking.openSettings()).then(() => undefined);
}
