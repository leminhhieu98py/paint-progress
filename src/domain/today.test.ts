import { describe, expect, it } from 'vitest'
import { todayAreaByStage } from './today'
import { EMPTY_EFFORT, type DeckEvent, type Effort } from './types'

const TODAY = '2026-09-09'

let nextId = 1
const event = (over: Partial<Omit<DeckEvent, 'effort'>> & { effort?: Partial<Effort> } = {}): DeckEvent => ({
  id: nextId++,
  deckName: 'Sàn A',
  cellCode: 'R1C1',
  cellAreaM2: 100,
  workName: 'Sơn',
  toStageName: 'Lớp 1',
  at: `${TODAY}T03:00:00Z`,
  byId: 'u1',
  note: '',
  reportNote: null,
  reportHidden: false,
  effortEditedAt: null,
  effortEditedByName: null,
  ...over,
  effort: { ...EMPTY_EFFORT, ...(over.effort ?? {}) },
})

/** The two coats the admin configured on this deck, in seq order. */
const SON = [
  { workName: 'Sơn', stageName: 'Lớp 1' },
  { workName: 'Sơn', stageName: 'Lớp 2' },
]

describe('todayAreaByStage', () => {
  it('returns a coat nothing was recorded on at 0, rather than leaving it out', () => {
    // RV5-17, Linh's answer to Q3: "Liệt kê đủ các công đoạn khi admin tạo sàn.
    // nếu không làm thì hiển thị 0m2." An absent row reads as "no such coat".
    expect(todayAreaByStage([event()], SON, TODAY)).toEqual([
      { workName: 'Sơn', stageName: 'Lớp 1', areaM2: 100 },
      { workName: 'Sơn', stageName: 'Lớp 2', areaM2: 0 },
    ])
  })

  it('returns the rows in the order the caller listed the coats', () => {
    // Seq order is the caller's business -- it holds the deck's works and their
    // stages already sorted -- so this must not re-sort by anything of its own.
    const rows = todayAreaByStage([], [SON[1], SON[0]], TODAY)
    expect(rows.map((r) => r.stageName)).toEqual(['Lớp 2', 'Lớp 1'])
  })

  it('counts the area of an update that recorded no hours', () => {
    // NOT dailyEffort's areaM2: that field sums only the events which carried
    // workHours, deliberately, because it is the denominator of a Mhr/m² ratio.
    // Today's OUTPUT is a different question -- the bay got its coat whether or
    // not anybody typed the hours, and every row written before 0030 has none.
    const rows = todayAreaByStage([
      event({ cellCode: 'R1C1', cellAreaM2: 100, effort: { workHours: 4 } }),
      event({ cellCode: 'R1C2', cellAreaM2: 250 }),
    ], SON, TODAY)
    expect(rows[0].areaM2).toBe(350)
  })

  it('counts a bay recorded twice into one coat today only once, at the later figure', () => {
    // A foreman who fixes a mistyped update must not double the day's output.
    // Linh's answer to Q7 is that the later update is the one that counts.
    const twice = todayAreaByStage([
      event({ cellCode: 'R1C1', cellAreaM2: 100 }),
      event({ cellCode: 'R1C1', cellAreaM2: 100, at: `${TODAY}T06:00:00Z` }),
    ], SON, TODAY)
    expect(twice[0].areaM2).toBe(100)

    const corrected = todayAreaByStage([
      event({ cellCode: 'R1C1', cellAreaM2: 100 }),
      event({ cellCode: 'R1C1', cellAreaM2: 120, at: `${TODAY}T06:00:00Z` }),
    ], SON, TODAY)
    expect(corrected[0].areaM2).toBe(120)
  })

  it('counts a bay that received two coats today on both of them', () => {
    // Not a correction: the bay really did get Lớp 1 and then Lớp 2. Dedupe is
    // per coat, so both rows carry it.
    const rows = todayAreaByStage([
      event({ cellCode: 'R1C1', toStageName: 'Lớp 1' }),
      event({ cellCode: 'R1C1', toStageName: 'Lớp 2', at: `${TODAY}T06:00:00Z` }),
    ], SON, TODAY)
    expect(rows.map((r) => r.areaM2)).toEqual([100, 100])
  })

  it('counts a move back to nothing on no coat at all', () => {
    // toStageName null is a bay pushed back to not-started. It is not output,
    // and it is not the NOT_STARTED_STAGE placeholder row either: the block
    // lists the coats the admin configured and nothing else.
    const rows = todayAreaByStage([event({ toStageName: null })], SON, TODAY)
    expect(rows.map((r) => r.areaM2)).toEqual([0, 0])
  })

  it('counts nothing from another day', () => {
    const rows = todayAreaByStage([event({ at: '2026-09-08T03:00:00Z' })], SON, TODAY)
    expect(rows.map((r) => r.areaM2)).toEqual([0, 0])
  })

  it('buckets by the Vietnam calendar day, not by UTC', () => {
    // RV5-20: the same effortDayKey the dashboard and the Năng suất sheet use.
    // 17:30Z on the 8th is 00:30 on the 9th in Vietnam -- today, on a deck.
    const rows = todayAreaByStage([event({ at: '2026-09-08T17:30:00Z' })], SON, TODAY)
    expect(rows[0].areaM2).toBe(100)
  })

  it('keeps two identically-named coats in different works apart', () => {
    // RV5-18: the block spans every work the deck is in, and "Lớp 1" of Sơn is
    // not "Lớp 1" of Tháo giáo. Merging them would report one coat's output
    // twice and the other's not at all.
    const stages = [
      { workName: 'Sơn', stageName: 'Lớp 1' },
      { workName: 'Tháo giáo', stageName: 'Lớp 1' },
    ]
    const rows = todayAreaByStage([
      event({ workName: 'Sơn', cellCode: 'R1C1', cellAreaM2: 100 }),
      event({ workName: 'Tháo giáo', cellCode: 'R1C2', cellAreaM2: 40 }),
    ], stages, TODAY)
    expect(rows.map((r) => r.areaM2)).toEqual([100, 40])
  })
})
