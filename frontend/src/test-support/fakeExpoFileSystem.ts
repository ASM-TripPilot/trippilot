/**
 * `expo-file-system`(새 API — `File`·`Directory`·`Paths`) 메모리 대역. jest 에는 실제 파일 쓰기가 없어서
 * (jest-expo 네이티브 목은 쓰기를 흉내 내지 않는다) 쓰고·지우고·목록을 보는 동작을 메모리에서 흉내 낸다.
 *
 * 사용: `jest.mock('expo-file-system', () => require('@/test-support/fakeExpoFileSystem').fakeExpoFileSystemModule);`
 * 상태는 모듈 싱글턴이다 — 소비 파일 **최상위** `afterEach` 에서 `resetFakeFs()` 를 부른다.
 *
 * 의미는 iOS 네이티브 구현(`node_modules/expo-file-system/ios/FileSystem{File,Directory,Path}.swift`)을 따른다:
 *  - `File.write` 는 파일이 없으면 만들지만 **부모 폴더가 없으면 던진다**.
 *  - `File.create` 는 이미 있으면 던진다(`overwrite: true` 면 비우고 다시 만든다).
 *  - `Directory.create` 는 이미 있으면 던진다 — `idempotent`·`overwrite` 면 그대로 둔다(**안을 비우지 않는다**).
 *  - `delete()`·`list()` 는 없는 경로에서 던진다. 폴더 `delete()` 는 안의 것까지 지운다.
 * 흉내 내는 범위: `Paths.cache`·`Paths.document` · `Directory`(uri·name·exists·create·delete·list·createFile) ·
 * `File`(uri·name·exists·create·write·text·textSync·delete). 이 밖의 API 는 없다(부르면 TypeError).
 */

const CACHE_PATH = 'file:///cache';
/** TRIP-1601 — 앱 샌드박스 문서 폴더(iOS 는 앱을 지우면 같이 지워진다 — 키체인과 다르다). */
const DOCUMENT_PATH = 'file:///document';

type FakeState = {
  dirs: Set<string>;
  files: Map<string, string>;
  writeError: Error | null;
  readError: Error | null;
};

const state: FakeState = {
  dirs: new Set([CACHE_PATH, DOCUMENT_PATH]),
  files: new Map(),
  writeError: null,
  readError: null,
};

type UriPart = string | { uri: string };

function joinPath(parts: UriPart[]): string {
  const raw = parts.map((part) => (typeof part === 'string' ? part : part.uri));
  const [first = '', ...rest] = raw;
  let joined = first.replace(/\/+$/, '');
  for (const segment of rest) {
    joined = `${joined}/${segment.replace(/^\/+|\/+$/g, '')}`;
  }
  return joined;
}

const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/'));
const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

function makeDirs(path: string): void {
  if (path === CACHE_PATH || path === DOCUMENT_PATH || state.dirs.has(path))
    return;
  makeDirs(parentOf(path));
  state.dirs.add(path);
}

class FakeDirectory {
  readonly uri: string;
  private readonly path: string;

  constructor(...parts: UriPart[]) {
    this.path = joinPath(parts);
    this.uri = `${this.path}/`;
  }

  get name(): string {
    return nameOf(this.path);
  }

  get exists(): boolean {
    return state.dirs.has(this.path);
  }

  create(
    options: {
      intermediates?: boolean;
      idempotent?: boolean;
      overwrite?: boolean;
    } = {}
  ): void {
    if (state.files.has(this.path)) {
      throw new Error(`a file exists at ${this.uri}`);
    }
    if (this.exists) {
      if (options.idempotent || options.overwrite) return;
      throw new Error(`directory already exists: ${this.uri}`);
    }
    if (!state.dirs.has(parentOf(this.path))) {
      if (!options.intermediates) {
        throw new Error(`parent directory missing: ${this.uri}`);
      }
      makeDirs(parentOf(this.path));
    }
    state.dirs.add(this.path);
  }

  delete(): void {
    if (!this.exists) throw new Error(`path does not exist: ${this.uri}`);
    const prefix = `${this.path}/`;
    for (const dir of [...state.dirs]) {
      if (dir === this.path || dir.startsWith(prefix)) state.dirs.delete(dir);
    }
    for (const file of [...state.files.keys()]) {
      if (file.startsWith(prefix)) state.files.delete(file);
    }
  }

  list(): (FakeDirectory | FakeFile)[] {
    if (!this.exists) throw new Error(`path does not exist: ${this.uri}`);
    const children: (FakeDirectory | FakeFile)[] = [];
    for (const dir of state.dirs) {
      if (parentOf(dir) === this.path) children.push(new FakeDirectory(dir));
    }
    for (const file of state.files.keys()) {
      if (parentOf(file) === this.path) children.push(new FakeFile(file));
    }
    return children;
  }

  createFile(name: string, _mimeType: string | null): FakeFile {
    const file = new FakeFile(this, name);
    file.create();
    return file;
  }
}

class FakeFile {
  readonly uri: string;
  private readonly path: string;

  constructor(...parts: UriPart[]) {
    this.path = joinPath(parts);
    this.uri = this.path;
  }

  get name(): string {
    return nameOf(this.path);
  }

  get exists(): boolean {
    if (state.readError) throw state.readError;
    return state.files.has(this.path);
  }

  create(options: { intermediates?: boolean; overwrite?: boolean } = {}): void {
    if (this.exists && !options.overwrite) {
      throw new Error(`file already exists: ${this.uri}`);
    }
    if (!state.dirs.has(parentOf(this.path))) {
      if (!options.intermediates) {
        throw new Error(`parent directory missing: ${this.uri}`);
      }
      makeDirs(parentOf(this.path));
    }
    state.files.set(this.path, '');
  }

  write(content: string | Uint8Array): void {
    if (state.writeError) throw state.writeError;
    if (!state.dirs.has(parentOf(this.path))) {
      throw new Error(`parent directory missing: ${this.uri}`);
    }
    state.files.set(
      this.path,
      typeof content === 'string'
        ? content
        : Buffer.from(content).toString('utf8')
    );
  }

  textSync(): string {
    if (state.readError) throw state.readError;
    const text = state.files.get(this.path);
    if (text === undefined) throw new Error(`file missing: ${this.uri}`);
    return text;
  }

  text(): Promise<string> {
    try {
      return Promise.resolve(this.textSync());
    } catch (error) {
      return Promise.reject(error);
    }
  }

  delete(): void {
    if (!this.exists) throw new Error(`path does not exist: ${this.uri}`);
    state.files.delete(this.path);
  }
}

const FakePaths = {
  get cache(): FakeDirectory {
    return new FakeDirectory(CACHE_PATH);
  },
  get document(): FakeDirectory {
    return new FakeDirectory(DOCUMENT_PATH);
  },
};

export const fakeExpoFileSystemModule = {
  __esModule: true,
  File: FakeFile,
  Directory: FakeDirectory,
  Paths: FakePaths,
};

/** 캐시·문서 폴더만 남기고 전부 비운다(읽기·쓰기 실패 주입도 끈다). */
export function resetFakeFs(): void {
  state.dirs = new Set([CACHE_PATH, DOCUMENT_PATH]);
  state.files = new Map();
  state.writeError = null;
  state.readError = null;
}

/** 캐시 아래 `dirName` 폴더에 파일 하나를 미리 둔다(이전 실행이 남긴 파일 흉내). */
export function seedCacheFile(
  dirName: string,
  name: string,
  text: string
): void {
  makeDirs(`${CACHE_PATH}/${dirName}`);
  state.files.set(`${CACHE_PATH}/${dirName}/${name}`, text);
}

/** 캐시 아래 `dirName` 폴더 바로 안의 파일들(이름순). 폴더가 없으면 빈 배열. */
export function cacheFilesIn(
  dirName: string
): { name: string; uri: string; text: string }[] {
  const dir = `${CACHE_PATH}/${dirName}`;
  return [...state.files.entries()]
    .filter(([path]) => parentOf(path) === dir)
    .map(([path, text]) => ({ name: nameOf(path), uri: path, text }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** 캐시 전체에 있는 파일 수 — "아무것도 안 썼다"를 폴더 이름과 무관하게 잰다. */
export function cacheFileCount(): number {
  return state.files.size;
}

/** 이후 모든 `File.write` 가 이 오류로 던진다(디스크 가득 참 흉내). `resetFakeFs()` 로 끈다. */
export function failFileWrites(error: Error = new Error('disk full')): void {
  state.writeError = error;
}

/** 문서 폴더 아래(하위 폴더 포함) 파일 수 — 앱 샌드박스에 기록이 남았는지 잰다(TRIP-1601 "봤음" 기록). */
export function documentFileCount(): number {
  return [...state.files.keys()].filter((path) =>
    path.startsWith(`${DOCUMENT_PATH}/`)
  ).length;
}

/** 이후 모든 `File.exists`·`text`·`textSync` 가 이 오류로 던진다. `resetFakeFs()` 로 끈다. */
export function failFileReads(error: Error = new Error('read failed')): void {
  state.readError = error;
}
