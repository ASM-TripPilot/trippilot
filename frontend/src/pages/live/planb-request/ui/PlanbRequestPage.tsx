import { useRouter } from 'expo-router';
import { goBackOr } from '@/shared/lib/goBackOr';
import { isAxiosError } from 'axios';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { parseSlotKey } from '@/entities/itinerary-slot';
import { useLiveItinerary } from '@/features/execution';
import { TRIGGER_REASON_KEY } from '../config/replanChoices';
import { buildStartReplanRequest } from '@/features/request-replan';
import { replanScopeOptions } from '@/features/request-replan';
import { useReplanFormStore } from '@/features/request-replan';
import { triggerPillCopy } from '@/features/planb';
import { useActiveTriggers } from '@/features/planb';
import { useReplanGpsOrigin } from '../model/useReplanGpsOrigin';
import { useStartReplan } from '@/features/request-replan';
import { ReplanRequestSheet } from './ReplanRequestSheet';
import type { ItineraryDaysItem } from '@/shared/api/index.schemas';

/**
 * TRIP-750 · i04 배선판. 진입 초기화 → 감지 트리거 시드 → 폼 스토어 ↔ 시트 → 빌더 → POST → 라우터.
 *
 * - 진입할 때 폼을 비우고(이전 방문 값 제거) URL scope 를 반영한다. 한 흐름에 모아 두는 이유는
 *   라우트·페이지 effect 순서에 기대지 않기 위해서다.
 * - 감지 트리거 = URL `triggerId` 와 같은 id 의 활성 트리거(MANUAL 제외). 있으면 대응 사유를 **한 번만**
 *   켠다(토글이 아니라 set — 이미 켜져 있으면 그대로). 사용자가 끈 뒤엔 다시 켜지 않는다. 그 알림이 위험일 때만 켠다
 *   (사용자 결정 2026-10-20 — 주의면 칩은 보이되 꺼져 있다. severity 가 없으면(옛 서버) 위험). 이 길은 진입 게이트가
 *   확인을 못 끝냈을 때(조회 실패·3초 초과)다 — 목록이 오기 전엔 켜지 않는다(모르면 켜지 않는다).
 * - `[AI가 다시 짜기]` → GPS origin 1회 읽기(최대 5초, 실패면 origin 없이 — 막지 않는다, TRIP-979)
 *   → body 조립(감지 트리거 id 포함) → POST → 성공 시 응답 세션 id 를 싣고 solving 으로
 *   **replace**(TRIP-752). 이 시트는 허브 위 투명 모달이라 push 로 쌓으면 solving 의 ‹ 가 요청 시트로 돌아간다.
 * - TRIP-1195 `targetDate` — 허브가 **오늘이 아닌 날**을 보는 중에 연 경우에만 온다(오늘·알림·트리거 진입은
 *   없음 = 오늘, 키도 안 싣는다). 오는 순간 범위는 `FULL_DAY` 로 고정하고(서버가 오늘 아닌 날 + PARTIAL_SLOTS 를
 *   400 으로 막는다) 칩은 "{N}일차 전체" 하나다. 현재 좌표는 읽지 않는다 — 서버가 미래일에는 그 좌표를 버리고
 *   그 날 거점에서 출발한다(수집만 하고 쓰지 않는 좌표를 만들지 않는다). 날짜 형식이 아니면 오늘로 바꿔 보내지
 *   않고 막는다(INV-4). 409 는 "아직 일정이 없는 날" 쉬운 안내 + [닫기]다(다시 눌러도 같은 결과).
 * - 스크림·끌어 닫기 → 뒤로. 뒤로 갈 곳이 없으면(딥링크·푸시 직행) 허브로 replace.
 * - 상황 감지 FE-B(frontend-components §3.3) 선택 props — 진입 게이트(`PlanbEntryGate`)·기회 카드가 준다.
 *   시드 props 가 오면(빈 배열 포함) kind 자동 시드 대신 그것을 진입 때 한 번 켠다(흐림 같은 주의에 날씨 사유를 넣으면
 *   AI 가 일정을 과하게 바꾼다 — 게이트가 빈 시드를 준다). 시드가 왔으면 body `triggerId` 는 게이트가 상세로 확인한 그 id 다
 *   (활성 목록 도착·포함과 무관 — §3.2). 시드의 날씨는 감지 칩이 날씨가 아니어도 정적 칩으로 보이고 나간다(준비 세션은
 *   같은 날 위험의 합집합 — BR-SA-18). 제외 POI 는 화면에 없고 body 에만 실린다. `prefill` 은 자유 입력
 *   초기값, `includePoiId` 는 서버에 보내지 않고 solving 라우트 파라미터로만 잇는다(i06 미포함 안내 재료).
 */

export interface PlanbRequestPageProps {
  tripId: string;
  /** URL 원문 — 'PARTIAL_SLOTS' | 'FULL_DAY' 만 반영한다(신뢰 경계). */
  scope?: string;
  /** URL 원문 — 트리거로 들어왔을 때 그 id. */
  triggerId?: string;
  /** URL 원문 — 오늘이 아닌 날을 다시 짤 때 허브가 싣는 'YYYY-MM-DD'(신뢰 경계 — 형식을 검사한다). */
  targetDate?: string;
  /** 처음 켜 둘 사유(진입 게이트 — 준비 세션 입력 또는 kind 사유, 지금 알림이 위험이 아니면(주의·모름) 빈 배열 · i06 대안 없음 — 그 세션 입력). 시드 셋 중 하나라도 오면 kind 자동 시드를 끈다. */
  seedReasons?: string[];
  /** 처음 켜 둘 지시. */
  seedDirectives?: string[];
  /** 제외 POI — 칩이 없어 화면엔 안 보이고 body 에만 실린다. */
  seedExcludedPoiIds?: string[];
  /** 자유 입력 초기값(기회 카드 `{장소명} 꼭 넣어서 다시 짜 줘`). */
  prefill?: string;
  /** 넣으려던 POI — 서버에 보내지 않고 solving → draft 라우트로 잇는다(i06 미포함 안내). */
  includePoiId?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BAD_DATE_TEXT =
  '다시 짤 날짜를 확인하지 못했어요. 일정 화면에서 다시 열어 주세요';
const NO_ITINERARY_DAY_TEXT =
  '아직 일정이 없는 날이거나 여행 기간이 아니라서 AI가 다시 짤 수 없어요';

/** slotKey 의 **자기 날짜**에서 슬롯을 찾는다(사용자가 보고 있던 날이 아니다). */
function slotOfKey(days: ItineraryDaysItem[], slotKey?: string | null) {
  if (!slotKey) return undefined;
  const parsed = parseSlotKey(slotKey);
  if (parsed.kind !== 'ok') return undefined;
  return days
    .find((day) => day.date === parsed.date)
    ?.slots.find((slot) => slot.poiId === parsed.poiId);
}

/** 진입 시드 — 처음 받은 값을 굳힌다(재렌더마다 새 배열이 와도 초기화 effect 가 다시 돌지 않게, 같은 키는 한 번). */
interface EntrySeed {
  reasons: string[];
  directives: string[];
  excludedPoiIds: string[];
}

function entrySeedOf({
  seedReasons,
  seedDirectives,
  seedExcludedPoiIds,
}: PlanbRequestPageProps): EntrySeed | null {
  if (
    seedReasons === undefined &&
    seedDirectives === undefined &&
    seedExcludedPoiIds === undefined
  ) {
    return null;
  }
  return {
    reasons: [...new Set(seedReasons ?? [])],
    directives: [...new Set(seedDirectives ?? [])],
    excludedPoiIds: [...new Set(seedExcludedPoiIds ?? [])],
  };
}

export function PlanbRequestPage(props: PlanbRequestPageProps): ReactElement {
  const {
    tripId,
    scope: scopeParam,
    triggerId,
    targetDate,
    prefill,
    includePoiId,
  } = props;
  const router = useRouter();
  const startReplan = useStartReplan();
  // 시작 실패 안내(INV-4). 여행 기간 밖이면 서버가 409 — 확정 일정은 날짜 무관 허브로 열리므로
  // (2026-09-23) 여행 전·후에도 이 요청에 닿는다.
  const [errorText, setErrorText] = useState<string | null>(null);
  const triggers = useActiveTriggers(tripId);
  const itinerary = useLiveItinerary(tripId);
  const readGpsOrigin = useReplanGpsOrigin();
  // 비어 있지 않은 값은 '다른 날을 요청받았다'다 — 형식이 틀려도 오늘로 취급하지 않는다(INV-4).
  const hasTargetDate = targetDate !== undefined && targetDate !== '';
  const validTargetDate =
    hasTargetDate && DATE_RE.test(targetDate) ? targetDate : undefined;
  const targetDayNumber = validTargetDate
    ? (itinerary.data?.days.findIndex((day) => day.date === validTargetDate) ??
      -1)
    : -1;

  const scope = useReplanFormStore((s) => s.scope);
  const reasons = useReplanFormStore((s) => s.reasons);
  const directives = useReplanFormStore((s) => s.directives);
  const freeText = useReplanFormStore((s) => s.freeText);
  const setScope = useReplanFormStore((s) => s.setScope);
  const toggleReason = useReplanFormStore((s) => s.toggleReason);
  const toggleDirective = useReplanFormStore((s) => s.toggleDirective);
  const setFreeText = useReplanFormStore((s) => s.setFreeText);
  const resetForm = useReplanFormStore((s) => s.reset);
  const [entrySeed] = useState(() => entrySeedOf(props));
  // 진입 시드에 날씨가 있으면(준비 세션은 같은 날 위험의 합집합 — BR-SA-18) 감지 칩이 날씨가 아니어도 정적 날씨 칩을
  // 남긴다. 숨기면 처음 켜 둔 사유가 화면에도 body 에도 없고, 목록 도착 전후로 요청이 갈린다.
  const keepWeatherChip = entrySeed?.reasons.includes('WEATHER') === true;

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
            slotOfKey(itinerary.data?.days ?? [], trigger.slotKey),
            { variant: trigger.variant }
          ),
          reasonKey: TRIGGER_REASON_KEY[detectedKind],
        }
      : null;
  const detectedReasonKey = detected?.reasonKey;
  // 감지 칩을 켤 만한 알림인가 — 위험일 때만(주의면 칩은 보이되 꺼져 있다). severity 가 없으면(옛 서버) 위험으로 읽는다.
  const detectedRisk = (trigger?.severity ?? 'RISK') === 'RISK';

  // 진입 초기화 — reset 뒤 알려진 scope 만 반영한다. 아래 시드 effect 보다 먼저 선언해야 한다
  // (같은 컴포넌트의 effect 는 선언 순서대로 돈다). 진입 시드·prefill 도 reset 뒤 여기서 한 번 켠다(값이 굳어 있어 다시 돌지 않는다).
  useEffect(() => {
    resetForm();
    if (hasTargetDate) {
      // 오늘이 아닌 날은 하루 전체뿐 — URL scope 는 무시한다(딥링크 조작이 PARTIAL_SLOTS 를 못 싣게).
      setScope('FULL_DAY');
    } else if (scopeParam === 'FULL_DAY' || scopeParam === 'PARTIAL_SLOTS') {
      setScope(scopeParam);
    }
    entrySeed?.reasons.forEach(toggleReason);
    entrySeed?.directives.forEach(toggleDirective);
    if (prefill) setFreeText(prefill);
  }, [
    scopeParam,
    hasTargetDate,
    resetForm,
    setScope,
    entrySeed,
    toggleReason,
    toggleDirective,
    prefill,
    setFreeText,
  ]);

  // 감지 트리거 시드 — 데이터가 도착한 첫 순간 한 번만(set 의미). 진입 시드가 왔으면 그것이 대신한다(§3.3).
  // 판정도 그 한 번이다 — 주의로 도착했으면 켜지 않고, 뒤에 심각도가 바뀌어도 다시 보지 않는다(입력 중 칩이 저절로 켜지지 않게).
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || entrySeed !== null || !detectedReasonKey) return;
    seededRef.current = true;
    if (!detectedRisk) return;
    if (!useReplanFormStore.getState().reasons.includes(detectedReasonKey)) {
      toggleReason(detectedReasonKey);
    }
  }, [entrySeed, detectedReasonKey, detectedRisk, toggleReason]);

  // GPS 를 기다리는 동안과 POST 응답을 기다리는 동안 재누름은 무시한다 — 읽기·POST 각 1회(AC-A5).
  // TRIP-1294: 서버는 새 POST 가 열린 세션을 CANCELED 로 닫는다(INV-U4-06) — 그래서 성공이면 화면을 떠날 때까지,
  // 실패면 onError 에서 풀 때까지 잠근다. 실패 뒤 재시도는 막지 않는다.
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
    if (hasTargetDate && validTargetDate === undefined) {
      setErrorText(BAD_DATE_TEXT);
      return;
    }
    submittingRef.current = true;
    setErrorText(null);
    // 이벤트 시점의 최신값을 스토어에서 직접 읽는다(렌더 클로저 stale 회피).
    const form = useReplanFormStore.getState();
    // reject 하지 않는다 — 동의 OFF·권한 없음·실패·5초 초과는 undefined(= originKind:null, BR-U4-19).
    // 미래일엔 읽지 않는다 — 서버가 그 좌표를 버린다.
    const origin = validTargetDate ? undefined : await readGpsOrigin();
    const data = buildStartReplanRequest(
      {
        // 오늘이 아닌 날은 FULL_DAY 만(서버 400) — 스토어 값이 무엇이든 여기서 못 박는다.
        scope: validTargetDate ? 'FULL_DAY' : form.scope,
        targetDate: validTargetDate,
        // 감지 칩이 숨긴 정적 "날씨"는 화면에 없으니 보내지 않는다(감지 칩 자신의 key 면 남긴다). 시드의 날씨는 보인다.
        reasons: form.reasons.filter(
          (key) =>
            !detected ||
            key !== 'WEATHER' ||
            key === detected.reasonKey ||
            keepWeatherChip
        ),
        directives: form.directives,
        freeText: form.freeText,
        // 칩을 껐는지와 무관하게 "트리거로 들어왔다"는 사실을 싣는다(BR-U4-31). 진입 게이트가 상세로 확인한 트리거
        // (시드가 왔다)는 활성 목록 도착과 무관하게 그 id 다(§3.2) — 목록 전에 누르면 빠져 소비·전날 창이 깨진다.
        triggerId:
          entrySeed !== null
            ? (triggerId ?? null)
            : detected && trigger
              ? trigger.triggerId
              : null,
        // 진입 시드의 제외 POI — 없으면 종전과 같은 빈 배열(§3.3).
        excludedPoiIds: entrySeed?.excludedPoiIds,
      },
      origin
    );
    if (!mountedRef.current) {
      submittingRef.current = false;
      return;
    }
    startReplan.mutate(
      { tripId, data },
      {
        onSuccess: (session) =>
          router.replace({
            pathname: '/trips/[tripId]/planb/solving',
            // includePoiId 는 서버가 아니라 i06 미포함 안내의 재료라 라우트로만 잇는다(§3.6).
            params: includePoiId
              ? { tripId, sessionId: session.sessionId, includePoiId }
              : { tripId, sessionId: session.sessionId },
          }),
        onError: (error) => {
          // 잠금은 실패에서만 푼다 — 성공 뒤엔 진행 화면으로 넘어가는 동안에도 잠가 둔다(5-b 경고-1: 전환 중
          // 재누름이 두 번째 POST 로 방금 연 세션을 CANCELED 로 닫는다, INV-U4-06).
          submittingRef.current = false;
          const conflict =
            isAxiosError(error) && error.response?.status === 409;
          setErrorText(
            conflict
              ? validTargetDate
                ? NO_ITINERARY_DAY_TEXT
                : '여행 기간에만 AI에게 맡길 수 있어요'
              : '다시 짜기를 시작하지 못했어요. 잠시 후 다시 시도해 주세요'
          );
        },
      }
    );
  }

  // 닫기는 한 번만 — 닫힘 애니메이션 중 스크림 재탭·끌어 닫기가 겹쳐도 뒤로 두 칸 가지 않게.
  const closingRef = useRef(false);
  function handleClose(): void {
    if (closingRef.current) return;
    closingRef.current = true;
    goBackOr(router, `/trips/${tripId}/live`);
  }

  return (
    <ReplanRequestSheet
      scope={validTargetDate ? 'FULL_DAY' : scope}
      scopeOptions={
        validTargetDate
          ? replanScopeOptions({
              dayNumber: targetDayNumber >= 0 ? targetDayNumber + 1 : null,
            })
          : undefined
      }
      selectedReasons={reasons}
      selectedDirectives={directives}
      freeText={freeText}
      detected={detected}
      keepWeatherChip={keepWeatherChip}
      onSelectScope={setScope}
      onToggleReason={toggleReason}
      onToggleDirective={toggleDirective}
      onChangeFreeText={setFreeText}
      onSubmit={handleSubmit}
      submitting={startReplan.isPending || startReplan.isSuccess}
      onClose={handleClose}
      errorText={errorText}
      onCloseError={
        errorText === NO_ITINERARY_DAY_TEXT ? handleClose : undefined
      }
    />
  );
}
