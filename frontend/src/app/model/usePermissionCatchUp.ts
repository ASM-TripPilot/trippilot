import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { router, useNavigationContainerRef } from 'expo-router';

import type { BootstrapDestination } from '@/features/auth/index.view';
import { getPushPermission } from '@/shared/push';
import { readInstallFlag, writeInstallFlag } from '@/shared/storage';

/** 권한 조회가 안 끝났을 때 스플래시를 더 붙잡는 상한(ms). 하한이 끝난 시점(`ready` 가 처음 참)부터 잰다. 발명값 — 6-b 에서 조정. */
export const PERMISSION_LOOKUP_WAIT_MAX_MS = 1000;

/** "한 번 안내했음" 표식의 이름(`shared/storage/installFlag`). */
const SEEN_FLAG = 'permission-catchup';

type Undetermined = { location: boolean; push: boolean };
const NOTHING: Undetermined = { location: false, push: false };

/** 읽다 실패한 쪽은 "미결정 아님"으로 접는다 — 모르면 묻지 않는다(INV-4, 사용자를 막지 않는 방향). */
async function isUndetermined(read: () => Promise<boolean>): Promise<boolean> {
  try {
    return await read();
  } catch {
    return false;
  }
}

/**
 * OS 가 아직 한 번도 안 물어본(미결정) 권한을 조회만 한다 — 요청은 하지 않는다. 위치는 foreground 만 본다.
 * "봤음" 표식을 읽다 실패하면 이미 본 것으로 접는다(알 수 없으면 안내하지 않는다). 절대 reject 하지 않는다.
 */
async function lookUp(): Promise<Undetermined> {
  // TRIP-1648 · 웹엔 OS 권한 안내가 없다 — 위치·푸시·표식을 읽지 않고 "안내 없음". 모듈 로드 때가 아니라 호출 때 읽는다(테스트가 바꾼다).
  if (Platform.OS === 'web') return NOTHING;
  const [location, push, seen] = await Promise.all([
    isUndetermined(
      async () =>
        (await Location.getForegroundPermissionsAsync())?.status ===
        'undetermined'
    ),
    isUndetermined(async () => (await getPushPermission()) === 'UNDETERMINED'),
    readInstallFlag(SEEN_FLAG).catch(() => true),
  ]);
  return seen ? NOTHING : { location, push };
}

/**
 * 온보딩을 이미 마친 계정이 HOME 에 들어올 때, 위치·알림 OS 권한이 미결정인 것만 홈보다 먼저 안내한다(TRIP-1601).
 * 반환값은 **스플래시를 더 붙잡을지**(holdSplash)다 — SplashGate 가 `drawn = ready && !holdSplash` 로 쓴다.
 *
 * - 조회는 마운트 때 시작한다(스플래시 하한이 도는 동안 OS 에 이미 물어 둔다). 조회가 하한까지 안 끝났으면 `ready` 가 처음
 *   참이 된 때부터 최대 `PERMISSION_LOOKUP_WAIT_MAX_MS` 만 첫 화면을 붙잡는다. 한 번 그려진 뒤엔 다시 붙잡지 않는다 —
 *   세션 안 로그인(LOGIN→HOME)에서 스플래시로 돌아가면 스택이 언마운트된다.
 * - HOME 에 들어올 때마다 다시 평가한다(첫 진입은 마운트 조회, 그 뒤 진입은 새 조회). 이 마운트에서 ONBOARDING 을
 *   한 번이라도 거쳤으면(신규 가입) 이동하지 않는다 — 온보딩 끝의 기능 안내 이동과 겹치는 것을 구조적으로 끊는다.
 * - 이동은 `replace` 라 홈이 스택에 안 남는다. 보내기로 정한 그 실행에서만 "봤음"을 쓴다(건너뛴 실행은 쓰기 0).
 */
export function usePermissionCatchUp(
  ready: boolean,
  destination: BootstrapDestination | null
): boolean {
  const navigation = useNavigationContainerRef();
  const [lookupDone, setLookupDone] = useState(false);
  const [released, setReleased] = useState(false);
  const mountResult = useRef<Undetermined | null>(null);
  const mountSpent = useRef(false);
  const sawOnboarding = useRef(false);

  const holdSplash =
    ready && destination === 'HOME' && !lookupDone && !released;
  const shown = ready && !holdSplash;

  useEffect(() => {
    let alive = true;
    void lookUp().then((found) => {
      if (!alive) return;
      mountResult.current = found;
      setLookupDone(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (destination === 'ONBOARDING') sawOnboarding.current = true;
  }, [destination]);

  // 붙잡기 상한 — 조회가 끝내 안 오면 안내 없이 홈으로 푼다(무한 스플래시 금지).
  useEffect(() => {
    if (!holdSplash) return undefined;
    const timer = setTimeout(
      () => setReleased(true),
      PERMISSION_LOOKUP_WAIT_MAX_MS
    );
    return () => clearTimeout(timer);
  }, [holdSplash]);

  // 첫 화면이 그려진 뒤로는 붙잡지 않는다(래치).
  useEffect(() => {
    if (shown) setReleased(true);
  }, [shown]);

  useEffect(() => {
    if (!shown) return undefined;
    const first = !mountSpent.current;
    mountSpent.current = true;
    if (destination !== 'HOME') return undefined;

    let cancelled = false;
    // 첫 진입은 마운트 조회를 쓴다 — 상한에 걸려 못 받았으면(null) 이번 실행은 건너뛴다. 이후 진입은 새로 조회한다.
    const lookup = first ? Promise.resolve(mountResult.current) : lookUp();
    void lookup.then(async (found) => {
      if (cancelled || found == null || sawOnboarding.current) return;
      const target = found.location
        ? '/permission-location'
        : found.push
          ? '/permission-push'
          : null;
      if (target == null) return;

      // 한 틱 양보한 뒤 **라이브** 라우터 상태를 본다. 이 훅은 usePushRouting 보다 먼저 불려 같은 커밋에서 effect 도 먼저 도는데,
      // 렌더 스냅샷만 보면 푸시 탭 이동(router.push)이 아직 안 반영돼 안내가 그 위에 쌓인다. 최상위가 홈 탭이 아니면
      // (푸시 탭·딥링크로 다른 화면에 있음) 이번 실행은 건너뛴다 — "봤음"도 남기지 않는다.
      await Promise.resolve();
      if (cancelled) return;
      const rootStack = navigation.getRootState()?.routes[0]?.state;
      const top =
        rootStack?.routes[rootStack.index ?? rootStack.routes.length - 1]?.name;
      if (top !== '(tabs)') return;

      writeInstallFlag(SEEN_FLAG).catch(() => {
        // 못 남겨도 안내는 그대로 간다 — 다음 실행에 한 번 더 뜰 뿐이다.
      });
      router.replace(target);
    });
    return () => {
      cancelled = true;
    };
  }, [shown, destination, navigation]);

  return holdSplash;
}
