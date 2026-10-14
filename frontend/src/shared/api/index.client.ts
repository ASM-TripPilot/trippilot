// 손수 짠 서버 어댑터용 진입점 — openapi 에 태그가 없어 생성 훅이 없는 경로(도우미 `/assistant/**`, TRIP-1410)를
// 생성 클라이언트와 같은 인증·timeout 규칙(`mutator.ts`)으로 부른다.

export { customInstance } from './mutator';
