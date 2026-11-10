import { createContext } from 'react'
import type { Locale } from '../api/types'
export const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void }>({ locale: 'ja', setLocale: () => {} })
