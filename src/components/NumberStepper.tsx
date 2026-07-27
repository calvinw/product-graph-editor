import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type NumberStepperProps = {
  value: number
  min: number
  max: number
  step: number
  onValueChange: (value: number) => void
  decrementLabel: string
  incrementLabel: string
  inputLabel: string
  disabled?: boolean
  integer?: boolean
  suffix?: string
}

export function NumberStepper({
  value,
  min,
  max,
  step,
  onValueChange,
  decrementLabel,
  incrementLabel,
  inputLabel,
  disabled = false,
  integer = false,
  suffix,
}: NumberStepperProps) {
  const precision = String(step).split(".")[1]?.length ?? 0
  const normalize = (next: number) => {
    const finite = Number.isFinite(next) ? next : min
    const stepped = integer ? Math.floor(finite) : Number(finite.toFixed(precision))
    return Math.min(max, Math.max(min, stepped))
  }
  const input = <Input
    type="number"
    min={min}
    max={max}
    step={step}
    value={value}
    disabled={disabled}
    aria-label={inputLabel}
    onChange={(event) => onValueChange(normalize(Number(event.target.value)))}
  />

  return <div className="sankey-stepper">
    <Button type="button" variant="outline" disabled={disabled} aria-label={decrementLabel} onClick={() => onValueChange(normalize(value - step))}>−</Button>
    {suffix ? <div className="sankey-number">{input}<span>{suffix}</span></div> : input}
    <Button type="button" variant="outline" disabled={disabled} aria-label={incrementLabel} onClick={() => onValueChange(normalize(value + step))}>+</Button>
  </div>
}
