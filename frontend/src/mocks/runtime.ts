import { env } from '../config/env'
import { fixture } from './fixtures'
import { MockTripStore } from './store'

if (!import.meta.env.DEV || !env.mocks) throw new Error('Mock store is only available in development mock mode')
// This replaces a fake server only. Production code never imports browser mock storage.
export const mockStore = new MockTripStore(fixture, sessionStorage, env.scenario)
