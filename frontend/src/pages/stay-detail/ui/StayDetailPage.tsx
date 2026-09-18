/**
 * e03 숙소 상세 배선(TRIP-457 · US-STAY-*). 화면·시트는 라우터·훅·Linking 을 모르므로(FSD 경계),
 * params 파싱·저장 요청·웹검색 이동·로그인 유도는 이 배선 층에서만 일어난다.
 *
 * 데이터는 손에 든 `item`(JSON param)에서 온다(계약 GET 부재, 01b Q1) — `useLocalSearchParams`로
 * 받아 `JSON.parse`한다. 파싱 실패·부재는 `null`로 접어 화면이 notFound 얼굴을 그린다(INV-4, ★F-9).
 * 저장 하트·"일정에 추가"는 `useSavedStays`(TRIP-417 토글 훅) 하나가 소유하고, 미인증은 요청 없이
 * 로그인으로 보낸다(BR-U1-03·55, 죽은 버튼 회피). "외부에서 예약하기"는 제휴 시트(BR-U1-30) →
 * [이동] 웹검색 폴백(`openStayOutbound`, BR-U1-31).
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { getAccessToken } from '@/shared/api/tokenManager';
import type { StayItem } from '@/shared/api/generated/schemas';

import { useSavedStays } from '@/features/stay/model/savedStays';
import { openStayOutbound } from '@/features/stay/model/stayOutbound';
import { stayKey } from '@/features/stay/model/stayKey';
import { OtaChoiceSheet } from '@/features/stay/ui/OtaChoiceSheet';
import { StayDetailScreen } from '@/features/stay/ui/StayDetailScreen';

/** `item` param(JSON)을 파싱한다 — 손에 든 카드 데이터가 유일한 데이터 출처(GET 계약 부재).
 * 파싱 실패·부재·**형태 불일치**는 `null`로 접는다(INV-4) → 화면이 notFound 얼굴을 그린다.
 *
 * ⚠️ `JSON.parse`는 `123`·`{}`·`[]`·`"x"` 같은 **문법상 유효하지만 StayItem이 아닌** 값도
 * 성공시킨다 — 그대로 통과하면 화면의 `item.amenities.length`에서 `undefined.length` 크래시
 * (미인증 딥링크 `stays/x?item=123`로 도달 가능, 신뢰 경계). `as StayItem` 캐스트는 tsc가 믿을
 * 뿐 런타임 보장이 아니므로, 화면이 실제로 읽는 최소 형태(객체 + amenities 배열)를 여기서 한 번
 * 검문한다(5-b 경고-1 봉합). */
function isStayItemShape(value: unknown): value is StayItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as StayItem).amenities)
  );
}

function parseItem(raw?: string | string[]): StayItem | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isStayItemShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function StayDetailPage(): ReactElement {
  const router = useRouter();
  const { item: itemParam } = useLocalSearchParams<{
    stayId?: string;
    item?: string;
  }>();
  const item = parseItem(itemParam);

  // isAuthed는 렌더 시점 1회 동기 판정(StaySearchPage·PlaceExplorePage 선례 — "판정 대기" 제3
  // 상태가 안 생긴다). 담김 판정·토글은 useSavedStays 한 곳이 소유한다.
  const isAuthed = getAccessToken() !== null;
  const { isSaved, save, remove } = useSavedStays({ isAuthed });

  const [pending, setPending] = useState(false);
  const [addedNotice, setAddedNotice] = useState(false);
  const [otaOpen, setOtaOpen] = useState(false);

  const saved = item !== null && isSaved(stayKey(item));

  // 하트 = 토글(담김이면 해제, 아니면 담기). 미인증 누름은 요청 없이 로그인으로(BR-U1-03·Q6).
  async function handleToggleSave(): Promise<void> {
    if (item === null) {
      return;
    }
    setPending(true);
    const outcome = saved ? await remove(item) : await save(item);
    setPending(false);
    if (outcome.kind === 'failed' && outcome.reason === 'unauthenticated') {
      router.push('/(auth)/login');
    }
  }

  // "일정에 추가" = 담기(거점 후보 편입) + 안내(AC-10). 미인증은 로그인 유도(죽은 버튼 아님).
  async function handleAddToTrip(): Promise<void> {
    if (item === null) {
      return;
    }
    setPending(true);
    const outcome = await save(item);
    setPending(false);
    if (outcome.kind === 'failed' && outcome.reason === 'unauthenticated') {
      router.push('/(auth)/login');
      return;
    }
    if (outcome.kind === 'saved') {
      setAddedNotice(true);
    }
  }

  // [이동] — 웹검색 폴백으로 연다(01b Q2). 성공하면 시트를 닫고, 실패하면 열어 둔 채로 남겨
  // 사용자가 재시도·취소할 수 있게 한다(침묵 금지, BR-U1-55 — 전용 실패 화면은 범위 밖).
  async function handleConfirmOutbound(): Promise<void> {
    if (item === null) {
      return;
    }
    const result = await openStayOutbound(item, () => {});
    if (result === 'web') {
      setOtaOpen(false);
    }
  }

  return (
    <>
      <StayDetailScreen
        item={item}
        saved={saved}
        pending={pending}
        addedNotice={addedNotice}
        onToggleSave={() => void handleToggleSave()}
        onPressBook={() => setOtaOpen(true)}
        onPressAddToTrip={() => void handleAddToTrip()}
        onPressBack={() => router.back()}
      />
      {otaOpen && item !== null ? (
        <OtaChoiceSheet
          item={item}
          onCancel={() => setOtaOpen(false)}
          onConfirm={() => void handleConfirmOutbound()}
        />
      ) : null}
    </>
  );
}
