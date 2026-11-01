import {
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { openAppSettings } from '@/shared/external-link';
import { useRouter } from 'expo-router';
import { goBackOr } from '@/shared/lib/goBackOr';

import {
  type PushPermission,
  resolvePushColumn,
} from '../model/channelAvailability';
import { useToggles } from '../model/useToggles';
import {
  NotificationSettingsScreen,
  type ToggleValueMap,
} from './NotificationSettingsScreen';
import {
  getPushPermission,
  registerPushIfGranted,
  requestPushPermission,
} from '@/shared/push';

/**
 * l02 알림 설정 배선(pages 층) — 서버 토글(`useToggles`)과 로컬 OS 권한(`getPushPermission`)을 잇는다.
 *
 * 권한은 서버 미러가 없어(NotificationToggle 계약에 필드 없음) 이 페이지가 로컬로 읽어 순수
 * `resolvePushColumn` 에 주입한다(PBT-U6-F2 가 그 순수 함수의 반환을 기계 강제) — 화면엔 판정 결과
 * `available` 만 내려간다. 토글 실패의 롤백·outcome 은 `useToggles` 가 이행한다(INV-4).
 *
 * 권한은 마운트 때와 앱이 다시 앞으로 올 때(AppState active — 설정 앱 왕복) **조회만** 다시 한다. 묻는 것은
 * 한 번도 안 물은(UNDETERMINED) 상태에서 배너를 눌렀을 때뿐이다(iOS 는 권한 창이 닫힐 때도 active 가 와서
 * 조회에 요청을 얹으면 창이 두 번 돈다). 허용을 처음 읽은 순간(첫 조회 포함) 기기 토큰을 등록한다 — 그러지 않으면
 * 화면은 켜졌는데 다음 앱 시작까지 서버에 토큰이 없다(TRIP-1442).
 */
export function NotificationSettingsPage(): ReactElement {
  const router = useRouter();
  const { items, toggle } = useToggles();
  // null = 아직 읽는 중. 처음부터 'UNDETERMINED' 로 두면 허용한 사용자에게도 거부 배너가 잠깐 번쩍인다.
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const lastRef = useRef<PushPermission | null>(null);
  const aliveRef = useRef(true);

  const readPermission = useCallback(async () => {
    let next: PushPermission;
    try {
      next = await getPushPermission();
    } catch {
      // 조회 실패는 직전 얼굴 유지. 첫 조회부터 실패하면 거부 얼굴로 — 읽는 중에 갇히면 설정 앱으로 갈 길이 없다(INV-4).
      if (aliveRef.current) setPermission((p) => p ?? 'DENIED');
      return;
    }
    if (!aliveRef.current) return;
    const prev = lastRef.current;
    lastRef.current = next;
    setPermission(next);
    // 첫 조회(prev=null)도 포함 — 앱이 켜진 뒤 설정 앱에서 허용하고 들어오면 SplashGate 등록이 없었다.
    if (prev !== 'GRANTED' && next === 'GRANTED') {
      void registerPushIfGranted();
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void readPermission();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void readPermission();
    });
    return () => {
      aliveRef.current = false;
      sub?.remove();
    };
  }, [readPermission]);

  const values: ToggleValueMap = {};
  for (const item of items) {
    values[item.kind] = {
      pushEnabled: item.pushEnabled,
      inAppEnabled: item.inAppEnabled,
    };
  }

  // 열 가용성 판정은 순수 함수에만 산다(PBT 대상). cellsOn 은 화면이 checked 를 직접 파생하므로
  // 페이지는 available 만 읽는다 — 함수는 그대로 두어 불변식(권한 없으면 활성 미반환)을 잠근다.
  const { available } = resolvePushColumn(permission ?? 'UNDETERMINED', items);

  return (
    <NotificationSettingsScreen
      values={values}
      pushColumnAvailable={available}
      permissionChecking={permission === null}
      onToggle={(kind, channel, next) => {
        void toggle(kind, channel, next);
      }}
      onOpenSettings={() => {
        if (permission !== 'UNDETERMINED') {
          void openAppSettings();
          return;
        }
        // 한 번도 안 물은 앱은 iOS 설정에 알림 항목이 없을 수 있어 OS 창을 먼저 띄운다(결정 1=B).
        void (async () => {
          try {
            await requestPushPermission();
          } catch {
            // 요청 실패는 아래 재조회가 지금 상태로 다시 그린다.
          }
          await readPermission();
        })();
      }}
      onPressBack={() => goBackOr(router, '/settings')}
    />
  );
}
