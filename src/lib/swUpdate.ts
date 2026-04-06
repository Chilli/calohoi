let doUpdate: (() => void) | undefined

export function setSwUpdater(fn: () => void) {
  doUpdate = fn
}

export function applySwUpdate() {
  doUpdate?.()
}
