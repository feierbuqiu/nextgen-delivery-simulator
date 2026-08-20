import { useState, type FormEvent } from 'react'

import {
  APPOINTMENT_SOURCE_OPTIONS,
  queryAppointmentOrder,
  type AppointmentOrder,
} from '../../domain/service/appointmentCollection'
import type {
  ServiceAppointmentSource,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

interface AppointmentCollectionModalProps {
  onCancel: () => void
  onSelect: (order: AppointmentOrder) => Promise<void>
  workspace: ServiceWorkspaceState
}

export function AppointmentCollectionModal({
  onCancel,
  onSelect,
  workspace,
}: AppointmentCollectionModalProps) {
  const [source, setSource] =
    useState<ServiceAppointmentSource>('online-reservation')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const customerSelfService = source === 'customer-self-service'

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (busy) return
    try {
      setBusy(true)
      setError('')
      const order = queryAppointmentOrder(workspace, source, query)
      await onSelect(order)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '预约信息查询失败。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      description="选择预约来源，录入预约单号或联系电话后查询。"
      eyebrow="综合受理"
      title="预约收寄"
    >
      <form className="modal-form appointment-collection-form" onSubmit={(event) => void submit(event)}>
        <fieldset className="appointment-source-options">
          <legend>预约来源</legend>
          {APPOINTMENT_SOURCE_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                checked={source === option.value}
                name="appointment-source"
                onChange={() => {
                  setSource(option.value)
                  setQuery('')
                  setError('')
                }}
                type="radio"
                value={option.value}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="appointment-query-field">
          <span>{customerSelfService ? '预约单号' : '预约单号/电话'}</span>
          <input
            aria-label={customerSelfService ? '预约单号' : '预约单号或电话'}
            autoFocus
            onChange={(event) => {
              setQuery(event.target.value)
              setError('')
            }}
            placeholder={customerSelfService
              ? '扫描预约单号或邮件条码'
              : '请输入预约单号或联系电话'}
            value={query}
          />
        </label>

        {error ? <p className="customer-form-error" role="alert">{error}</p> : null}

        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel} type="button">
            取消
          </button>
          <button className="primary-button primary-button--compact" disabled={busy} type="submit">
            {busy ? '正在查询…' : '查询'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
