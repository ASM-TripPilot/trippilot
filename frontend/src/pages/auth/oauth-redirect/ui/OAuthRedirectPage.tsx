import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { completeAuthSession } from '../lib/completeAuthSession';

/**
 * 소셜 로그인 팝업이 돌아오는 `/oauth/{provider}` 의 중계 화면(웹 전용, TRIP-1649). 뜨자마자 원 창에 결과를 넘기고
 * 팝업이 닫힌다. 진행 중인 로그인이 없으면(`failed`) 홈으로 보낸다 — `success` 면 원 창이 팝업을 닫는 중이라 건드리지 않는다.
 * 호출은 effect 에서 한 번만(ref 가드) — 개발 StrictMode 가 effect 를 두 번 돌려도 두 번째 호출이 `failed` 로 읽혀
 * 닫히는 중인 팝업을 `/` 로 보내지 않게.
 */
export function OAuthRedirectPage(): ReactElement {
  const router = useRouter();
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (completeAuthSession().type === 'failed') {
      router.replace('/');
    }
  }, [router]);

  return (
    <View
      testID="oauth-redirect-page"
      className="flex-1 items-center justify-center bg-canvas"
    >
      <Text className="font-noto text-body text-ink">로그인 확인 중…</Text>
    </View>
  );
}
