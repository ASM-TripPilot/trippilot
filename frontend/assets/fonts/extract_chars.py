# src(테스트·mocks·__tests__ 제외) 의 비ASCII 문자 집합을 뽑아 stdout 으로(정렬, 개행 구분 없이 한 줄)
import os, sys
root = sys.argv[1]
chars = set()
for d, dirs, files in os.walk(root):
    dirs[:] = [x for x in dirs if x not in ('__tests__', '__mocks__', 'node_modules', 'test-support')]
    for f in files:
        if not f.endswith(('.ts', '.tsx')) or '.test.' in f: continue
        for ch in open(os.path.join(d, f), encoding='utf-8'):
            chars.update(c for c in ch if ord(c) > 0x7E)
print(''.join(sorted(chars - {'\n', '\r', '\t'})))
