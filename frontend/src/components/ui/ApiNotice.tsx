import { ApiError } from '../../api/client'
import { messages, type MessageKey } from '../../i18n/messages'
import { useLocale } from '../../i18n/useLocale'

export function ApiNotice({ error }: { error: unknown }) {
  const { t } = useLocale()
  const code = error instanceof ApiError ? error.code : ''
  const key: MessageKey = Object.hasOwn(messages.ja, code) ? code as MessageKey : 'requestFailed'
  return <div role="alert" className="notice"><p>{t(key)}</p>{error instanceof ApiError && error.requestId && <small>ID: {error.requestId}</small>}</div>
}
