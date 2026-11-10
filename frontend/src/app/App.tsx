import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import type { Locale } from '../api/types'
import { ApiError } from '../api/client'
import { LocaleContext } from '../i18n/context'
import { router } from './router'
import { ErrorBoundary } from './ErrorBoundary'
import { AuthGate } from '../auth/AuthGate'
import { readUiLocale, saveUiLocale } from '../lib/uiLocale'

const queryClient = new QueryClient({ defaultOptions: {
  queries: { staleTime: 30_000, retry: (count, error) => count < 1 && (!(error instanceof ApiError) || error.status >= 500) },
  mutations: { retry: false },
} })
export function App() {
  const [locale, setLocale] = useState<Locale>(readUiLocale)
  useEffect(() => { document.documentElement.lang = locale; saveUiLocale(locale) }, [locale])
  return <ErrorBoundary><LocaleContext.Provider value={{ locale, setLocale }}><QueryClientProvider client={queryClient}><AuthGate><RouterProvider router={router} /></AuthGate></QueryClientProvider></LocaleContext.Provider></ErrorBoundary>
}
