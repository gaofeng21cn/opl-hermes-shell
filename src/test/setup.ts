class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(String(key)) ?? null
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(String(key))
  }

  setItem(key: string, value: string) {
    this.values.set(String(key), String(value))
  }
}

function readWindowLocalStorage() {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

const storage = readWindowLocalStorage() ?? new MemoryStorage()

for (const target of [window, globalThis] as const) {
  try {
    Object.defineProperty(target, 'localStorage', {
      configurable: true,
      enumerable: true,
      value: storage
    })
  } catch {
    // Some environments expose a non-configurable localStorage; keep it.
  }
}
