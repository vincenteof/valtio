import { proxy, subscribe, getVersion } from '../vanilla'

type DeriveGet = <T extends object>(value: T) => T

/**
 * derive
 *
 * This creates derived properties and attatches them
 * to a new proxy object or an existing proxy object.
 *
 * @example
 * import { proxy } from 'valtio'
 * import { derive } from 'valtio/utils'
 *
 * const state = proxy({
 *   count: 1,
 * })
 *
 * const derived = derive({
 *   doubled: (get) => get(state).count * 2,
 * })
 *
 * derive({
 *   tripled: (get) => get(state).count * 3,
 * }, {
 *   proxy: state,
 * })
 */
export const derive = <T extends object, U extends object>(
  derivedFns: {
    [K in keyof U]: (get: DeriveGet) => U[K]
  },
  options?: {
    proxy?: T
    sync?: boolean
    cleanupObj?: { cleanup?: () => void }
  }
) => {
  const proxyObject = (options?.proxy || proxy({})) as U
  const notifyInSync = options?.sync
  const subscriptions = new Map<
    object,
    [callbackMap: Map<keyof U, () => void>, unsubscribe: () => void]
  >()
  if (options?.cleanupObj) {
    options.cleanupObj.cleanup = () => {
      subscriptions.forEach(([, unsubscribe]) => {
        unsubscribe()
      })
      subscriptions.clear()
    }
  }
  const addSubscription = (p: object, key: keyof U, callback: () => void) => {
    const subscription = subscriptions.get(p)
    if (subscription) {
      subscription[0].set(key, callback)
    } else {
      const unsubscribe = subscribe(
        p,
        () => {
          subscriptions.get(p)?.[0].forEach((cb) => {
            cb()
          })
        },
        notifyInSync
      )
      subscriptions.set(p, [new Map([[key, callback]]), unsubscribe])
    }
  }
  const removeSubscription = (p: object, key: keyof U) => {
    const subscription = subscriptions.get(p)
    if (subscription) {
      subscription[0].delete(key)
      if (!subscription[0].size) {
        subscription[1]()
        subscriptions.delete(p)
      }
    }
  }
  ;(Object.keys(derivedFns) as (keyof U)[]).forEach((key) => {
    if (Object.getOwnPropertyDescriptor(proxyObject, key)) {
      throw new Error('object property already defined')
    }
    const fn = derivedFns[key]
    let lastDependencies: Map<object, number> | null = null
    const evaluate = () => {
      if (lastDependencies) {
        if (
          Array.from(lastDependencies).every(([p, n]) => getVersion(p) === n)
        ) {
          // no dependencies are changed
          return
        }
      }
      const dependencies = new Map<object, number>()
      const get = <P extends object>(p: P) => {
        dependencies.set(p, getVersion(p))
        return p
      }
      proxyObject[key] = fn(get)
      dependencies.forEach((_, p) => {
        if (!lastDependencies?.has(p)) {
          addSubscription(p, key, evaluate)
        }
      })
      lastDependencies?.forEach((_, p) => {
        if (!dependencies.has(p)) {
          removeSubscription(p, key)
        }
      })
      lastDependencies = dependencies
    }
    evaluate()
  })
  return proxyObject as T & U
}
