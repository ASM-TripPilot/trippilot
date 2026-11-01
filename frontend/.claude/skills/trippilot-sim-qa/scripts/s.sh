#!/bin/bash
# 요약 스냅샷: 스크롤막대 노이즈 빼고 라벨만. s.sh [줄수]
agent-device snapshot -i 2>&1 | grep -E '^ *@e[0-9]+|Bundling|Error|error|Warning' | grep -vE '스크롤 막대' | cut -c1-110 | head -${1:-60}
