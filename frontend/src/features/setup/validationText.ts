import { planningMessages, type PlanningMessageKey } from '../../i18n/planningMessages'
import type { MessageKey } from '../../i18n/messages'

export function validationText(message: string | undefined, t: (key: MessageKey) => string) {
  return message && Object.hasOwn(planningMessages.ja, message) ? t(message as PlanningMessageKey) : t('invalidValue')
}
