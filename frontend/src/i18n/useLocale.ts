import { useContext } from 'react'
import { LocaleContext } from './context'
import { messages, type MessageKey } from './messages'
export function useLocale() {
  const state = useContext(LocaleContext)
  return { ...state, t: (key: MessageKey) => messages[state.locale][key] }
}
