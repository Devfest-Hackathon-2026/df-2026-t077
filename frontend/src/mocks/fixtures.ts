const files = import.meta.glob('../../../contracts/fixtures/v3/*.json', { eager: true, import: 'default' })
export function fixture<T>(name: string): T {
  const value = files[`../../../contracts/fixtures/v3/${name}`]
  if (!value) throw new Error(`Missing validated fixture: ${name}`)
  return structuredClone(value) as T
}
