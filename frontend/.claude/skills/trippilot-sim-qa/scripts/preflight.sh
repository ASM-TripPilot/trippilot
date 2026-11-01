#!/bin/bash
# QA 시작 전 점검: 도구·시뮬·Metro 출처·백엔드·앱 세션. preflight.sh <frontend 경로>
FE="${1:-$PWD}"
echo "== agent-device: $(agent-device --version 2>&1 | head -1)"
UDID=$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1); echo "== booted sim: ${UDID:-없음}"
P=$(lsof -ti :8081 -sTCP:LISTEN | head -1)
FAIL=0
if [ -n "$P" ]; then
  MCWD=$(lsof -a -p $P -d cwd -Fn | grep ^n | cut -c2-); echo "== Metro cwd: $MCWD"
  # 낡은 번들로 오판하는 세 경우는 실패시킨다(실측 8건, 상세는 하네스 변경이력) — 고치는 법: lsof -ti :8081 -sTCP:LISTEN | xargs kill 후 이 워크트리에서 감시 켠 채(CI 없이) expo start --clear
  case "$MCWD" in "$(cd "$FE" && pwd -P)"*|"$FE"*) ;; *) echo "!! Metro가 다른 폴더 코드를 서빙 중 (대상 $FE) — 도커가 8081을 쥔 경우는 SKILL §2 8082 우회"; FAIL=1;; esac
  ps eww -p $P 2>/dev/null | grep -qE '(^| )CI=(1|true)( |$)' && { echo "!! Metro가 CI=1로 떠 있다 — 파일 감시가 꺼져 편집이 안 보인다"; FAIL=1; }
  MSTART=$(date -j -f "%a %b %d %T %Y" "$(ps -o lstart= -p $P)" +%s 2>/dev/null)
  NEWEST=$(find "$FE/app" -type f -newermt "@$MSTART" 2>/dev/null | head -1)
  [ -n "$MSTART" ] && [ -n "$NEWEST" ] && { echo "!! Metro 시작 뒤 라우트 파일이 생겼다($NEWEST) — 감시가 늦게 알아 화면이 안 바뀔 수 있다 → --clear로 재기동"; FAIL=1; }
else echo "!! Metro: 꺼짐 → (cd $FE && LANG=en_US.UTF-8 pnpm start) 백그라운드로"; FAIL=1; fi
echo "== branch: $(git -C "$FE" branch --show-current)  dirty: $(git -C "$FE" status --short | wc -l | tr -d ' ')"
echo "== backend: $(curl -s -m3 -o /dev/null -w %{http_code} localhost:8080/actuator/health)  ai: $(curl -s -m3 localhost:8000/health)"
echo "== docker: $(docker ps --format '{{.Names}}' 2>/dev/null | tr '\n' ' ')"
[ $FAIL -eq 0 ] && echo "== preflight OK" || { echo "== preflight FAIL — 위 !! 줄을 고친 뒤 다시 돌린다"; exit 1; }
