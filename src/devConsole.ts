import { paintDeck, progressReport, projectReport } from './domain/simulate'
import type { Deck, Stage } from './domain/types'

/**
 * A way to ask what the percentages would say, from the browser console,
 * without painting anything.
 *
 * The admin needs to see the report behave before a single bay has been ticked
 * on site: "if the primer is finished and the first coat is half done, what
 * does this deck read?" The only way to answer that was to tick bays on a real
 * deck, which writes progress somebody then has to unpick -- and unpicking it
 * is worse than the question was worth.
 *
 * Nothing here writes. It reads the deck, the cells and the stages that are
 * really there, applies the mix in memory, and prints what the same functions
 * the dashboard uses make of it.
 *
 * Dev builds only: it is a tool for reasoning about numbers, not a feature, and
 * a production bundle should not carry it.
 *
 *   await paint.deck('<deck id>', { 'Lót': 1, 'Phủ 1': 0.5 })
 *   await paint.project('<project id>', { 'Lót': 0.8 })
 *
 * The shares are read as "at least this far", by AREA -- forty small bays and
 * four large ones are not the same half of a deck.
 */
export function installDevConsole(): void {
  if (!import.meta.env.DEV) return

  /**
   * One deck through one work (0024): the mesh, that work's coats, and where
   * each bay stands in it. The first bays work the deck is in unless a name is
   * given -- the paint work, on every project so far.
   */
  const load = async (deckId: string, workName?: string) => {
    const { getDeck, listCells } = await import('./lib/decksApi')
    const { listDeckStates, listDeckWorks } = await import('./lib/gsApi')
    const row = await getDeck(deckId)
    if (!row) throw new Error(`Không có sàn nào mang id ${deckId}`)
    const [cells, works, states] = await Promise.all([
      listCells(deckId), listDeckWorks(deckId), listDeckStates(deckId),
    ])
    const view = workName ? works.find((w) => w.work.name === workName) : works[0]
    if (!view) {
      throw new Error(workName
        ? `Sàn ${row.name} không thuộc công việc "${workName}"`
        : `Sàn ${row.name} chưa thuộc công việc nào`)
    }
    const byCell = states[view.work.id] ?? {}
    const deck: Deck = {
      id: row.id,
      code: row.code,
      name: row.name,
      totalAreaM2: row.totalAreaM2,
      cells: cells.map((c) => ({
        id: c.id, code: c.code, x: c.x, y: c.y, w: c.w, h: c.h,
        areaM2: c.areaM2, stageId: byCell[c.id]?.stageId ?? null,
      })),
    }
    return { deck, stages: view.stages, projectId: row.projectId, work: view.work }
  }

  const api = {
    /** One deck in one work, painted to the given mix, reported stage by stage. */
    async deck(deckId: string, mix: Record<string, number> = {}, workName?: string) {
      const { deck, stages } = await load(deckId, workName)
      const report = progressReport(paintDeck(deck, stages, mix), stages)
      console.table(report)
      return report
    },

    /** Every deck of a project, each painted to the same mix, plus the rollup. */
    async project(projectId: string, mix: Record<string, number> = {}, workName?: string) {
      const { listDecks } = await import('./lib/decksApi')
      const rows = await listDecks(projectId)
      // Each deck's own stages: the mix is keyed by name, so a deck whose spec
      // does not carry that name simply reaches none of it.
      const entries: { deck: Deck; stages: Stage[] }[] = []
      for (const row of rows) {
        const { deck, stages } = await load(row.id, workName)
        entries.push({ deck: paintDeck(deck, stages, mix), stages })
      }
      const report = projectReport(entries)
      console.table(report)
      return report
    },

    /** The works of a deck with their coats, so the mix can be keyed by the right names. */
    async stages(deckId: string) {
      const { listDeckWorks } = await import('./lib/gsApi')
      const works = await listDeckWorks(deckId)
      console.table(works.flatMap((w) => w.stages.map((s) => ({
        work: w.work.name, seq: s.seq, name: s.name, color: s.color, weight: s.weight,
      }))))
      return works
    },
  }

  ;(window as unknown as { paint: typeof api }).paint = api
  console.info(
    'paint.deck(deckId, mix, workName?) / paint.project(projectId, mix, workName?) / paint.stages(deckId)\n'
    + "mix ví dụ: { 'Lót': 1, 'Phủ 1': 0.5 } — phần diện tích đạt ÍT NHẤT tới lớp đó. Không ghi gì vào dữ liệu.",
  )
}
