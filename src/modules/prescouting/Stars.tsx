import { useEffect, useState, type ReactNode } from 'react'
import { useMemberNames } from '../../core/members'
import { useSession } from '../../core/session'
import { toast } from '../../core/toast'
import { MAX_STAR_REASON, canRemoveStar, starTeam, starsFor, unstarTeam, useStars, type PrescoutStar } from './data'

// Big enough to tap, and 16px text so phones don't zoom in on the box.
const BOX = { minHeight: 46, fontSize: 16 }

/** Height of the red minus square that removes a star: about the same as the 14px text beside it. */
const REMOVE_SIZE = 20
/** Invisible room around the square that still counts as tapping it, so it's easy to hit on a phone (20 + 2 × 8 = 36px). */
const TAP_ROOM = 8
/** About how wide "− Remove" is (68px, with a little to spare), to tell whether it fits to the right. */
const REMOVE_LABEL_WIDTH = 72

/**
 * A team's stars, and a Star button that opens a small Star window in
 * its place, pushing the rest of the team's box down to make room (#118). Team
 * stars show their reason and who starred them; your own star just for you
 * says only you see it. A red minus square after the name removes a star
 * you may remove. Used on the Prescouting cards and team pages, and on
 * Scouting's team page, so a star in either place shows in both.
 * Everything it saves goes through starTeam() and unstarTeam() in data.ts.
 */
export default function Stars(props: { event: string; team: number }) {
  const me = useSession()
  const stars = starsFor(useStars(props.event), props.team, me.id)
  const nameOf = useMemberNames()
  const [choosing, setChoosing] = useState(false)
  const mineForTeam = stars.forTeam.some((s) => s.created_by === me.id)
  const canStar = !mineForTeam || !stars.mine
  const lines = [...stars.forTeam, ...(stars.mine ? [stars.mine] : [])]

  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
      {lines.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6, fontSize: 14 }}>
          {lines.map((s) => (
            <StarLine
              key={s.id}
              star={s}
              name={s.for_team ? `— ${s.created_by ? nameOf(s.created_by) : 'from before stars'}` : `(only you see it)${s.reason ? `: ${s.reason}` : ''}`}
            >
              {s.for_team ? <>★ <strong>Team star:</strong> {s.reason}</> : <>☆ <strong>Your star</strong></>}
            </StarLine>
          ))}
        </ul>
      )}
      {choosing ? (
        <StarWindow event={props.event} team={props.team} done={() => setChoosing(false)} />
      ) : (
        canStar && (
          <div className="toolbar">
            <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setChoosing(true)}>☆ Star</button>
          </div>
        )
      )}
    </div>
  )
}

/**
 * One star, with a red minus square right after the name if this person may
 * remove it. Pointing at the square (or reaching it with the keyboard) shows
 * the word Remove in it; phones have no pointer, so it stays a minus there.
 */
function StarLine(props: { star: PrescoutStar; name: string; children: ReactNode }) {
  const me = useSession()
  const [busy, setBusy] = useState(false)
  const [pointedAt, setPointedAt] = useState(false)
  // Whether "− Remove" widens to the left, because it wouldn't fit in the team's box to the right.
  const [growLeft, setGrowLeft] = useState(false)
  function point(button: HTMLElement) {
    const square = button.getBoundingClientRect().left + TAP_ROOM
    const edge = button.closest('li')?.getBoundingClientRect().right ?? window.innerWidth
    setGrowLeft(edge - square < REMOVE_LABEL_WIDTH)
    setPointedAt(true)
  }
  async function remove() {
    setBusy(true)
    const result = await unstarTeam(props.star.id)
    setBusy(false)
    if (!result.ok) toast(result.error)
  }
  return (
    <li style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      {props.children}{' '}
      {/* The name and the minus never split onto two lines: if they don't fit, both move down. */}
      <span style={{ whiteSpace: 'nowrap' }}>
      <span className="muted">{props.name}</span>
      {canRemoveStar(props.star, me) && (
        <button
          type="button"
          aria-label={props.star.for_team ? 'Remove this team star' : 'Remove your star'}
          disabled={busy}
          onClick={() => void remove()}
          onMouseEnter={(e) => point(e.currentTarget)}
          onMouseLeave={() => setPointedAt(false)}
          onFocus={(e) => point(e.currentTarget)}
          onBlur={() => setPointedAt(false)}
          // The button is the tap area: see-through, with TAP_ROOM all round. The
          // negative margins take that room back, so the line isn't any taller
          // and the square sits 6px after the name.
          style={{
            padding: TAP_ROOM, margin: `-${TAP_ROOM}px -${TAP_ROOM}px -${TAP_ROOM}px ${6 - TAP_ROOM}px`,
            border: 0, background: 'none', cursor: 'pointer', verticalAlign: 'middle', lineHeight: 1,
          }}
        >
          {/* The red square you see. */}
          <span
            aria-hidden="true"
            style={{
              position: 'relative', width: REMOVE_SIZE, height: REMOVE_SIZE, boxSizing: 'border-box',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid var(--crit)', background: 'var(--crit-bg)', color: 'var(--crit)', borderRadius: 4, fontWeight: 700, fontSize: 16,
            }}
          >
            −
            {/*
              Pointed at, the red box widens to "− Remove", to the right. It floats
              over the line instead of pushing it, so nothing moves out from under
              the pointer. Too near the right edge of the team's box, it widens to the left.
            */}
            {pointedAt && (
              <span
                style={{
                  position: 'absolute', top: -1, height: REMOVE_SIZE, zIndex: 2, whiteSpace: 'nowrap', boxSizing: 'border-box',
                  ...(growLeft ? { right: -1 } : { left: -1 }),
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 6px',
                  border: '1px solid var(--crit)', background: 'var(--crit-bg)', color: 'var(--crit)', borderRadius: 4,
                }}
              >
                {/* The minus stays over the square: first when it widens right, last when it widens left. */}
                {growLeft && <span style={{ fontSize: 12 }}>Remove</span>}
                <span style={{ fontSize: 16 }}>−</span>
                {!growLeft && <span style={{ fontSize: 12 }}>Remove</span>}
              </span>
            )}
          </span>
        </button>
      )}
      </span>
    </li>
  )
}

/**
 * The Star window, titled "Star": a small box inside the team's space, where
 * the Star button was. It asks who sees the star, with a button for each.
 * For the whole team then asks why. Escape or Close shuts it without starring.
 */
function StarWindow(props: { event: string; team: number; done: () => void }) {
  const { done } = props
  const me = useSession()
  const stars = starsFor(useStars(props.event), props.team, me.id)
  const justForMe = !stars.mine
  const forTeam = !stars.forTeam.some((s) => s.created_by === me.id)
  const [askingWhy, setAskingWhy] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const titleId = `star-title-${props.team}`
  const reasonId = `star-reason-${props.team}`

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [done])

  async function star(teamStar: boolean) {
    setBusy(true)
    const result = await starTeam(props.event, props.team, { forTeam: teamStar, reason: teamStar ? reason : '' })
    setBusy(false)
    if (!result.ok) return toast(result.error)
    toast(teamStar ? `Starred team ${props.team} for the whole team.` : `Starred team ${props.team}, just for you.`)
    done()
  }

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--surface-2)', padding: 10, display: 'grid', gap: 10, minWidth: 0 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 id={titleId} style={{ margin: 0, flex: 1, fontSize: 17 }}>☆ Star</h3>
        <button type="button" className="btn btn-sm" style={{ minHeight: 40 }} onClick={done}>Close</button>
      </div>

      {askingWhy ? (
        <form style={{ display: 'grid', gap: 8 }} onSubmit={(e) => { e.preventDefault(); void star(true) }}>
          <label className="field" htmlFor={reasonId} style={{ color: 'var(--ink)' }}>
            Why should the team look at them? Everyone sees this, with your name.
            <textarea
              id={reasonId}
              className="input"
              style={BOX}
              rows={2}
              maxLength={MAX_STAR_REASON}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Fast, reliable auto. Good second pick."
            />
          </label>
          <div className="toolbar">
            <button type="submit" className="btn btn-primary" style={{ minHeight: 44 }} disabled={busy}>Star for the whole team</button>
            <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setAskingWhy(false)}>Back</button>
          </div>
        </form>
      ) : (
        <div style={{ display: 'grid', gap: 6 }} role="group" aria-label="Who sees this star?">
          <span style={{ fontSize: 14, fontWeight: 600 }}>Who sees this star?</span>
          <div className="toolbar" style={{ gap: 8 }}>
            <Choice
              title="Just for me"
              detail={justForMe ? 'Only you' : 'Already starred'}
              disabled={!justForMe || busy}
              focus={justForMe}
              onClick={() => void star(false)}
            />
            <Choice
              title="For the whole team"
              detail={forTeam ? 'Everyone, with a reason' : 'Already starred'}
              disabled={!forTeam}
              focus={!justForMe && forTeam}
              onClick={() => setAskingWhy(true)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/** One choice in the Star window: a title, and a few words on who sees it. Side by side when there's room. */
function Choice(props: { title: string; detail: string; disabled: boolean; focus: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn"
      style={{ flex: '1 1 130px', minHeight: 56, padding: '8px 12px', display: 'grid', justifyItems: 'start', justifyContent: 'start', gap: 0, textAlign: 'left' }}
      disabled={props.disabled}
      // The window opens where the Star button was, so put the keyboard in it.
      autoFocus={props.focus}
      onClick={props.onClick}
    >
      <strong style={{ fontSize: 15 }}>{props.title}</strong>
      <span className="note">{props.detail}</span>
    </button>
  )
}
