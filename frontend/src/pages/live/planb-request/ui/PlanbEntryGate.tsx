import { useRouter } from 'expo-router';
import { useEffect, useRef, type ReactElement } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { seoulDate } from '@/shared/lib/seoulDate';
import { StateNotice } from '@/shared/ui/StateNotice';
import { showToast } from '@/shared/ui/Toast';

import { usePlanbEntryRoute } from '../model/usePlanbEntryRoute';
import { PlanbRequestPage } from './PlanbRequestPage';

/**
 * 상황 감지 FE-B · frontend-components §3.1·§3.2 · BR-SA-23 — 트리거 진입 게이트.
 *
 * 알림 탭 · 알림함 PLAN_B 행 · i03 [대안 보기]가 모두 `/trips/{tripId}/planb?triggerId=` 로 들어와 **이 게이트 하나**를
 * 지난다(라우트가 triggerId 가 있을 때만 그린다). 판정은 `usePlanbEntryRoute` → `entryRoute`(순수), 여기는 그리기·이동만:
 *
 *  - 기다림 → 대기 얼굴(접근성 이름 `확인하고 있어요`) — 최대 3초.
 *  - i05·i06 → `router.replace`(게이트를 스택에 남기지 않는다). i06 의 `미리 준비한 대안` 표식은 i06 이 세션으로 단다.
 *  - 허브 → 전역 토스트(호스트가 Stack 밖이라 이동 뒤에도 남는다) + `dismissTo` 허브(스택에 있으면 거기로, 없으면 갈아 끼움).
 *  - i04 → 같은 라우트 안에서 `PlanbRequestPage` 를 그린다 — 조회 실패·3초 초과는 URL 그대로(기존 동작), 준비된 대안이
 *    없거나 낡았으면 시드 props(사유·지시·제외)와 트리거 날짜·범위로.
 *  - 상세 404 → 404 얼굴(없는 알림 · 다른 계정 은닉). 문구는 없는 경로 화면(`app/+not-found`)과 같다.
 *
 * 이동은 결정당 한 번(`movedRef`). 결정 자체가 한 번 굳으므로 재조회로 화면이 바뀌지 않는다.
 * 대기 얼굴의 실제 터치·i04 → i06 replace 의 겹침은 jest 사각이다(정본 §12 #4 — 실기).
 */

const APPLIED_TOAST = '이미 반영한 대안이에요';
const INACTIVE_TOAST = '지금은 해당하지 않는 알림이에요';
const WAITING_LABEL = '확인하고 있어요';

const NEUTRAL_BADGE = (
  <View className="h-[72px] w-[72px] rounded-pill bg-surface-strong" />
);

export interface PlanbEntryGateProps {
  tripId: string;
  triggerId: string;
  /** URL 원문 — 조회 실패·3초 초과(i04 기존 동작)일 때 그대로 내린다. */
  scope?: string;
  /** URL 원문 — 위와 같다. */
  targetDate?: string;
  /** 'YYYY-MM-DD' — 테스트 주입용. 기본 = 오늘(KST). */
  today?: string;
}

export function PlanbEntryGate({
  tripId,
  triggerId,
  scope,
  targetDate,
  today = seoulDate(new Date()),
}: PlanbEntryGateProps): ReactElement {
  const router = useRouter();
  const route = usePlanbEntryRoute(tripId, triggerId, today);

  const movedRef = useRef(false);
  useEffect(() => {
    if (movedRef.current) return;
    if (route.kind === 'draft' || route.kind === 'solving') {
      movedRef.current = true;
      router.replace({
        pathname:
          route.kind === 'draft'
            ? '/trips/[tripId]/planb/draft'
            : '/trips/[tripId]/planb/solving',
        params: { tripId, sessionId: route.sessionId },
      });
    } else if (route.kind === 'hub') {
      movedRef.current = true;
      showToast(
        route.notice === 'applied'
          ? { message: APPLIED_TOAST, testID: 'planb-entry-gate-applied-toast' }
          : {
              message: INACTIVE_TOAST,
              testID: 'planb-entry-gate-inactive-toast',
            }
      );
      router.dismissTo({
        pathname: '/trips/[tripId]/live',
        params: { tripId },
      });
    }
  }, [route, router, tripId]);

  if (route.kind === 'fallback') {
    return (
      <PlanbRequestPage
        tripId={tripId}
        triggerId={triggerId}
        scope={scope}
        targetDate={targetDate}
      />
    );
  }
  if (route.kind === 'request') {
    return (
      <PlanbRequestPage
        tripId={tripId}
        triggerId={route.triggerId}
        scope={route.scope}
        targetDate={route.targetDate}
        seedReasons={route.seed.reasons}
        seedDirectives={route.seed.directives}
        seedExcludedPoiIds={route.seed.excludedPoiIds}
      />
    );
  }
  if (route.kind === 'notFound') {
    return (
      <SafeAreaView
        edges={['top', 'bottom']}
        style={{ flex: 1 }}
        className="bg-canvas"
      >
        <View className="flex-1 items-center justify-center bg-canvas px-lg">
          <StateNotice
            testID="planb-entry-gate-notfound"
            illustration={NEUTRAL_BADGE}
            title="페이지를 찾을 수 없어요"
            description="주소가 바뀌었거나 없는 화면이에요"
            actions={[
              {
                testID: 'planb-entry-gate-notfound-home',
                label: '홈으로',
                variant: 'filled',
                onPress: () => router.dismissTo('/(tabs)'),
              },
            ]}
          />
        </View>
      </SafeAreaView>
    );
  }
  // 기다림 · 이동 직전(i05·i06·허브) — 같은 대기 얼굴(빈 화면을 남기지 않는다).
  return (
    <View
      testID="planb-entry-gate"
      className="flex-1 items-center justify-center bg-scrim/40"
    >
      <View
        testID="planb-entry-gate-waiting"
        accessible
        accessibilityLabel={WAITING_LABEL}
        className="rounded-card bg-canvas p-lg"
      >
        <ActivityIndicator />
      </View>
    </View>
  );
}
