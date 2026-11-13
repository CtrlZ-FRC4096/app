import { shortDate } from '../../core/format'
import { useMemberNames } from '../../core/members'
import { Panel, Pill } from '../../core/ui'
import { useTeamPhotos, type TeamPhoto } from './data'

/** One photo, as a link that opens it full size. */
function Photo(props: { photo: TeamPhoto; big?: boolean; alt: string }) {
  const { photo } = props
  const size = props.big ? { width: '100%', maxHeight: 360 } : { width: 96, height: 72 }
  if (!photo.url) {
    return (
      <span className="note" style={{ ...size, display: 'grid', placeItems: 'center', minHeight: 72, background: 'var(--surface-2)', borderRadius: 'var(--radius)' }}>
        {photo.waiting ? 'On this phone' : 'Needs a connection'}
      </span>
    )
  }
  return (
    <a href={photo.url} target="_blank" rel="noreferrer" style={{ display: 'block', flexShrink: 0 }}>
      <img src={photo.url} alt={props.alt} style={{ ...size, objectFit: props.big ? 'contain' : 'cover', borderRadius: 'var(--radius)', display: 'block', maxWidth: '100%' }} />
    </a>
  )
}

// Photos of a team's robot (#164), on the team page: the newest big at the
// top, the rest in a row below. Tap one to open it full size.
// useTeamPhotos() in data.ts finds them; this only shows them.
export default function TeamPhotos(props: { team: number }) {
  const photos = useTeamPhotos(props.team)
  const nameOf = useMemberNames()
  if (photos.length === 0) return null
  const [newest, ...rest] = photos
  return (
    <Panel title="Photos" aside={<span className="note">{`${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`}</span>}>
      <div className="panel-body">
        <Photo photo={newest} big alt={`Team ${props.team}'s robot, newest photo`} />
        <span className="note">
          {`${nameOf(newest.taken_by)} · ${shortDate(newest.taken_at)}`} {newest.waiting && <Pill tone="info">Waiting</Pill>}
        </span>
        {rest.length > 0 && (
          // Only this row scrolls sideways, never the page.
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {rest.map((photo, i) => <Photo key={photo.id} photo={photo} alt={`Team ${props.team}'s robot, photo ${i + 2}`} />)}
          </div>
        )}
      </div>
    </Panel>
  )
}
