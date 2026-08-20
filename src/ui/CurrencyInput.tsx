import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type InputHTMLAttributes,
} from 'react'

type CurrencyInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'inputMode' | 'onChange' | 'type' | 'value'
> & {
  valueCents: number | null
  onValueChange: (valueCents: number | null) => void
}

const CURRENCY_PATTERN = /^\d*(?:\.\d{0,2})?$/

function formatCurrencyCents(valueCents: number): string {
  return (valueCents / 100).toFixed(2)
}

function currencyTextToCents(value: string): number | null {
  if (value === '' || value === '.') return null
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.round(amount * 100) : null
}

export function CurrencyInput({
  onBlur,
  onFocus,
  onValueChange,
  valueCents,
  ...inputProps
}: CurrencyInputProps) {
  const [inputValue, setInputValue] = useState(
    valueCents === null ? '' : formatCurrencyCents(valueCents),
  )
  const editing = useRef(false)
  const lastEmittedValue = useRef<number | null>(valueCents)

  useEffect(() => {
    if (editing.current && valueCents === lastEmittedValue.current) return
    lastEmittedValue.current = valueCents
    setInputValue(valueCents === null ? '' : formatCurrencyCents(valueCents))
  }, [valueCents])

  function handleBlur(event: FocusEvent<HTMLInputElement>): void {
    editing.current = false
    const normalized = currencyTextToCents(inputValue)
    setInputValue(normalized === null ? '' : formatCurrencyCents(normalized))
    onBlur?.(event)
  }

  function handleFocus(event: FocusEvent<HTMLInputElement>): void {
    editing.current = true
    event.currentTarget.select()
    onFocus?.(event)
  }

  return (
    <input
      {...inputProps}
      inputMode="decimal"
      onBlur={handleBlur}
      onChange={(event) => {
        const nextValue = event.target.value
        if (!CURRENCY_PATTERN.test(nextValue)) return
        const nextCents = currencyTextToCents(nextValue)
        setInputValue(nextValue)
        lastEmittedValue.current = nextCents
        onValueChange(nextCents)
      }}
      onFocus={handleFocus}
      placeholder={inputProps.placeholder ?? '0.00'}
      type="text"
      value={inputValue}
    />
  )
}
