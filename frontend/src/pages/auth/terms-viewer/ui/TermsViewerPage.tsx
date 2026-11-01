import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import type { ReactElement } from 'react';
import { goBackOr } from '@/shared/lib/goBackOr';

import { getGateDestination, type BootstrapDestination } from '@/features/auth';
import { termsDocumentTitle } from '@/features/onboarding';
import { TermsViewerScreen } from './TermsViewerScreen';
import { fetchTermsByType } from '@/shared/api';

// 약관은 온보딩·설정·재동의 어디서든 열린다 — 스택이 비었을 때 돌아갈 곳은 지금 게이트가 연 그룹이다
// (닫힌 그룹으로 replace 하면 조용히 버려진다. app/+not-found 와 같은 이유).
const TERMS_FALLBACK: Record<BootstrapDestination, Href> = {
  HOME: '/settings',
  ONBOARDING: '/(onboarding)/terms',
  RECONSENT: '/reconsent',
  LOGIN: '/login',
  FORCE_UPDATE: '/force-update',
};

/**
 * 약관 열람 배선(pages 층, TRIP-937) — `GET /terms/{termsType}` 를 화면에 잇는다. 온보딩·설정·재동의
 * 세 곳에서 push 로 열리고, 뒤로가기는 연 자리로 돌아간다. 실패(네트워크·404)는 오류+재시도로
 * 보인다(INV-4) — 재시도는 같은 조회를 다시 보낸다.
 */
export function TermsViewerPage({
  termsType,
}: {
  termsType: string;
}): ReactElement {
  const router = useRouter();
  const query = useQuery({
    queryKey: ['terms', termsType],
    queryFn: () => fetchTermsByType(termsType),
    // 자동 재시도 끔 — 기본(3회·지수 지연)이면 404 도 약 7초 스피너 뒤에야 오류가 뜬다. 재시도는 버튼이 맡는다.
    retry: false,
  });

  return (
    <TermsViewerScreen
      title={termsDocumentTitle(termsType)}
      status={query.isSuccess ? 'ready' : query.isError ? 'error' : 'loading'}
      body={query.data?.body ?? null}
      onPressBack={() =>
        goBackOr(router, TERMS_FALLBACK[getGateDestination() ?? 'HOME'])
      }
      onRetry={() => void query.refetch()}
    />
  );
}
