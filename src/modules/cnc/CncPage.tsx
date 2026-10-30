import { useState } from 'react'
import { PageHead, Pick } from '../../core/ui'
import { Board } from './Board'
import { Sheets } from './Sheets'
import { StockList } from './StockList'

const TABS = ['Board', 'Sheets', 'Stock'] as const
type Tab = (typeof TABS)[number]

// The page reads rows with hooks from data.ts and saves through its
// functions. It never saves anything itself. Three views:
//   Board   parts waiting to be cut, grouped by stock (Board.tsx)
//   Sheets  the sheets on the rack, each drawn with what's cut from it (Sheets.tsx)
//   Stock   the kinds of stock and their router settings (StockList.tsx)
export default function CncPage() {
  const [tab, setTab] = useState<Tab>('Board')
  // The sheet open on the Sheets tab. The board can open one too.
  const [sheetId, setSheetId] = useState<string | null>(null)

  return (
    <>
      <PageHead title="CNC">What needs cutting on the router, grouped by stock, and every sheet on the rack with what's been cut from it.</PageHead>
      <Pick label="View" options={[...TABS]} value={tab} onChange={setTab} />
      {tab === 'Board' && (
        <Board
          onOpenSheet={(id) => {
            setSheetId(id)
            setTab('Sheets')
          }}
        />
      )}
      {tab === 'Sheets' && <Sheets openId={sheetId} onOpen={setSheetId} />}
      {tab === 'Stock' && <StockList />}
    </>
  )
}
