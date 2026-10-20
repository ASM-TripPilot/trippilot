import { useEffect, useState } from 'react';

import type { Opportunity, Trigger } from '@/shared/api/index.schemas';
import { useGetTripsTripIdOpportunities } from '@/shared/api/index.hooks';
import { readIdSet, writeIdSet } from '@/shared/storage';

import {
  opportunityReplanHref,
  pickOpportunity,
  type OpportunityReplanHref,
} from './hubOpportunity';

/**
 * 상황 감지 FE-C · frontend-components §4.1 · §9 — 허브가 **보고 있는 날짜**의 기회 1장(소비처가 허브 하나라 슬라이스 안).
 *
 * `GET /trips/{tripId}/opportunities?date=` 를 허브 active 얼굴에서만 부른다. 자격(여행 중·남은 날·범위)은 서버가 정하고
 * 밖이면 빈 목록이다 — 빈 목록·실패·대기 중이면 카드가 없을 뿐 허브의 다른 조회와 얼굴을 막지 않는다. 고르기는
 * `pickOpportunity`(순수).
 *
 * × 숨김은 기기 로컬 편의값이다(`idSet` — 여행·날짜마다 한 칸, 값 = 그 날 숨긴 기회 key **집합**). key 하나만 두면 같은
 * 날 두 번째 ×가 첫 숨김을 지워, 날씨 위험이 풀리는 순간 닫았던 행사 카드가 되살아난다(계약 `Opportunity.key` — 숨긴
 * key 는 그 날 다시 그리지 않는다). 숨김을 읽기 전엔 카드를 그리지 않는다(숨긴 카드가 잠깐 비치지 않게). 읽기 실패는
 * 빈 집합에서 시작해 숨김 없이 그리고, 쓰기 실패는 삼킨다 — 이번 화면에선 숨긴 채로 두고 다음에 열면 다시 보인다.
 * 목록이 비면 기기 칸을 읽지 않는다.
 */

/** SecureStore 키 규칙(영숫자·`.`·`-`·`_`)에 맞는다 — 여행 id(UUID)·날짜('YYYY-MM-DD'). */
const hiddenDeviceKey = (tripId: string, date: string): string =>
  `live.opportunity.hidden.${tripId}.${date}`;

export interface HubOpportunity {
  item: Opportunity;
  /** [넣어서 다시 짜기] 목적지 — `router.push` 에 그대로 넘긴다. */
  replanHref: OpportunityReplanHref;
  /** × — 이 날 이 카드를 숨긴다(곧바로 사라지고 기기에 남긴다). */
  dismiss: () => void;
}

export function useHubOpportunities({
  tripId,
  date,
  today,
  enabled,
  triggers,
}: {
  tripId: string;
  /** 허브가 보고 있는 날짜 — active 가 아니면 ''. */
  date: string;
  /** 'YYYY-MM-DD' — 오늘이 아닌 날이면 i04 에 targetDate 를 싣는다. */
  today: string;
  /** 허브 active 얼굴일 때만. */
  enabled: boolean;
  /** 발화 중 트리거 — 아직 모르면 undefined(카드를 고르지 않는다 — 고른 뒤 바뀌지 않게). */
  triggers: readonly Trigger[] | undefined;
}): HubOpportunity | null {
  const query = useGetTripsTripIdOpportunities(
    tripId,
    { date },
    { query: { enabled: enabled && date !== '' } }
  );
  const items = query.data?.items ?? [];
  const deviceKey = hiddenDeviceKey(tripId, date);
  // 읽은 숨김(어느 칸을 읽었는지와 함께) — 칸이 바뀌면(다른 날) 다시 읽을 때까지 모르는 것으로 본다.
  const [hidden, setHidden] = useState<{
    deviceKey: string;
    keys: readonly string[];
  } | null>(null);
  const hasItems = items.length > 0;

  useEffect(() => {
    if (!hasItems) return;
    let alive = true;
    readIdSet(deviceKey).then(
      (keys) => {
        if (alive) setHidden({ deviceKey, keys });
      },
      () => {
        if (alive) setHidden({ deviceKey, keys: [] });
      }
    );
    return () => {
      alive = false;
    };
  }, [deviceKey, hasItems]);

  if (hidden?.deviceKey !== deviceKey) return null;
  const item = pickOpportunity(items, {
    date,
    triggers,
    hiddenKeys: hidden.keys,
  });
  if (item === null) return null;
  return {
    item,
    replanHref: opportunityReplanHref(tripId, item, date, today),
    dismiss: () => {
      const keys = [...hidden.keys, item.key];
      setHidden({ deviceKey, keys });
      writeIdSet(deviceKey, keys).catch(() => {
        // 기기 기억 실패 — 이번 화면에선 이미 숨겼다. 다음에 열면 다시 보인다(편의값이라 막지 않는다).
      });
    },
  };
}
