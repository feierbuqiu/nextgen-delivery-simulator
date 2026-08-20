import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { CurrencyInput } from './CurrencyInput'

function CurrencyHarness() {
  const [valueCents, setValueCents] = useState<number | null>(null)
  return (
    <>
      <CurrencyInput
        aria-label="测试金额"
        onValueChange={setValueCents}
        valueCents={valueCents}
      />
      <output aria-label="分值">{valueCents ?? 'null'}</output>
      <button onClick={() => setValueCents(9876)} type="button">外部更新</button>
    </>
  )
}

describe('CurrencyInput', () => {
  it('keeps natural multi-digit decimal typing and stores integer cents', async () => {
    const user = userEvent.setup()
    render(<CurrencyHarness />)

    const input = screen.getByRole('textbox', { name: '测试金额' })
    await user.type(input, '125.68')
    expect(input).toHaveValue('125.68')
    expect(screen.getByLabelText('分值')).toHaveTextContent('12568')

    await user.type(input, '9')
    expect(input).toHaveValue('125.68')

    await user.clear(input)
    expect(screen.getByLabelText('分值')).toHaveTextContent('null')
    await user.type(input, '.5')
    expect(input).toHaveValue('.5')
    await user.tab()
    expect(input).toHaveValue('0.50')

    await user.click(screen.getByRole('button', { name: '外部更新' }))
    expect(input).toHaveValue('98.76')
  })
})
