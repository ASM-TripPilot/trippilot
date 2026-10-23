import { File, Paths } from 'expo-file-system';

/**
 * TRIP-1601 · 설치 단위 "한 번 했음" 표식 — 앱 문서 폴더에 이름별 빈 파일 하나를 남긴다.
 *
 * SecureStore(iOS 키체인)에 두지 않는 이유: 키체인 값은 앱을 지웠다 다시 깔아도 남는다(`installId.ts` 주석). 이 표식은
 * "재설치하면 OS 권한이 초기화되니 안내를 다시 한 번"이 핵심이라 앱을 지우면 같이 지워지는 샌드박스 파일이어야 한다.
 * 캐시 폴더는 OS 가 비울 수 있어 문서 폴더다.
 *
 * 읽기는 실패하면 **reject** 한다 — 호출부가 "모름"과 "아직 안 함"을 구별해야 한다(false 로 접으면 모름이 "아직 안 함"이 된다).
 * 쓰기 실패도 그대로 던진다(삼킬지는 호출부가 정한다). 이름은 호출부의 고정 상수여야 한다(경로 조각으로 쓰인다).
 */

const fileOf = (name: string): File =>
  new File(Paths.document, `install-flag-${name}`);

export async function readInstallFlag(name: string): Promise<boolean> {
  return fileOf(name).exists;
}

export async function writeInstallFlag(name: string): Promise<void> {
  const file = fileOf(name);
  if (!file.exists) file.create();
  file.write('1');
}
