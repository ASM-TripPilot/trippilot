/**
 * c08 위치 권한 프리프롬프트 배선 (US-ONB-04 · BR-U0-30 · TRIP-459).
 *
 * 동결 화면 `LocationPreprompt`(shared)를 온보딩 체인에 꽂는 컨테이너다 — 화면은 콜백만
 * 올려보내고(D2), OS 권한 발화·라우팅은 여기서 결정한다. "허용"은 포그라운드 권한을 1회 묻고
 * granted 면 다음 단계(pref1), 아니면 denied 프레임으로 전환한다. 거부도 온보딩을 막지 않는다.
 */
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';

import {
  LocationPreprompt,
  type LocationPrepromptState,
} from '@/shared/location/LocationPreprompt';

/** c08 default 목적 문단에 주입하는 Figma 온보딩 문구(1296:1208). 사용자 가시 텍스트라
 * 자구가 곧 계약이다 — 바꾸려면 게이트① 논의 대상. */
const ONBOARDING_PURPOSE =
  '내 주변을 알면 더 잘 맞는 곳을 추천하고 길 안내도 막힘없이 이어져요';

export function LocationPage(): ReactElement {
  const router = useRouter();
  const [state, setState] = useState<LocationPrepromptState>('default');
  // 거부 안내 줄의 1회성 닫기 — 화면 표시 1회만(영속 없음). 컴포넌트는 무상태(D2)라 상태를
  // 여기서 소유하고 onDismissNotice 로 올라온 × 탭에 반응해 안내 줄을 숨긴다.
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  const goToPref1 = () => router.replace('/(onboarding)/pref1');

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

  // 허용 → OS 포그라운드 권한 요청 1회. granted 면 다음 단계, 아니면 denied 프레임으로 전환(무중단).
  const handleAllow = () => {
    void (async () => {
      try {
        const result = await Location.requestForegroundPermissionsAsync();
        if (result.granted) goToPref1();
        else setState('permission-denied');
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
      onProceed={state === 'permission-denied' ? goToPref1 : handleAllow}
      onDefer={goToPref1}
      onOpenSettings={() => {
        void Linking.openSettings();
      }}
      onDismissNotice={() => setNoticeDismissed(true)}
      noticeDismissed={noticeDismissed}
    />
  );
}
