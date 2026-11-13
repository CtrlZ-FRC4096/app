// Permission rules for robot photos (#164): signed-in members see every
// photo and add their own; only mentors delete them; nobody changes one.
//
// Supabase checks the rules on storage.objects before it does anything with
// a file, so these tests do what it does:
//   - add a file: a plain insert, with no "returning"
//   - open a file, or make a signed link to it: a select that must find it
//   - delete a file: a delete
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const BUCKET = 'robot-photos'
const db = setUpTestDatabase()
let scout: string
let other: string
let mentor: string

beforeEach(async () => {
  await db.sql('delete from storage.objects')
  scout = await db.member('Riley Park')
  other = await db.member('Casey Lee')
  mentor = await db.member('Pat Mentor', 'mentor')
})

const PHOTO_ID = '22222222-2222-4222-8222-222222222222'
const filePath = (id = PHOTO_ID, team = 9991) => `2026test/${team}/${id}.jpg`

/** Add a file the way Supabase's upload does. */
const upload = (person: string | null, path = filePath(), bucket = BUCKET) =>
  db.as(person, 'insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, path])

/** Find a file the way opening it, or making a signed link to it, does. */
const openFile = (person: string | null, path = filePath()) =>
  db.as(person, 'select name from storage.objects where bucket_id = $1 and name = $2', [BUCKET, path])

const deleteFile = (person: string | null, path = filePath()) =>
  db.as(person, 'delete from storage.objects where bucket_id = $1 and name = $2 returning name', [BUCKET, path])

/** Send a photo's row the way the app does: "on conflict do nothing". */
const addRow = (person: string, { id = PHOTO_ID, team = 9991, path = filePath(id, team) } = {}) =>
  db.as<{ id: string; created_by: string; taken_by: string }>(
    person,
    `insert into public.scouting_robot_photos (id, event_key, team_number, path, size_bytes, taken_by, taken_at)
     values ($1, '2026test', $2, $3, 150000, $4, now()) on conflict (id) do nothing returning *`,
    [id, team, path, person],
  )

describe('the robot photos bucket', () => {
  it('is private, up to 5 MB, and only takes JPEGs', async () => {
    const [bucket] = await db.sql<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>('select * from storage.buckets where id = $1', [BUCKET])
    expect(bucket.public).toBe(false)
    expect(Number(bucket.file_size_limit)).toBe(5 * 1024 * 1024)
    expect(bucket.allowed_mime_types).toEqual(['image/jpeg'])
  })

  it('lets a member add a photo in an event/team folder, and every member open it', async () => {
    await upload(scout)
    expect(await openFile(other)).toEqual([{ name: filePath() }])
  })

  it('refuses a file outside an event/team folder, or not named like a photo', async () => {
    for (const path of ['photo.jpg', `2026test/${PHOTO_ID}.jpg`, `2026test/9991/${PHOTO_ID}.png`, `2026test/9991/../${PHOTO_ID}.jpg`]) {
      await expect(upload(scout, path), path).rejects.toThrow(PERMISSION_DENIED)
    }
  })

  it('lets only mentors delete a photo, not even the scout who took it', async () => {
    await upload(scout)
    expect(await deleteFile(scout)).toEqual([])
    expect(await deleteFile(mentor)).toEqual([{ name: filePath() }])
  })

  it("can't be used by someone who isn't signed in, or whose access is off", async () => {
    await upload(scout)
    await expect(upload(null, filePath('33333333-3333-4333-8333-333333333333'))).rejects.toThrow(PERMISSION_DENIED)
    expect(await openFile(null).catch(() => [])).toEqual([])
    await db.switchOff(other)
    expect(await openFile(other)).toEqual([])
    await expect(upload(other, filePath('44444444-4444-4444-8444-444444444444'))).rejects.toThrow(PERMISSION_DENIED)
  })
})

describe('the scouting_robot_photos table', () => {
  it('lets a member add a photo, signed with their own id, and every member see it', async () => {
    const [row] = await addRow(scout)
    expect(row).toMatchObject({ id: PHOTO_ID, created_by: scout, taken_by: scout })
    expect(await db.as(other, 'select id from public.scouting_robot_photos')).toEqual([{ id: PHOTO_ID }])
  })

  it('skips a photo sent twice, so there is only one row', async () => {
    await addRow(scout)
    expect(await addRow(scout)).toEqual([])
    expect(await db.sql('select id from public.scouting_robot_photos')).toHaveLength(1)
  })

  it("only takes a path made of the photo's event, team and id", async () => {
    await expect(addRow(scout, { path: filePath(PHOTO_ID, 9992) })).rejects.toThrow('check constraint')
    await expect(addRow(scout, { path: `2026test/9991/${PHOTO_ID}.png` })).rejects.toThrow('check constraint')
  })

  it("doesn't let anyone send a photo as if someone else sent it", async () => {
    await expect(
      db.as(scout, "insert into public.scouting_robot_photos (id, event_key, team_number, path, size_bytes, taken_at, created_by) values ($1, '2026test', 9991, $2, 1, now(), $3)", [PHOTO_ID, filePath(), other]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't be changed by anyone, and can be deleted only by a mentor", async () => {
    await addRow(scout)
    await expect(db.as(mentor, 'update public.scouting_robot_photos set team_number = 1')).rejects.toThrow(PERMISSION_DENIED)
    expect(await db.as(scout, 'delete from public.scouting_robot_photos returning id')).toEqual([])
    expect(await db.as(mentor, 'delete from public.scouting_robot_photos returning id')).toEqual([{ id: PHOTO_ID }])
  })

  it("can't be read or added by someone who isn't signed in, or whose access is off", async () => {
    await addRow(scout)
    await expect(db.as(null, 'select * from public.scouting_robot_photos')).rejects.toThrow(PERMISSION_DENIED)
    await db.switchOff(other)
    expect(await db.as(other, 'select * from public.scouting_robot_photos')).toEqual([])
    await expect(addRow(other, { id: '55555555-5555-4555-8555-555555555555' })).rejects.toThrow(PERMISSION_DENIED)
  })
})
