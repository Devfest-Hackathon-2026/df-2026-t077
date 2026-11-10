export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000',
  mocks: import.meta.env.DEV && import.meta.env.VITE_USE_MOCKS === 'true',
  scenario: import.meta.env.VITE_MOCK_SCENARIO || 'normal',
  emulators: import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true',
  googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
  areaId: import.meta.env.VITE_AREA_ID || (import.meta.env.DEV && import.meta.env.VITE_USE_MOCKS === 'true' ? 'demo-area' : ''),
}

export function checkEnvironment() {
  if (import.meta.env.PROD && (import.meta.env.VITE_USE_MOCKS === 'true' || env.emulators)) {
    throw new Error('Production requires VITE_USE_MOCKS=false and VITE_USE_FIREBASE_EMULATORS=false.')
  }
  const url = new URL(env.apiBaseUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid API URL')
  if (env.mocks && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('Development mocks require a localhost API URL.')
  }
}
