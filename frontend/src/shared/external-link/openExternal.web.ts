import { showToast } from '@/shared/ui/Toast';

// async 를 쓰지 않는다 — window.open 이 클릭과 같은 턴(첫 await 전)에 불려야 팝업 차단을 피한다.
export function openExternal(url: string): Promise<void> {
  // 스킴은 window 를 건드리기 전에 가른다. nmap:·javascript: 등은 거절해 호출부 사다리가 웹 URL 로 내려가게 한다.
  if (/^tel:/i.test(url)) {
    window.location.href = url;
    return Promise.resolve();
  }
  if (/^https?:\/\//i.test(url)) {
    const win = window.open(url, '_blank');
    if (win === null) {
      return Promise.reject(new Error('팝업이 차단돼 새 탭을 열지 못했다'));
    }
    win.opener = null;
    return Promise.resolve();
  }
  return Promise.reject(new Error('웹에서 열 수 없는 주소'));
}

export function openAppSettings(): Promise<void> {
  showToast({
    message: '브라우저 설정에서 권한을 바꿔 주세요',
    tone: 'error',
    testID: 'external-link-settings-notice',
  });
  return Promise.resolve();
}

// 앱 파일과 export 이름·시그니처가 같게 묶는다(tsc 가 .web.ts 를 import 그래프에 안 올린다).
void ({
  openExternal,
  openAppSettings,
} satisfies typeof import('./openExternal'));
