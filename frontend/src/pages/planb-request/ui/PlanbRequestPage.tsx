import { useRouter } from 'expo-router';
import { isAxiosError } from 'axios';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { parseSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import { useLiveItinerary } from '@/features/execution/model/useLiveItinerary';
import { TRIGGER_REASON_KEY } from '@/features/planb/config/replanChoices';
import { buildStartReplanRequest } from '@/features/planb/model/replanRequest';
import { useReplanFormStore } from '@/features/planb/model/replanFormStore';
import { triggerPillCopy } from '@/features/planb/model/triggerPillCopy';
import { useActiveTriggers } from '@/features/planb/model/useActiveTriggers';
import { useReplanGpsOrigin } from '@/features/planb/model/useReplanGpsOrigin';
import { useStartReplan } from '@/features/planb/model/useStartReplan';
import { ReplanRequestSheet } from '@/features/planb/ui/ReplanRequestSheet';
import type { ItineraryDaysItem } from '@/shared/api/generated/schemas';

/**
 * TRIP-750 · i04 배선판. 진입 초기화 → 감지 트리거 시드 → 폼 스토어 ↔ 시트 → 빌더 → POST → 라우터.
 *
 * - 진입할 때 폼을 비우고(이전 방문 값 제거) URL scope 를 반영한다. 한 흐름에 모아 두는 이유는
 *   라우트·페이지 effect 순서에 기대지 않기 위해서다.
 * - 감지 트리거 = URL `triggerId` 와 같은 id 의 활성 트리거(MANUAL 제외). 있으면 대응 사유를 **한 번만**
 *   켠다(토글이 아니라 set — 이미 켜져 있으면 그대로). 사용자가 끈 뒤엔 다시 켜지 않는다.
 * - `[AI가 다시 짜기]` → GPS origin 1회 읽기(최대 5초, 실패면 origin 없이 — 막지 않는다, TRIP-979)
 *   → body 조립(감지 트리거 id 포함) → POST → 성공 시 응답 세션 id 를 싣고 solving 으로
 *   **replace**(TRIP-752). 이 시트는 허브 위 투명 모달이라 push 로 쌓으면 solving 의 ‹ 가 요청 시트로 돌아간다.
 * - 스크림·끌어 닫기 → 뒤로. 뒤로 갈 곳이 없으면(딥링크·푸시 직행) 허브로 replace.
 */

export interface PlanbRequestPageProps {
  tripId: string;
  /** URL 원문 — 'PARTIAL_SLOTS' | 'FULL_DAY' 만 반영한다(신뢰 경계). */
  scope?: string;
  /** URL 원문 — 트리거로 들어왔을 때 그 id. */
  triggerId?: string;
}

/** slotKey 의 **자기 날짜**에서 슬롯을 찾는다(사용자가 보고 있던 날이 아니다). */
function slotOfKey(days: ItineraryDaysItem[], slotKey?: string | null) {
  if (!slotKey) return undefined;
  const parsed = parseSlotKey(slotKey);
  if (parsed.kind !== 'ok') return undefined;
  return days
    .find((day) => day.date === parsed.date)
    ?.slots.find((slot) => slot.poiId === parsed.poiId);
}

export function PlanbRequestPage({
  tripId,
  scope: scopeParam,
  triggerId,
}: PlanbRequestPageProps): ReactElement {
  const router = useRouter();
  const startReplan = useStartReplan();
  // 시작 실패 안내(INV-4). 여행 기간 밖이면 서버가 409 — 확정 일정은 날짜 무관 허브로 열리므로
  // (2026-09-23) 여행 전·후에도 이 요청에 닿는다.
  const [errorText, setErrorText] = useState<string | null>(null);
  const triggers = useActiveTriggers(tripId);
  const itinerary = useLiveItinerary(tripId);
  const readGpsOrigin = useReplanGpsOrigin();

  const scope = useReplanFormStore((s) => s.scope);
  const reasons = useReplanFormStore((s) => s.reasons);
  const directives = useReplanFormStore((s) => s.directives);
  const freeText = useReplanFormStore((s) => s.freeText);
  const setScope = useReplanFormStore((s) => s.setScope);
  const toggleReason = useReplanFormStore((s) => s.toggleReason);
  const toggleDirective = useReplanFormStore((s) => s.toggleDirective);
  const setFreeText = useReplanFormStore((s) => s.setFreeText);
  const resetForm = useReplanFormStore((s) => s.reset);

  const trigger = triggerId
    ? triggers.data?.triggers.find((item) => item.triggerId === triggerId)
    : undefined;
  const detectedKind =
    trigger && trigger.kind !== 'MANUAL' ? trigger.kind : undefined;
  const detected =
    trigger && detectedKind
      ? {
          label: triggerPillCopy(
            detectedKind,
            slotOfKey(itinerary.data?.days ?? [], trigger.slotKey)
          ),
          reasonKey: TRIGGER_REASON_KEY[detectedKind],
        }
      : null;
  const detectedReasonKey = detected?.reasonKey;

  // 진입 초기화 — reset 뒤 알려진 scope 만 반영한다. 아래 시드 effect 보다 먼저 선언해야 한다
  // (같은 컴포넌트의 effect 는 선언 순서대로 돈다).
  useEffect(() => {
    resetForm();
    if (scopeParam === 'FULL_DAY' || scopeParam === 'PARTIAL_SLOTS') {
      setScope(scopeParam);
    }
  }, [scopeParam, resetForm, setScope]);

  // 감지 트리거 시드 — 데이터가 도착한 첫 순간 한 번만(set 의미).
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !detectedReasonKey) return;
    seededRef.current = true;
    if (!useReplanFormStore.getState().reasons.includes(detectedReasonKey)) {
      toggleReason(detectedReasonKey);
    }
  }, [detectedReasonKey, toggleReason]);

  // GPS 를 기다리는 동안 재누름은 무시한다 — 읽기·POST 각 1회(AC-A5). mutate 를 부른 직후 풀어
  // 실패 뒤 재시도는 막지 않는다.
  const submittingRef = useRef(false);
  // GPS 를 기다리는 사이 화면이 사라지면(스크림·안드로이드 뒤로) POST 하지 않는다. 본문에서 true 로
  // 다시 세워야 StrictMode 의 실행→정리→재실행 뒤에도 false 로 굳지 않는다.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  async function handleSubmit(): Promise<void> {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setErrorText(null);
    // 이벤트 시점의 최신값을 스토어에서 직접 읽는다(렌더 클로저 stale 회피).
    const form = useReplanFormStore.getState();
    // reject 하지 않는다 — 동의 OFF·권한 없음·실패·5초 초과는 undefined(= originKind:null, BR-U4-19).
    const origin = await readGpsOrigin();
    const data = buildStartReplanRequest(
      {
        scope: form.scope,
        // 감지 칩이 숨긴 정적 "날씨"는 화면에 없으니 보내지 않는다(감지 칩 자신의 key 면 남긴다).
        reasons: form.reasons.filter(
          (key) => !detected || key !== 'WEATHER' || key === detected.reasonKey
        ),
        directives: form.directives,
        freeText: form.freeText,
        // 칩을 껐는지와 무관하게 "트리거로 들어왔다"는 사실을 싣는다(BR-U4-31).
        triggerId: detected && trigger ? trigger.triggerId : null,
      },
      origin
    );
    submittingRef.current = false;
    if (!mountedRef.current) return;
    startReplan.mutate(
      { tripId, data },
      {
        onSuccess: (session) =>
          router.replace({
            pathname: '/trips/[tripId]/planb/solving',
            params: { tripId, sessionId: session.sessionId },
          }),
        onError: (error) =>
          setErrorText(
            isAxiosError(error) && error.response?.status === 409
              ? '여행 기간에만 AI에게 맡길 수 있어요'
              : '다시 짜기를 시작하지 못했어요. 잠시 후 다시 시도해 주세요'
          ),
      }
    );
  }

  // 닫기는 한 번만 — 닫힘 애니메이션 중 스크림 재탭·끌어 닫기가 겹쳐도 뒤로 두 칸 가지 않게.
  const closingRef = useRef(false);
  function handleClose(): void {
    if (closingRef.current) return;
    closingRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace(`/trips/${tripId}/live`);
  }

  return (
    <ReplanRequestSheet
      scope={scope}
      selectedReasons={reasons}
      selectedDirectives={directives}
      freeText={freeText}
      detected={detected}
      onSelectScope={setScope}
      onToggleReason={toggleReason}
      onToggleDirective={toggleDirective}
      onChangeFreeText={setFreeText}
      onSubmit={handleSubmit}
      onClose={handleClose}
      errorText={errorText}
    />
  );
}
