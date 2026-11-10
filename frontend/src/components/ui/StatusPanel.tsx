import { ApiError } from '../../api/client'
import { useLocale } from '../../i18n/useLocale'
import type { MessageKey } from '../../i18n/messages'
import { messages } from '../../i18n/messages'
import { Button } from './Button'

export function StatusPanel({ loading = false, error, onRetry }: { loading?: boolean; error?: unknown; onRetry?: () => void }) {
  const { t } = useLocale()
  const key = error instanceof ApiError && error.code in messages.ja ? error.code as MessageKey : 'apiError'
  return <div className="status" role={loading ? 'status' : 'alert'}><p>{loading ? t('loading') : t(key)}</p>{!loading && onRetry && <Button onClick={onRetry}>{t('retry')}</Button>}</div>
}
