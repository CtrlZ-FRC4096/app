import { useState } from 'react'
import { toast } from '../../core/toast'
import { Bar, PageHead, Panel } from '../../core/ui'
import { COURSES, markDone, markNotDone, progress, progressText, useDoneLessons, type Lesson } from './data'

// Big enough to tap on a phone. On a narrow screen the button goes under the
// lesson's title and fills the width.
const BIG_BUTTON = { minHeight: 52, fontSize: 16, flex: '1 1 10rem' }

// The page reads which lessons are done with a hook (useDoneLessons) and
// changes them with functions from data.ts (markDone, markNotDone). The
// lessons themselves are on the wiki: this page only links to them.
export default function TrainingPage() {
  const done = useDoneLessons()
  const counts = progress(done)

  return (
    <>
      <PageHead title="Training">
        The lessons are on the wiki. Open one, work through it, then come back and press Mark done.
      </PageHead>
      <Panel title="Your progress">
        <div className="panel-body">
          <strong style={{ fontSize: 20 }}>{progressText(done)}</strong>
          <Bar value={counts.total ? counts.done / counts.total : 0} label="Lessons done" />
        </div>
      </Panel>
      {COURSES.map((course) => {
        const courseDone = course.lessons.filter((lesson) => done.has(lesson.id)).length
        return (
          <Panel key={course.name} title={course.name} aside={<span className="note">{courseDone} of {course.lessons.length} done</span>}>
            <div className="row-list">
              {course.lessons.map((lesson) => (
                <LessonRow key={lesson.id} lesson={lesson} done={done.has(lesson.id)} />
              ))}
            </div>
          </Panel>
        )
      })}
    </>
  )
}

function LessonRow(props: { lesson: Lesson; done: boolean }) {
  const { lesson } = props
  const [saving, setSaving] = useState(false)

  async function change() {
    setSaving(true)
    const result = props.done ? await markNotDone(lesson.id) : await markDone(lesson.id)
    setSaving(false)
    if (!result.ok) toast(result.error)
  }

  return (
    // flexWrap: on a phone the button goes under the title.
    <div style={{ flexWrap: 'wrap' }}>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere', flex: '1 1 14rem', fontSize: 17 }}>
        <a href={lesson.url} target="_blank" rel="noopener noreferrer">{lesson.title} ↗</a>
      </span>
      {props.done ? (
        <span className="toolbar" style={{ flex: '1 1 12rem', justifyContent: 'flex-end' }}>
          <strong style={{ color: 'var(--ok)', fontSize: 17 }}>Done ✓</strong>
          <button type="button" className="btn btn-lg" style={{ minHeight: 52 }} disabled={saving} aria-label={`Undo: ${lesson.title}`} onClick={() => void change()}>
            {saving ? 'Undoing…' : 'Undo'}
          </button>
        </span>
      ) : (
        <span className="toolbar" style={{ flex: '1 1 12rem' }}>
          <button type="button" className="btn btn-lg btn-primary" style={BIG_BUTTON} disabled={saving} aria-label={`Mark done: ${lesson.title}`} onClick={() => void change()}>
            {saving ? 'Saving…' : 'Mark done'}
          </button>
        </span>
      )}
    </div>
  )
}
