import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { seoulDate } from './seoulDate';

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 지금부터 다음 KST 자정까지 ms(최소 1). KST 는 서머타임이 없어 +9h 산술이면 된다. */
function msUntilNextSeoulMidnight(now: number): number {
  return DAY_MS - ((now + KST_OFFSET_MS) % DAY_MS) || DAY_MS;
}

/**
 * KST 오늘 'YYYY-MM-DD'. 렌더 중 `seoulDate(new Date())` 직접 호출은 마운트 시점에 굳는다 —
 * 화면을 연 채로 자정을 넘기면 어제를 "오늘"로 들고 있고, React Compiler 는 deps 없는 식이라 한 번만 계산해
 * 영영 고정한다(TRIP-1364). 상태로 들고 ① 다음 KST 자정에 타이머로 ② 앱이 foreground 로 돌아올 때 다시 읽는다
 * (백그라운드에선 타이머가 멈춰 있을 수 있다). 같은 날이면 값이 같아 다시 그리지 않는다.
 *
 * shared 에 두는 이유는 `useDeadlineFlag` 와 같다(pages 는 구조 가드가 타이머를 금한다).
 */
export function useSeoulToday(): string {
  const [today, setToday] = useState(() => seoulDate(new Date()));
  // 타이머가 자정 직전(드리프트)에 깨어 날짜가 안 바뀌어도 다음 타이머를 다시 걸도록 effect 를 깨우는 카운터.
  const [armed, setArmed] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setToday(seoulDate(new Date()));
      setArmed((n) => n + 1);
    }, msUntilNextSeoulMidnight(Date.now()));
    return () => clearTimeout(timer);
  }, [armed]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setToday(seoulDate(new Date()));
    });
    // jest 의 RN AppState 목은 구독 객체를 안 돌려주므로 `?.` — 실기기에선 항상 있다.
    return () => subscription?.remove();
  }, []);

  return today;
}
