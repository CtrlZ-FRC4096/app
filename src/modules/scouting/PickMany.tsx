/**
 * A row of buttons where any number can be chosen, like <Pick> but for
 * more than one. It uses Pick's look, so the forms look like one thing.
 */
export default function PickMany(props: { label: string; options: string[]; value: string[]; onChange: (value: string[]) => void }) {
  function toggle(option: string) {
    const chosen = props.value.includes(option)
    props.onChange(chosen ? props.value.filter((o) => o !== option) : [...props.value, option])
  }
  return (
    <div className="pick" role="group" aria-label={props.label}>
      {props.options.map((option) => (
        <button key={option} type="button" aria-pressed={props.value.includes(option)} onClick={() => toggle(option)}>
          {option}
        </button>
      ))}
    </div>
  )
}
