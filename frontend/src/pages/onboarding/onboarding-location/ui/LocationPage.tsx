/**
 * c08 위치 권한 프리프롬프트 배선 (US-ONB-04 · BR-U0-30 · TRIP-459).
 *
 * 동결 화면 `LocationPreprompt`(shared)를 온보딩 체인에 꽂는 컨테이너다 — 화면은 콜백만
 * 올려보내고(D2), OS 권한 발화·라우팅은 여기서 결정한다. "허용"은 포그라운드 권한을 1회 묻고
 * granted 면 다음 단계(푸시 안내 카드 — TRIP-1108), 아니면 denied 프레임으로 전환한다. 거부도 온보딩을 막지 않는다.
 */
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { openAppSettings } from '@/shared/external-link';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';

import {
  LocationPreprompt,
  type LocationPrepromptState,
} from '@/shared/location/index.view';
import { guardPress, openPressGuardWindow } from '@/shared/lib/pressGuard';

/** c08 default 목적 문단에 주입하는 Figma 온보딩 문구(4975:3306). 사용자 가시 텍스트라
 * 자구가 곧 계약이다 — 바꾸려면 게이트① 논의 대상. */
const ONBOARDING_PURPOSE =
  '내 주변을 알면 더 잘 맞는 곳을 추천하고\n길 안내도 막힘없이 이어져요';

/**
 * `onNext` 는 카드를 빠져나가는 모든 경로(허용 granted · 거부 프레임 계속 · 설정 복귀 재조회 granted)의 이동을 대신한다 —
 * 기존 계정이 HOME 에 들어올 때 이 카드를 다시 쓰는 곳(TRIP-1601)이 목적지를 정한다. 생략하면 온보딩 체인(푸시 카드)이다.
 * 하드코딩 `(onboarding)` 은 HOME 계정에겐 잠긴 그룹이라 이동이 에러 없이 무시된다(TRIP-1597) — 그래서 세 경로가 모두 이 한 함수를 지난다.
 */
export function LocationPage({
  onNext,
}: {
  onNext?: () => void;
}): ReactElement {
  const router = useRouter();
  const [state, setState] = useState<LocationPrepromptState>('default');

  const goToPush = () =>
    onNext ? onNext() : router.replace('/(onboarding)/push');
  // 즉시 넘어가는 버튼(거부 프레임 계속)은 다음 푸시 카드의 같은 자리 버튼과 겹친다 — 연타 두 번째 탭이
  // 카드를 못 본 채 건너뛰지 않게 가드로 감싼다(TRIP-1108 R6). granted 이동은 가드 창을 직접 연다 — 이미 허용된
  // 기기에선 OS 창 없이 곧장 넘어가 연타 두 번째 탭이 푸시 카드 `계속`에 떨어진다(5-b 재현).
  const goToPushGuarded = guardPress(goToPush);

  // 재진입 시 "다시 물을 수 없게" 거부돼 있으면(canAskAgain=false) 허용 버튼이 OS 다이얼로그를
  // 다시 못 띄우므로, 마운트에서 조회해 곧장 denied 프레임(설정 유도)을 보인다(Q2-②). 한 번 거부했지만
  // 재요청 가능한 상태(안드로이드 status='denied'+canAskAgain=true)나 미결정·허용이면 default 유지.
  useEffect(() => {
    void (async () => {
      try {
        const current = await Location.getForegroundPermissionsAsync();
        if (current.status === 'denied' && !current.canAskAgain) {
          setState('permission-denied');
        }
      } catch {
        // 권한 조회 실패는 default 유지 — 허용 버튼으로 다시 시도할 수 있어 무해.
      }
    })();
  }, []);

  // 거부 프레임에 있는 동안만: 설정 앱에서 위치를 켜고 돌아오면(active) **조회만** 다시 하고(OS 창 재요청 없음 —
  // BR-U0-30 개정), 허용됐으면 곧장 푸시 안내로 간다(TRIP-1427 결정 1=A). default 에선 구독하지 않는다 — OS 권한 창이
  // 닫힐 때도 active 가 와서 허용 이동과 겹친다. 화면을 떠난 뒤 도착한 결과로는 움직이지 않는다(alive).
  // 이동은 [계속]과 같은 가드로 감싼다 — 탭 없이 표면이 바뀌는 순간의 탭이 푸시 카드 `계속`에 떨어지지 않고,
  // active 중복·[계속] 탭과 겹쳐도 400ms 창 안의 두 번째 이동은 무시된다.
  useEffect(() => {
    if (state !== 'permission-denied') return undefined;
    let alive = true;
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void (async () => {
        try {
          const current = await Location.getForegroundPermissionsAsync();
          if (alive && current.granted) goToPushGuarded();
        } catch {
          // 조회 실패는 거부 프레임 유지 — [계속]으로 진행할 수 있다(INV-4).
        }
      })();
    });
    return () => {
      alive = false;
      sub.remove();
    };
    // goToPushGuarded 는 매 렌더 새 함수다 — 의존성에 넣으면 렌더마다 재구독해 진행 중 조회의 alive 를 끊는다.
    // 안에서 쓰는 것은 router 와 모듈 전역 가드 창뿐이라 옛 클로저여도 같은 동작이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // TRIP-1688 FV-TAP-02 — 한 번 누르면 잠근다. 이미 허용된 기기는 OS 창 없이 곧장 granted 라 연타가 요청·이동을
  // 두 번 냈다. 풀지 않는다 — 결과는 이동 아니면 거부 프레임이고, 거부 프레임엔 이 버튼이 없다([계속]이 대신한다).
  // guardPress 로 감싸지 않는다 — 창이 탭 시점에 열려 OS 창 응답이 빠르면 거부 프레임 [계속]을 삼킨다(TRIP-1108).
  const allowLockRef = useRef(false);

  // 허용 → OS 포그라운드 권한 요청 1회. granted 면 다음 단계, 아니면 denied 프레임으로 전환(무중단).
  const handleAllow = () => {
    if (allowLockRef.current) return;
    allowLockRef.current = true;
    void (async () => {
      try {
        const result = await Location.requestForegroundPermissionsAsync();
        if (result.granted) {
          openPressGuardWindow();
          goToPush();
        } else setState('permission-denied');
      } catch {
        // 권한 API 오류도 비허용으로 접어 denied 프레임을 보인다 — 온보딩을 막지 않는다(INV-4 결정론 폴백).
        setState('permission-denied');
      }
    })();
  };

  return (
    <LocationPreprompt
      purposeContext={ONBOARDING_PURPOSE}
      state={state}
      // 컴포넌트 계약상 default 의 "허용" 과 denied 의 "계속" 이 둘 다 onProceed 에 걸린다.
      onProceed={state === 'permission-denied' ? goToPushGuarded : handleAllow}
      onOpenSettings={() => {
        void openAppSettings();
      }}
    />
  );
}
