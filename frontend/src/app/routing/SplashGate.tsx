import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';
import { Stack } from 'expo-router';

import { useAccountBoundaryReset } from '@/app/model/useAccountBoundaryReset';
import { useGenerationWatch } from '@/app/model/useGenerationWatch';
import { usePermissionCatchUp } from '@/app/model/usePermissionCatchUp';
import { usePushRouting } from '@/app/model/usePushRouting';
import { useBootstrapGate } from '@/features/auth';
import { SplashScreen } from '@/features/auth';
import { flushMarks, mark } from '@/shared/lib/startupMarks';
import { registerPushIfGranted } from '@/shared/push';
import { readInstallFlag, writeInstallFlag } from '@/shared/storage';

import { BOOT_MODULE_LOADED_AT } from './bootClock';

/**
 * 스플래시 최소 노출 하한(ms). 정본 근거 없는 발명값 — 비행 모션 1.3초(SPLASH_FLIGHT_MS)가 끝까지 보이게 맞춘다(TRIP-1383).
 * TRIP-1720 실측(Release 시뮬·dev-api·10회, `pnpm bench:startup` — 실기기 절대값은 다르다): 부트스트랩은 JS 진입 후 p50 488ms
 * (p90 570)에 끝나고 하한이 그 뒤 p50 882ms(p90 978)를 더 붙잡는다 — 콜드스타트 합계를 정하는 값이 이것이다.
 * 1300 유지 결정(사용자, 2026-11-03)은 TRIP-1831(2026-11-08)이 **첫 실행에만** 좁혔다: 이 설치에서 하한을 끝까지 채운 적이 있으면(`SPLASH_SEEN_FLAG` 표식)
 * 하한 없이 부트스트랩이 준비되는 즉시 걷힌다 — 재방문은 비행이 중간에 끊긴다(수용, 비행 길이 조정은 M-52). 하한을 안 채운 첫 실행·표식 읽기 실패는 종전 1300 그대로다.
 */
export const SPLASH_MIN_VISIBLE_MS = 1300;

/** 설치 단위 "스플래시를 끝까지 봤음" 표식 이름 — `readInstallFlag`/`writeInstallFlag` 의 고정 상수(파일명 조각). */
const SPLASH_SEEN_FLAG = 'splash-seen';

/**
 * HOME 진입 뒤 푸시 토큰 재등록까지 미루는 시간(ms) — exp.host 외부 호출이 홈 첫 요청들과 경쟁하지 않게 한다(TRIP-1362).
 * TRIP-1720 실측: 등록 출발이 첫 프레임 뒤 p50 1562ms(최소 1467) — 홈 여행 데이터(첫 프레임과 같은 커밋)와는 겹치지 않는다.
 * 홈의 나머지 첫 요청이 끝나는 시각은 재지 않았다. 줄여도 사용자에게 보이는 이득이 없어(백그라운드 등록) 유지.
 * 실제 네트워크는 OS 알림 권한이 GRANTED 일 때만 나간다(registerPushIfGranted).
 */
export const PUSH_REGISTER_DELAY_MS = 2500;

/**
 * 하단 바를 **자기 화면 안에** 그리는 push 화면(허브 제외 — 허브는 아래에 따로 선언) — TRIP-1584.
 * 이런 화면이 기본 슬라이드로 열리면 바 사본이 화면과 함께 밀려 들어와 아래 `(tabs)` 의 진짜 탭 바 위로 "새 바"가 겹쳐 보인다.
 * 페이드는 진짜 탭 바가 비쳐 이중으로 보이므로 `none`(즉시 교체)이다. 바 없는 풀스크린(상세·위저드 등)은 슬라이드 그대로 둔다.
 * 바를 화면 안에 그리는 새 라우트를 만들면 여기에 이름을 더한다 — 빠지면 슬라이드로 조용히 돌아간다(스캔 가드 없음).
 */
const BAR_SCREEN_ROUTES = [
  'stays/index',
  'explore/places',
  'records/style',
  'trips/[tripId]/records/index',
  'trips/[tripId]/records/reflection/[date]',
  'trips/[tripId]/records/summary',
] as const;

/**
 * 회고(j03)·요약(j04)은 iOS 가장자리 스와이프 뒤로를 끈다 — 뒤로 가기의 단일 경로는 하단 바의 뒤로 원이다(TRIP-1600,
 * 사용자 결정 2026-10-23). 스와이프는 바 모프 없이 화면만 밀어내 하단 바와 어긋난다. 다른 바 화면은 범위 밖이라 그대로다.
 */
const NO_SWIPE_ROUTES: ReadonlySet<string> = new Set([
  'trips/[tripId]/records/reflection/[date]',
  'trips/[tripId]/records/summary',
]);

/**
 * 부트스트랩 게이트 컨테이너(D1 A안, 루트 셸에 마운트). useBootstrapGate 를 구독해
 * loading 이거나 목적지 미결이거나 최소 노출 하한(SPLASH_MIN_VISIBLE_MS) 미경과면 SplashScreen 을,
 * resolved+하한 경과면 destination 으로 가드된 Stack.Protected 그룹만 노출한다. destination 이
 * 갱신되면(잠정→온라인 복구 교정) 켜지는 그룹이 선언형으로 다시 결정돼 스플래시로 되돌아가지 않는다.
 *
 * floor 는 한 번만 흐르는 하한이다. 기준점은 마운트가 아니라 JS 모듈 로드 시각(`BOOT_MODULE_LOADED_AT`)이라 번들 평가·부팅에
 * 쓴 시간이 하한에 흡수된다(TRIP-1362). 경과 깃발은 true 로 굳고 다시 false 로 안 돈다 — 캐시
 * 토큰으로 즉시 resolve 돼도 첫 화면이 한 프레임은 보이고, 그 뒤의 목적지 교정은 지연시키지 않는다.
 * 하한 타이머는 표식 읽기를 기다리지 않고 마운트 때 만든다(TRIP-1831) — 표식이 있다는 답이 오면 그 타이머를 끄고 깃발을 바로 올린다(재방문).
 */
export function SplashGate() {
  const { phase, destination, isProvisional } = useBootstrapGate();
  const [floorElapsed, setFloorElapsed] = useState(false);

  // 시작 마크(TRIP-1717) — effect·타이머 콜백에서만 찍는다(렌더 본문 금지). effect 는 선언 순서로 돌아 P3 가 P4 보다 앞서야 한다.
  useEffect(() => {
    mark('rootMounted');
  }, []);

  useEffect(() => {
    if (phase === 'loading') return;
    mark('bootstrapResolved', { destination, isProvisional });
    // 첫 확정 순간만 남는다 — destination 교정 같은 이후 변화는 mark 가 첫 기록 우선이라 무시된다.
    // deps 억제 주석을 쓰지 않는다: 있으면 React Compiler 가 이 컴포넌트 최적화를 조용히 건너뛴다(03b W1).
  }, [phase, destination, isProvisional]);

  useEffect(() => {
    // 이미 흐른 시간만큼 덜어 낸다. 시계가 뒤로 가도(음수 경과) 하한을 넘겨 기다리지 않게 SPLASH_MIN_VISIBLE_MS 로 막는다.
    const elapsed = Date.now() - BOOT_MODULE_LOADED_AT;
    let alive = true;
    const timer = setTimeout(
      () => {
        mark('floorElapsed');
        setFloorElapsed(true);
        // 비행을 끝까지 보여 준 뒤에 적는다(시작하자마자 쓰면 200ms 만에 앱을 끈 사용자가 다음엔 비행을 못 본다). 실패는 삼킨다 — 다음에도 첫 실행으로 보일 뿐이다.
        void writeInstallFlag(SPLASH_SEEN_FLAG).catch(() => {});
      },
      Math.min(
        SPLASH_MIN_VISIBLE_MS,
        Math.max(0, SPLASH_MIN_VISIBLE_MS - elapsed)
      )
    );
    void readInstallFlag(SPLASH_SEEN_FLAG).then(
      (seen) => {
        // 언마운트 뒤 답은 아무것도 바꾸지 않는다. 표식이 있으면 하한을 건너뛴다(이미 울렸으면 둘 다 무해).
        if (!seen || !alive) return;
        clearTimeout(timer);
        mark('floorElapsed');
        setFloorElapsed(true);
      },
      // 읽기 실패 = 첫 실행으로 접는다 — 종전 하한 1300 이 그대로 돈다(INV-4 결정적 폴백).
      () => {}
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  // 인증된 진입(로그인·재로그인 포함)마다 조용히 토큰을 다시 올린다 — 조회만, 절대 묻지 않는다(TRIP-835).
  // 서버 등록은 멱등이라 반복해도 무해하다. 홈 첫 요청들과 경쟁하지 않게 HOME 진입 뒤 PUSH_REGISTER_DELAY_MS 만큼
  // 미루고 상호작용이 끝난 뒤에 부른다 — 그 전에 목적지가 바뀌면(로그아웃 등) 취소한다.
  useEffect(() => {
    if (destination !== 'HOME') return;
    let task: { cancel: () => void } | null = null;
    const timer = setTimeout(() => {
      task = InteractionManager.runAfterInteractions(() => {
        // 시작 마크(TRIP-1720) — 지연 등록이 실제로 출발한 순간. 첫 화면 요청과 겹치는지 재는 점이다.
        mark('pushRegister');
        flushMarks();
        void registerPushIfGranted();
      });
    }, PUSH_REGISTER_DELAY_MS);
    return () => {
      clearTimeout(timer);
      task?.cancel();
    };
  }, [destination]);

  const ready = phase !== 'loading' && destination !== null && floorElapsed;
  // 훅이라 조기 반환 위에서 부른다(렌더마다 훅 개수가 같아야 한다).
  // 기존 계정 HOME 진입 전 미결정 권한 안내(TRIP-1601) — 조회가 안 끝났으면 첫 화면만 최대 1초 더 스플래시를 붙잡는다.
  const holdSplash = usePermissionCatchUp(ready, destination);
  const drawn = ready && !holdSplash;

  // 스플래시가 풀려 스택이 처음 그려지는 커밋 — 다음 프레임에 firstFrame 을 찍고 파일로 내린다(TRIP-1717).
  useEffect(() => {
    if (!drawn) return;
    mark('splashReleased');
    requestAnimationFrame(() => {
      mark('firstFrame');
      flushMarks();
    });
  }, [drawn]);
  useAccountBoundaryReset(drawn, destination);
  usePushRouting(drawn, destination);
  useGenerationWatch(drawn, destination);

  if (!drawn) {
    return <SplashScreen />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={destination === 'FORCE_UPDATE'}>
        <Stack.Screen name="force-update" />
      </Stack.Protected>
      <Stack.Protected guard={destination === 'RECONSENT'}>
        <Stack.Screen name="reconsent" />
      </Stack.Protected>
      <Stack.Protected guard={destination === 'LOGIN'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={destination === 'ONBOARDING'}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={destination === 'HOME'}>
        <Stack.Screen name="(tabs)" />
        {/* c10 기능 안내(TRIP-1595) — 취향 2/2 완료가 HOME 을 연 뒤 replace 로 오는 화면이라 HOME 가드 안이다(로그아웃·401 이면 가드가 치운다).
            스와이프 뒤로를 끈다(진입·퇴장 모두 replace 라 아래에 돌아갈 화면도 없다). animation 은 주지 않는다. */}
        <Stack.Screen
          name="onboarding-tour"
          options={{ gestureEnabled: false }}
        />
        {/* 기존 계정 HOME 진입 전 권한 안내(TRIP-1601) — usePermissionCatchUp 이 replace 로 보내고 카드가 '/(tabs)' 로 replace 해 나간다.
            투어와 같은 이유로 HOME 가드 안·스와이프 뒤로 끔·animation 없음. */}
        <Stack.Screen
          name="permission-location"
          options={{ gestureEnabled: false }}
        />
        <Stack.Screen
          name="permission-push"
          options={{ gestureEnabled: false }}
        />
      </Stack.Protected>
      {/* i04 재계획 요청 시트 — 허브 위에 겹쳐 띄운다(TRIP-750 D1). trips 라우트는 어떤 가드에도
          속하지 않으므로 선언도 가드 밖에 둔다. */}
      <Stack.Screen
        name="trips/[tripId]/planb/index"
        options={{ presentation: 'transparentModal' }}
      />
      {/* i01 여행 중 허브(TRIP-1522) — 전환 없이 즉시 교체한다: 허브 하단 바가 홈 탭 바와 같은 5칸 모양으로 시작해 4단계 모프를 스스로
          재생하므로, 기본 슬라이드나 fade 는 아래 (tabs) 의 탭 바를 비치게 해 5칸이 이중으로 보인다. 바를 화면 안에 그리는 다른 push 화면도 같은 이유로 none 이다(위 BAR_SCREEN_ROUTES).
          가드 밖 선언은 planb 와 같은 이유다. */}
      <Stack.Screen
        name="trips/[tripId]/live/index"
        options={{ animation: 'none' }}
      />
      {/* 바를 화면 안에 그리는 push 화면(TRIP-1584) — 위 BAR_SCREEN_ROUTES 주해. 가드 밖 선언은 허브·planb 와 같은 이유다. */}
      {BAR_SCREEN_ROUTES.map((name) => (
        <Stack.Screen
          key={name}
          name={name}
          options={
            NO_SWIPE_ROUTES.has(name)
              ? { animation: 'none', gestureEnabled: false }
              : { animation: 'none' }
          }
        />
      ))}
      {/* ✦ AI 도우미 시트(TRIP-1322 · DEC-U8-13) — 진입 화면 위 투명 모달. (tabs) 밖이라 탭바가 가려진다.
          미인증 딥링크는 가드에 안 걸리지만 세션 생성 401 이면 시트가 스스로 닫힌다.
          TRIP-1554 — 아래에서 올라오는 모달 전환 없이 그 자리에 바로 뜨고 닫힌다(사용자 결정 "화면에서 바로 나오게", 페이드 아님). */}
      <Stack.Screen
        name="assistant/index"
        options={{ presentation: 'transparentModal', animation: 'none' }}
      />
    </Stack>
  );
}
