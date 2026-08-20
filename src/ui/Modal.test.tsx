import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Modal } from './Modal'

describe('Modal', () => {
  it('contains keyboard focus, closes on Escape, and restores prior focus', () => {
    const onClose = vi.fn()
    const { rerender } = render(<button type="button">打开</button>)
    const opener = screen.getByRole('button', { name: '打开' })
    opener.focus()

    rerender(
      <>
        <button type="button">打开</button>
        <Modal onClose={onClose} title="键盘测试">
          <input aria-label="第一个字段" />
          <button type="button">确认</button>
        </Modal>
      </>,
    )
    const first = screen.getByRole('textbox', { name: '第一个字段' })
    const last = screen.getByRole('button', { name: '确认' })
    expect(first).toHaveFocus()

    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
    fireEvent.keyDown(last, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()

    rerender(<button type="button">打开</button>)
    expect(screen.getByRole('button', { name: '打开' })).toHaveFocus()
  })

  it('uses an existing cancel button as the default Escape action', () => {
    const onCancel = vi.fn()
    render(
      <Modal title="默认关闭">
        <button onClick={onCancel} type="button">取消</button>
      </Modal>,
    )

    fireEvent.keyDown(screen.getByRole('button', { name: '取消' }), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
