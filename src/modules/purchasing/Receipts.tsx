import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { shortDate } from '../../core/format'
import { useMemberNames } from '../../core/members'
import { toast } from '../../core/toast'
import {
  RECEIPT_ACCEPT,
  addReceipt,
  prepareReceipt,
  receiptCountText,
  receiptLink,
  receiptText,
  removeReceipt,
  sizeText,
  useCanOrder,
  useReceipts,
  type PreparedReceipt,
  type PurchaseItem,
  type Receipt,
} from './data'

const TAP_SIZE = 44
const PREVIEW = { maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', justifySelf: 'center' } as const

/** An item's receipts. File preparation and upload happen through data.ts, in the private existing bucket. */
export function Receipts(props: { item: PurchaseItem; showAdd: boolean }) {
  const nameOf = useMemberNames()
  const canManage = useCanOrder()
  const receipts = useReceipts(props.item.id)
  const picker = useRef<HTMLInputElement>(null)
  const [preparing, setPreparing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<{ candidate: PreparedReceipt; url: string | null } | null>(null)
  const currentPreviewUrl = useRef<string | null>(null)
  // Deleting a receipt takes two presses (see the buttons below).
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const candidate = preview?.candidate ?? null
  const previewUrl = preview?.url ?? null

  function releasePreviewUrl() {
    if (currentPreviewUrl.current) URL.revokeObjectURL(currentPreviewUrl.current)
    currentPreviewUrl.current = null
  }

  function clearPreview() {
    releasePreviewUrl()
    setPreview(null)
  }

  // URLs are created once per selection, not during render (Strict Mode can
  // render twice). Release each exactly once when replaced, canceled or closed.
  useEffect(() => {
    return () => releasePreviewUrl()
  }, [])

  function showPreview(next: PreparedReceipt) {
    releasePreviewUrl()
    const url = next.previewable ? URL.createObjectURL(next.compressed ?? next.original) : null
    currentPreviewUrl.current = url
    setPreview({ candidate: next, url })
  }
  async function upload(file: File) {
    if (uploading) return
    setUploading(true)
    try {
      const result = await addReceipt(props.item, file)
      if (result.ok) clearPreview()
      toast(result.ok ? 'Receipt added.' : result.error)
    } finally {
      setUploading(false)
    }
  }

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Cleared so picking the same file again, after a problem, still counts.
    event.target.value = ''
    if (!file) return
    clearPreview()
    setPreparing(true)
    try {
      const result = await prepareReceipt(file)
      if (!result.ok) {
        toast(result.error)
      } else if (file.type === 'application/pdf') {
        await upload(result.value.original)
      } else {
        showPreview(result.value)
      }
    } catch {
      toast("Couldn't read that photo. Try saving it again, or choose another photo.")
    } finally {
      setPreparing(false)
    }
  }

  async function open(receipt: Receipt) {
    // The tab has to open during the tap, or phones block it. The address
    // comes after, once the link is made.
    const tab = window.open('', '_blank')
    const result = await receiptLink(receipt)
    if (!result.ok) {
      tab?.close()
      toast(result.error)
      return
    }
    if (!tab) {
      toast('Your browser blocked the new tab. Allow pop-ups for this site and try again.')
      return
    }
    tab.opener = null
    tab.location.href = result.value
  }

  async function remove(receipt: Receipt) {
    if (deletingId !== receipt.id) {
      setDeletingId(receipt.id)
      return
    }
    const result = await removeReceipt(receipt)
    setDeletingId(null)
    toast(result.ok ? 'Receipt deleted.' : result.error)
  }

  // Nothing to see or do here for a student, on an item with no receipts.
  if (!canManage && receipts.length === 0) return null

  return (
    <div style={{ minWidth: 0, display: 'grid', gap: 14 }}>
      <span>Receipts</span>
      {canManage ? (
        receipts.map((receipt, i) => (
          <div key={receipt.id} className="toolbar" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
            <span style={{ minWidth: 0, color: 'var(--ink)' }}>
              Receipt {i + 1}: {receiptText(receipt)}
              <br />
              <span className="note">Added by {nameOf(receipt.created_by)} · {shortDate(receipt.created_at)}</span>
            </span>
            <span className="toolbar">
              <button type="button" className="btn btn-sm" onClick={() => void open(receipt)}>Open</button>
              <button type="button" className="btn btn-sm" onClick={() => void remove(receipt)}>
                {deletingId === receipt.id ? 'Press again to delete' : 'Delete'}
              </button>
            </span>
          </div>
        ))
      ) : (
        <span className="note">
          {receipts.length > 0 ? `${receiptCountText(receipts.length)} added. ` : ''}Only mentors and purchasers can open receipts, because they can show card digits and addresses.
        </span>
      )}
      {canManage && props.showAdd && (
        <>
          <div className="toolbar">
            <button type="button" className="btn btn-sm" disabled={uploading || preparing} onClick={() => picker.current?.click()}>
              {uploading ? 'Uploading…' : preparing ? 'Preparing photo…' : 'Add receipt'}
            </button>
            <span className="note">PDF or photo, up to 10 MB. Photos are checked with you before adding.</span>
            <input ref={picker} type="file" accept={RECEIPT_ACCEPT} aria-label="Add receipt" hidden disabled={uploading || preparing} onChange={(e) => void pick(e)} />
          </div>
          {candidate && (
            <Preview
              candidate={candidate}
              previewUrl={previewUrl}
              uploading={uploading}
              onUpload={(file) => void upload(file)}
              onCancel={clearPreview}
            />
          )}
        </>
      )}
    </div>
  )
}

/** Review happens locally: this component has no upload until someone chooses a file below. */
function Preview(props: {
  candidate: PreparedReceipt
  previewUrl: string | null
  uploading: boolean
  onUpload: (file: File) => void
  onCancel: () => void
}) {
  const { candidate, previewUrl, uploading } = props
  const compressed = candidate.compressed
  const openPreview = () => {
    if (!previewUrl) return
    const tab = window.open('', '_blank')
    if (!tab) {
      toast('Your browser blocked the preview. Allow pop-ups for this site and try again.')
      return
    }
    tab.opener = null
    tab.location.href = previewUrl
  }

  return (
    <div className="panel-body" style={{ border: '1px solid var(--line)', borderRadius: 8, display: 'grid', gap: 12, minWidth: 0, padding: 14 }}>
      <strong>{compressed ? 'Check the compressed photo' : 'Use this photo'}</strong>
      {previewUrl ? (
        <>
          <img src={previewUrl} alt="Receipt preview, ready to check" style={PREVIEW} />
          <div className="toolbar">
            <button type="button" className="btn" style={{ minHeight: TAP_SIZE }} onClick={openPreview}>Open full-size preview</button>
          </div>
        </>
      ) : (
        <p className="note" style={{ margin: 0 }}>This photo can't be previewed or compressed here. You can keep the original or choose another photo.</p>
      )}
      <p className="note" style={{ margin: 0 }}>
        {compressed
          ? `Original: ${sizeText(candidate.original.size)} · Compressed: ${sizeText(compressed.size)}. Check dates, amounts and small print before choosing.`
          : `Original: ${sizeText(candidate.original.size)}. No smaller file was made, so you can use the original unchanged.`}
      </p>
      <div className="toolbar">
        {compressed && (
          <button type="button" className="btn btn-primary" style={{ minHeight: TAP_SIZE }} disabled={uploading} onClick={() => props.onUpload(compressed)}>
            {uploading ? 'Uploading…' : 'Use compressed photo'}
          </button>
        )}
        <button type="button" className="btn" style={{ minHeight: TAP_SIZE }} disabled={uploading} onClick={() => props.onUpload(candidate.original)}>
          {uploading ? 'Uploading…' : 'Keep original'}
        </button>
        <button type="button" className="btn" style={{ minHeight: TAP_SIZE }} disabled={uploading} onClick={props.onCancel}>Cancel</button>
      </div>
    </div>
  )
}
