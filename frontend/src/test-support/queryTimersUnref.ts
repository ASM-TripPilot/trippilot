// react-query 는 관찰자 없는 쿼리·뮤테이션 캐시를 gcTime(기본 5분) 뒤 지우려 타이머를 건다.
// 이 타이머가 ref 상태면 테스트 파일이 끝난 뒤에도 jest 워커가 살아남아 "worker failed to exit gracefully"
// 로 force-exit 된다(실측 분류는 TRIP-1630 01b). react-query 가 timeoutManager 로 거는 setTimeout(gc 포함)을
// unref(프로세스를 붙잡지 않게) 하고 동작은 그대로 둔다. setInterval(refetchInterval)은 위임만 한다 — ref 그대로.
// 전역 setTimeout 은 호출 시점에 읽는다 — import 시점에 캡처하면 jest 가짜 타이머를 못 따른다.
import { timeoutManager } from '@tanstack/react-query';

timeoutManager.setTimeoutProvider({
  setTimeout: (callback, delay) => {
    const handle = setTimeout(callback, delay);
    if (typeof (handle as { unref?: unknown }).unref === 'function') {
      (handle as { unref(): void }).unref();
    }
    return handle;
  },
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (callback, delay) => setInterval(callback, delay),
  clearInterval: (id) => clearInterval(id),
});
