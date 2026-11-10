import { useEffect, useRef, type ReactNode } from 'react'
import { useLocale } from '../../i18n/useLocale'
import { Button } from './Button'

export function Drawer({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const { t } = useLocale()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current!
    dialog.showModal()
    return () => { dialog.close(); previous?.focus() }
  }, [])
  return <dialog ref={ref} className="drawer" aria-modal="true" aria-labelledby="drawer-title" onCancel={(event) => { event.preventDefault(); onClose() }}><div className="drawer-header"><h2 id="drawer-title">{title}</h2><Button onClick={onClose} autoFocus>{t('close')}</Button></div>{children}</dialog>
}
