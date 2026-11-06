// Permission rules for receipts in Purchasing (#79). Receipts can show card
// digits and addresses: only mentors, admins and purchasers add, open and
// delete them, and everyone can see that an item has one.
//
// Supabase checks the rules on storage.objects before it does anything with
// a file, so these tests do what it does:
//   - add a file: a plain insert, with no "returning"
//   - open a file, or make a signed link to it: a select that must find it
//   - delete a file: a delete
import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_DENIED, setUpTestDatabase } from './database'

const BUCKET = 'purchase-receipts'
const db = setUpTestDatabase()
let student: string
let buyer: string
let mentor: string
let admin: string
let itemId: string

beforeEach(async () => {
  await db.sql('delete from storage.objects')
  student = await db.member('Riley Park')
  buyer = await db.member('Casey Lee')
  mentor = await db.member('Pat Mentor', 'mentor')
  admin = await db.member('Morgan Admin', 'admin')
  await db.as(mentor, 'insert into public.purchasing_buyers (member_id) values ($1)', [buyer])
  const [item] = await db.as<{ id: string }>(student, "insert into public.purchase_items (name, vendor, type, quantity) values ('Belt', 'Amazon', 'Drive Base', 2) returning id")
  itemId = item.id
})

const FILE_ID = '11111111-1111-4111-8111-111111111111'
const filePath = (name = `${FILE_ID}.pdf`) => `${itemId}/${name}`

/** Add a file the way Supabase's upload does. */
const upload = (person: string | null, path = filePath(), bucket = BUCKET) =>
  db.as(person, 'insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, path])

/** Find a file the way opening it, or making a signed link to it, does. */
const openFile = (person: string | null, path = filePath()) =>
  db.as(person, 'select name from storage.objects where bucket_id = $1 and name = $2', [BUCKET, path])

const deleteFile = (person: string | null, path = filePath()) =>
  db.as(person, 'delete from storage.objects where bucket_id = $1 and name = $2 returning name', [BUCKET, path])

const addRow = (person: string, path = filePath()) =>
  db.as<{ id: string; created_by: string }>(
    person,
    "insert into public.purchase_receipts (item_id, path, content_type, size_bytes) values ($1, $2, 'application/pdf', 1000) returning *",
    [itemId, path],
  )

describe('the receipts bucket', () => {
  it('is private, up to 10 MB, and only takes PDFs and photos', async () => {
    const [bucket] = await db.sql<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>('select * from storage.buckets where id = $1', [BUCKET])
    expect(bucket.public).toBe(false)
    expect(Number(bucket.file_size_limit)).toBe(10 * 1024 * 1024)
    expect(bucket.allowed_mime_types).toContain('application/pdf')
    expect(bucket.allowed_mime_types).toContain('image/jpeg')
  })

  it('takes no SVG images or wildcards, which could run code when opened', async () => {
    const [bucket] = await db.sql<{ allowed_mime_types: string[] }>('select * from storage.buckets where id = $1', [BUCKET])
    expect(bucket.allowed_mime_types.filter((t) => t.includes('svg') || t.includes('*'))).toEqual([])
  })
})

describe('opening a receipt', () => {
  beforeEach(() => upload(mentor))

  it('works for mentors, admins and purchasers', async () => {
    expect(await openFile(mentor)).toHaveLength(1)
    expect(await openFile(admin)).toHaveLength(1)
    expect(await openFile(buyer)).toHaveLength(1)
  })

  it("doesn't work for a student, even knowing exactly where the file is", async () => {
    await addRow(mentor)
    const [{ path }] = await db.as<{ path: string }>(student, 'select path from public.purchase_receipts')
    expect(await openFile(student, path)).toEqual([])
  })

  it("stops working for a purchaser who's removed", async () => {
    await db.as(mentor, 'delete from public.purchasing_buyers where member_id = $1', [buyer])
    expect(await openFile(buyer)).toEqual([])
  })

  it("doesn't work for someone who isn't signed in, or whose access is off", async () => {
    expect(await openFile(null)).toEqual([])
    await db.switchOff(mentor)
    expect(await openFile(mentor)).toEqual([])
  })

  it("doesn't let a mentor whose role was taken away keep opening them", async () => {
    await db.sql("update public.members set role = 'student' where id = $1", [mentor])
    expect(await openFile(mentor)).toEqual([])
  })
})

describe('adding a receipt', () => {
  it('works for mentors, admins and purchasers', async () => {
    await upload(mentor, filePath('11111111-1111-4111-8111-111111111111.pdf'))
    await upload(admin, filePath('22222222-2222-4222-8222-222222222222.jpg'))
    await upload(buyer, filePath('33333333-3333-4333-8333-333333333333.png'))
    expect(await db.sql('select id from storage.objects')).toHaveLength(3)
  })

  it("doesn't work for a student, or someone who isn't signed in", async () => {
    await expect(upload(student)).rejects.toThrow(PERMISSION_DENIED)
    await expect(upload(null)).rejects.toThrow(PERMISSION_DENIED)
  })

  it("stops working for a purchaser who's removed", async () => {
    await db.as(mentor, 'delete from public.purchasing_buyers where member_id = $1', [buyer])
    await expect(upload(buyer)).rejects.toThrow(PERMISSION_DENIED)
  })

  it('only takes files in the folder of a real item', async () => {
    await expect(upload(mentor, `33333333-3333-4333-8333-333333333333/${FILE_ID}.pdf`)).rejects.toThrow(PERMISSION_DENIED)
    await expect(upload(mentor, `${FILE_ID}.pdf`)).rejects.toThrow(PERMISSION_DENIED)
  })

  it("can't replace a receipt with another file, even for a mentor", async () => {
    await upload(mentor)
    expect(await db.as(mentor, "update storage.objects set name = 'other' where bucket_id = $1 returning id", [BUCKET])).toEqual([])
  })

  it("doesn't open up any other bucket", async () => {
    await db.sql("insert into storage.buckets (id, name) values ('other', 'other')")
    await expect(upload(mentor, filePath(), 'other')).rejects.toThrow(PERMISSION_DENIED)
    await db.sql("insert into storage.objects (bucket_id, name) values ('other', 'file.pdf')")
    expect(await db.as(mentor, "select name from storage.objects where bucket_id = 'other'")).toEqual([])
  })
})

describe('deleting a receipt', () => {
  beforeEach(() => upload(mentor))

  it('works for admins', async () => {
    expect(await deleteFile(admin)).toHaveLength(1)
  })

  it('works for purchasers', async () => {
    expect(await deleteFile(buyer)).toHaveLength(1)
  })

  it("doesn't work for students, or a purchaser who's removed", async () => {
    await db.as(mentor, 'delete from public.purchasing_buyers where member_id = $1', [buyer])
    expect(await deleteFile(student)).toEqual([])
    expect(await deleteFile(buyer)).toEqual([])
    expect(await db.sql('select id from storage.objects')).toHaveLength(1)
  })
})

describe('the purchase_receipts table', () => {
  it('lets mentors and purchasers add a row, signed with their own id', async () => {
    const [row] = await addRow(buyer)
    expect(row.created_by).toBe(buyer)
  })

  it("doesn't let a student add a row, or anyone sign it as someone else", async () => {
    await expect(addRow(student)).rejects.toThrow(PERMISSION_DENIED)
    await expect(
      db.as(buyer, "insert into public.purchase_receipts (item_id, path, content_type, size_bytes, created_by) values ($1, $2, 'application/pdf', 1, $3)", [itemId, filePath(), mentor]),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('shows everyone on the team that an item has a receipt', async () => {
    await addRow(mentor)
    expect(await db.as(student, 'select item_id from public.purchase_receipts')).toEqual([{ item_id: itemId }])
  })

  it("shows nothing to someone who isn't signed in, or whose access is off", async () => {
    await addRow(mentor)
    await expect(db.as(null, 'select * from public.purchase_receipts')).rejects.toThrow(PERMISSION_DENIED)
    await db.switchOff(student)
    expect(await db.as(student, 'select * from public.purchase_receipts')).toEqual([])
  })

  it("doesn't keep the file's own name", async () => {
    const columns = await db.sql<{ name: string }>("select column_name as name from information_schema.columns where table_name = 'purchase_receipts'")
    expect(columns.map((c) => c.name).filter((c) => c.includes('name'))).toEqual([])
  })

  it('needs the path to be in the folder of its own item, with a random name', async () => {
    await expect(addRow(mentor, `33333333-3333-4333-8333-333333333333/${FILE_ID}.pdf`)).rejects.toThrow('check constraint')
    await expect(addRow(mentor, filePath('my-card-receipt.pdf'))).rejects.toThrow('check constraint')
    await expect(addRow(mentor, filePath(`${FILE_ID}.svg`))).rejects.toThrow('check constraint')
  })

  it('refuses a file over 10 MB, and a kind that is not allowed', async () => {
    await expect(
      db.as(mentor, "insert into public.purchase_receipts (item_id, path, content_type, size_bytes) values ($1, $2, 'application/pdf', 10485761)", [itemId, filePath()]),
    ).rejects.toThrow('check constraint')
    await expect(
      db.as(mentor, "insert into public.purchase_receipts (item_id, path, content_type, size_bytes) values ($1, $2, 'image/svg+xml', 10)", [itemId, filePath()]),
    ).rejects.toThrow('check constraint')
  })

  it('can be deleted by a mentor or purchaser, but not a student', async () => {
    const [row] = await addRow(buyer)
    expect(await db.as(student, 'delete from public.purchase_receipts where id = $1 returning id', [row.id])).toEqual([])
    expect(await db.as(buyer, 'delete from public.purchase_receipts where id = $1 returning id', [row.id])).toEqual([{ id: row.id }])
    const [other] = await addRow(buyer, filePath(`22222222-2222-4222-8222-222222222222.pdf`))
    expect(await db.as(mentor, 'delete from public.purchase_receipts where id = $1 returning id', [other.id])).toEqual([{ id: other.id }])
  })

  it("can't be changed after it's added, even by a mentor", async () => {
    const [row] = await addRow(mentor)
    await expect(db.as(mentor, 'update public.purchase_receipts set size_bytes = 2 where id = $1', [row.id])).rejects.toThrow(PERMISSION_DENIED)
  })

  it('stops its item being deleted, until a mentor or purchaser deletes the receipt', async () => {
    const [row] = await addRow(buyer)
    await expect(db.as(student, 'delete from public.purchase_items where id = $1', [itemId])).rejects.toThrow('foreign key')
    await expect(db.as(mentor, 'delete from public.purchase_items where id = $1', [itemId])).rejects.toThrow('foreign key')
    await db.as(mentor, 'delete from public.purchase_receipts where id = $1', [row.id])
    expect(await db.as(mentor, 'delete from public.purchase_items where id = $1 returning id', [itemId])).toEqual([{ id: itemId }])
  })
})
