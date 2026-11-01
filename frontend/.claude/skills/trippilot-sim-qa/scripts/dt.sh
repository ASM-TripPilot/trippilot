#!/bin/bash
# 연타(더블탭) 스택 중복 검사: dt.sh '<selector>' <name>
# 60ms 연타 2회 → 그 화면의 뒤로 버튼 1회 → 처음 화면으로 돌아오면 OK.
# 판정: OK / DUP?(뒤로 1회 후에도 같은 화면 — 뒤로 버튼으로 한 번 더 세어 확정) / NO-NAV(이동 없음 — 시트·무반응) / ?
# 스크린샷은 $OUT/screenshots/dt-<name>.png (OUT 기본 = 현재 디렉토리)
OUT="${OUT:-.}"; mkdir -p "$OUT/screenshots"; sel="$1"; name="$2"
sig() { agent-device snapshot -i 2>/dev/null | grep -E '^@e[0-9]+ ' | grep -vE '스크롤 막대|application' | sed -n 1,2p | cut -c1-60 | tr '\n' ' '; }
b=$(sig)
r=$(agent-device press "$sel" --count 2 --interval-ms 60 2>&1 | head -1)
sleep 3; m=$(sig)
bk=$(agent-device snapshot -i 2>/dev/null | grep -E '^@e[0-9]+ \[(button|other)\] "[^"]*(-back|-close|뒤로|닫기)"' | head -1 | sed -E 's/^@e[0-9]+ \[[a-z]+\] "([^"]*)".*/\1/')
sleep 1
if [ -n "$bk" ]; then k=label; [[ "$bk" == *-* ]] && k=id; pr=$(agent-device press "$k=\"$bk\"" 2>&1 | head -1); how="$k $bk"
else pr=$(agent-device back --in-app 2>&1 | head -1); how="in-app"; fi
sleep 2.5; a=$(sig)
agent-device screenshot "$OUT/screenshots/dt-$name.png" >/dev/null 2>&1
echo "[$name] $r"
echo "  before: $b"; echo "  double: $m"; echo "  back1 ($how → $pr): $a"
if [ "$m" == "$b" ]; then echo "  => NO-NAV"
elif [ "$a" == "$b" ]; then echo "  => OK"
elif [ "$a" == "$m" ]; then echo "  => DUP?"; else echo "  => ?"; fi
