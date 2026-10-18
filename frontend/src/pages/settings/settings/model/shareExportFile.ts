import { requireOptionalNativeModule } from 'expo';
import { Directory, File, Paths } from 'expo-file-system';

import type { AccountExport } from '@/shared/api/index.schemas';
import { buildExportFile } from './exportSummary';

export type ShareExportFileResult = {
  status: 'shared' | 'unavailable' | 'failed';
};

/**
 * TRIP-1422 · 내보내기 응답을 캐시 전용 폴더에 `.json` 파일 하나로 써서 OS 공유 시트에 넘긴다.
 * reject 하지 않고 결과 값을 돌려준다(INV-4, `shareCapture.ts` 선례).
 *
 * 순서가 계약이다: 공유 모듈이 없는 빌드면 파일을 쓰기 **전에** 멈춘다(못 보낼 개인 데이터를 남기지 않는다).
 * 폴더는 지우고 다시 만든다 — `Directory.create` 는 이미 있는 폴더 안을 비우지 않는다. 공유 뒤엔 지우지
 * 않는다(받는 앱이 늦게 읽을 수 있다). 경로 객체는 함수 안에서 만든다(jest-expo 목엔 `Directory` 가 없다).
 */
export async function shareExportFile(
  data: AccountExport
): Promise<ShareExportFileResult> {
  if (requireOptionalNativeModule('ExpoSharing') == null) {
    return { status: 'unavailable' };
  }
  try {
    const { name, content } = buildExportFile(data);
    const dir = new Directory(Paths.cache, 'trippilot-export');
    if (dir.exists) dir.delete();
    dir.create();
    const file = new File(dir, name);
    file.write(content);
    const { shareAsync } = await import('./exportShareNative');
    await shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
    });
    return { status: 'shared' };
  } catch {
    return { status: 'failed' };
  }
}
