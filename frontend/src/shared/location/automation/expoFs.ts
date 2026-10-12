import { Directory, File, Paths } from 'expo-file-system';

import type { StoreFs } from './store';

/**
 * TRIP-1338 · 실 파일 시스템(NFR 델타 2) — 캐시 디렉토리 아래 U10 전용 폴더 1개(클라우드 백업 제외, SEC-U10-01).
 * 삭제는 폴더째(SEC-U10-02). ⚠️ 기기 검증 전 — 잠금 상태 wake 읽기 실패 동작은 6-b #15.
 */
export function createExpoFs(): StoreFs {
  const dir = new Directory(Paths.cache, 'trippilot-u10');
  const ensure = () => {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  };
  return {
    read(name) {
      const f = new File(dir, name);
      return f.exists ? f.textSync() : null;
    },
    write(name, text) {
      ensure();
      const f = new File(dir, name);
      if (!f.exists) f.create();
      f.write(text);
    },
    remove(name) {
      const f = new File(dir, name);
      if (f.exists) f.delete();
    },
    wipe() {
      if (dir.exists) dir.delete();
    },
  };
}
