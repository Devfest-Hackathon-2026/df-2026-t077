/** Share an in-flight operation, release it on success AND failure. */
export function singleFlight<T>(operation: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined
  return () => {
    if (!pending) {
      pending = Promise.resolve().then(operation).finally(() => { pending = undefined })
    }
    return pending
  }
}
