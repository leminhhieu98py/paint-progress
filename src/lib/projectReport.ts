import { renderDeckDrawing, renderDeckPie, renderPlanDrawing } from '../canvas/deckSnapshot'
import { planImagePairs } from '../domain/report'
import { getDrawingUrl } from './decksApi'
import { listDeckEvents } from './progressApi'
import { buildReportWorkbook, type DeckImages, type PlanImage } from './reportXlsx'
import type { ProjectModel } from './workModel'
import { listDeckZones } from './zonesApi'

/**
 * The whole project's XLSX, every deck on its own sheet.
 *
 * Lifted out of the admin's decks list when the same file had to be reachable
 * from the foreman's screen (Feedback Rv4). Linh: the bosses were asking for
 * the admin build just to download a report covering every deck -- "có cách
 * nào nó tải cả sàn thì ok" -- so the button moved to them instead of the
 * screen moving to the bosses.
 *
 * Nothing here decides who may read what: RLS does. An admin's file carries
 * every deck of the project; a foreman held to one work gets that work's decks
 * and no others, because that is all `loadProjectModel` and `listDeckEvents`
 * hand back to their session.
 *
 * `userNames` is supplied by the caller: an admin resolves them through
 * `listGsUsers`, which a foreman may not call, and a foreman through
 * `coworker_names()`.
 */
export async function buildProjectReport(input: {
  projectName: string
  projectCode: string
  model: ProjectModel
  userNames: Record<string, string>
}): Promise<Blob> {
  const { model, userNames } = input

  // The deck as the first bays work that carries it sees it: the mesh for the
  // plan sheet, and the coats and states the pictures are coloured by. The
  // figures on the sheets come from the whole model, not from this.
  const viewOf = (deckId: string) => {
    for (const m of model.models) {
      if (m.work.kind !== 'bays') continue
      const view = m.decks.find((d) => d.deck.id === deckId)
      if (view) return view
    }
    return null
  }

  const decks = await Promise.all(model.decks.map(async (meta) => {
    const [zones, events] = await Promise.all([
      listDeckZones(meta.id),
      listDeckEvents(meta.id),
    ])
    return {
      deck: {
        id: meta.id, code: meta.code, name: meta.name, totalAreaM2: meta.totalAreaM2,
        cells: viewOf(meta.id)?.deck.cells ?? [],
      },
      areaSource: meta.areaSource,
      userNames,
      zones,
      events,
    }
  }))

  // Sequential: each render decodes a full-size drawing into a canvas, and ten
  // at once on a laptop -- let alone a tablet -- is a spike for no gain.
  const images: Record<string, DeckImages> = {}
  for (const meta of model.decks) {
    const view = viewOf(meta.id)
    const cells = view?.deck.cells ?? []
    const stages = view?.stages ?? []
    const url = meta.imagePath ? await getDrawingUrl(meta.imagePath).catch(() => null) : null
    images[meta.id] = {
      drawingPng: url
        ? await renderDeckDrawing(url, meta.imageW ?? 0, meta.imageH ?? 0, cells, stages)
        : null,
      piePng: renderDeckPie(meta.totalAreaM2, cells, stages),
      // The sheet sizes the picture from this. Excel stretches whatever box it
      // is given, and a fixed one squashed every deck that was not the shape
      // the box assumed.
      drawingAspect: meta.imageW && meta.imageH ? meta.imageH / meta.imageW : null,
    }
  }

  // The Plan sheet's layouts (Feedback Rv2, item 10): one per (deck, work) with
  // a plan, sequential for the same reason as above. A render that fails is
  // left out; the table above it is complete regardless.
  const planImages: PlanImage[] = []
  for (const pair of planImagePairs(decks, model.models)) {
    const meta = model.decks.find((d) => d.id === pair.deckId)
    if (!meta?.imagePath || !meta.imageW || !meta.imageH) continue
    const url = await getDrawingUrl(meta.imagePath).catch(() => null)
    if (!url) continue
    const png = await renderPlanDrawing(
      url, meta.imageW, meta.imageH, pair.cells, pair.stages, pair.lastStage, pair.zones, pair.zoneColors,
    )
    if (png) {
      planImages.push({
        deckName: pair.deckName, workName: pair.workName, lastStageName: pair.lastStage.name,
        png, aspect: meta.imageH / meta.imageW,
      })
    }
  }

  return buildReportWorkbook({
    projectName: input.projectName,
    projectCode: input.projectCode,
    works: model.models,
    decks,
    images,
    planImages,
  })
}

/**
 * Hands a built workbook to the browser as a download.
 *
 * Shared for one reason: the revoke has to be deferred. Safari has not started
 * the download when `click()` returns, and a URL revoked synchronously gives a
 * silent zero-byte file.
 */
export function downloadWorkbook(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
