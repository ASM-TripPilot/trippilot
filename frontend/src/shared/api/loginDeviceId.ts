import { Platform } from 'react-native';

import { getInstallId } from '@/shared/storage/installId';

/**
 * 로그인 요청 바디의 선택 필드 `deviceId` = `{Platform.OS}-{설치 id}`(예: `web-…`·`ios-…`·`android-…`).
 * 서버가 refresh_session.device_id 에 그대로 저장해, 운영 DB 에서 첫 세션 기준 앱/웹 가입자를 가를 수 있다
 * (서버·DB 무변경 — 그전엔 미전송이라 서버가 세션마다 임의값을 넣어 구분이 불가능했다).
 * 설치 id 는 사진 메타와 같은 `getInstallId`(웹은 localStorage). 서버 상한 128자 — 접두+uuid 는 44자 이하.
 * 설치 id 를 못 읽으면 undefined: 통계용 값 때문에 로그인을 막지 않는다.
 */
export async function loginDeviceId(): Promise<string | undefined> {
  try {
    return `${Platform.OS}-${await getInstallId()}`;
  } catch {
    return undefined;
  }
}
