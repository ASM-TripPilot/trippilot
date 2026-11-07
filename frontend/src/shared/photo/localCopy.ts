import { Directory, File, Paths } from 'expo-file-system';

/**
 * TRIP-1803 · "선택한 사진만"(limited)에서 고른 사진의 기기 안 사본 — 앱이 허용 목록에 사진을 넣을 API 가 없어, 허용 목록 밖 사진은
 * 고를 때 피커 파일을 앱 문서 폴더로 옮겨 둔다(캐시 폴더는 OS 가 비운다). 서버로 나가지 않는다(BR-U5-11). `index.ts` 만 import 한다.
 *
 * 주소를 어디에도 저장하지 않고 호출마다 계산한다 — iOS 앱 폴더 경로는 앱 업데이트에 바뀔 수 있다.
 * `new Directory` 는 함수 안에서만 — jest-expo 의 이 모듈엔 `Directory` 가 없어 최상위면 import 순간 죽는다.
 * 세 함수 모두 던지지 않는다(INV-4 — 사본이 실패해도 첨부는 막지 않고, 그 사진은 "불러올 수 없어요"로 드러난다).
 *
 * ponytail: 원본 크기 그대로라 방문 30장 × 여행 수만큼 쌓인다. 줄이려면 피커 `quality` 옵션.
 * ponytail: 지우는 길은 계정 삭제뿐이다 — 사진 삭제 UI 가 없어 여행 삭제·POST 실패 뒤 안 고른 사진·전체 허용 전환 뒤 안 쓰는 사본이
 * 고아로 남는다. 사진 삭제 기능이 생기면 그때 함께 지운다.
 */

const copiesDir = (): Directory =>
  new Directory(Paths.document, 'visit-photo-copies');

// 앨범 번호(iOS `UUID/L0/001`)의 `/` 는 경로 구분자가 되므로 파일 이름에 안전한 글자로 바꾼다.
const copyFile = (id: string): File =>
  new File(copiesDir(), id.replace(/[^\w.-]/g, '_'));

export function moveToLocalCopy(id: string, uri: string): void {
  try {
    const target = copyFile(id);
    if (target.exists) return; // 같은 사진을 다시 고름 — 처음 사본을 둔다.
    copiesDir().create({ idempotent: true });
    new File(uri).move(target);
  } catch {
    // 디스크 부족·원본 없음 — 사본 없이 메타만 붙는다.
  }
}

export function localCopyUri(id: string): string | null {
  try {
    const file = copyFile(id);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

export function deleteLocalCopies(): void {
  try {
    const dir = copiesDir();
    if (dir.exists) dir.delete();
  } catch {
    // 지우기 실패가 계정 삭제 흐름을 막지 않는다.
  }
}
