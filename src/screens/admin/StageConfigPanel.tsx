import { Alert, Button, Input, InputNumber, Modal, Space, Table, Typography } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { duplicateStageFields } from '../../domain/stageFlow'
import type { Stage } from '../../domain/types'
import { formatWeight } from '../../lib/format'
import {
  listStages, roundStageWeight, saveStages, stagesRemovedBy, STAGE_WEIGHT_EPSILON,
} from '../../lib/decksApi'
import { randomUUID } from '../../lib/uuid'

/**
 * saveStages' own guard errors, in the admin's language.
 *
 * projectsApi.ts throws in English and stays that way -- same reasoning as
 * DeckEditor's mergeErrorInVietnamese: the domain layer has no business
 * knowing the UI language. The `!balanced` Alert above pre-empts the weight
 * guard under ordinary use (both check the same total against the same
 * STAGE_WEIGHT_EPSILON), so this is a defensive translation for the gap
 * between that client-side check and the write actually landing, not the
 * primary guard -- but "Stage weights must sum to 1, got 0.9500" reaching an
 * otherwise Vietnamese-only Alert is exactly the kind of thing an admin
 * cannot act on. Matched on a stable marker, not the whole sentence, so a
 * reworded domain message still translates and anything unrecognised falls
 * through unchanged.
 */
function saveStagesErrorInVietnamese(message: string): string {
  if (message.includes('must sum to 1')) {
    return 'Tổng trọng số các lớp phải bằng 1. Kiểm tra lại bảng trọng số trước khi lưu.'
  }
  if (message.includes('needs at least one stage')) {
    return 'Sàn cần có ít nhất một lớp sơn.'
  }
  if (message.includes('seq values must be unique') || message.includes('ids must be unique')) {
    return 'Có lỗi dữ liệu khi lưu cấu hình lớp sơn. Tải lại trang rồi thử lại.'
  }
  // Postgres, not projectsApi: `duplicate key value violates unique constraint
  // "deck_stages_deck_id_seq_key"`. saveStages now deletes before it
  // upserts, so nothing on this screen should be able to produce it -- but a raw
  // Postgres constraint message in an otherwise Vietnamese-only Alert is a
  // defect in its own right, and this is the last line of defence if those two
  // statements are ever reordered again.
  if (message.includes('duplicate key')) {
    return 'Không lưu được cấu hình lớp sơn vì thứ tự các lớp bị trùng. Tải lại trang rồi thử lại.'
  }
  return message
}

export function StageConfigPanel({
  deckId,
  onSaved,
}: {
  deckId: string
  /**
   * Called after a save that actually persisted. ProjectsScreen's row shows
   * this project's rollup (e.g. "42,31%") computed from the SAME stages this
   * panel edits -- removing a stage nulls every cell recorded at it, changing
   * true progress -- but the row lives in the parent and this panel has no
   * way to reach it on its own. DecksScreen already re-fetches its own list
   * through the editor's onClose after any close, not only a save; this is
   * the same pattern, scoped tighter to when a write actually happened.
   */
  onSaved?: () => void
}) {
  /**
   * The rows being edited, each carrying the id it is identified by.
   *
   * A draft row is a full `Stage`, ids included, because the id IS the identity
   * saveStages keys its upsert on: a rename, a reweight and a reorder all have
   * to arrive at the database attached to the row they belong to, or the write
   * relabels progress recorded against some other stage. Rows are only ever
   * replaced, never mutated in place -- `persisted` below shares these objects
   * on load, and an in-place edit would quietly move the baseline the diff is
   * taken against.
   */
  const [draft, setDraft] = useState<Stage[]>([])
  /**
   * The stage list as last read from the database, kept beside the draft so the
   * confirmation dialog can name the rows a save would actually delete. Written
   * only where `draft` is written, and under the same guards: the two are one
   * pair -- an edit and the baseline it was made against -- and a diff between
   * a fresh baseline and a stale draft would name the wrong stages.
   */
  const [persisted, setPersisted] = useState<Stage[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  // Whether the admin has made a local edit that no refresh has accounted
  // for yet. The generation token alone only orders *overlapping refreshes*
  // against each other -- it does nothing to protect an edit made between a
  // single refresh's start and its resolution, since no later refresh exists
  // to make that one stale by count. `dirty` is the actual guard for that
  // case: refresh skips writing whenever it's set, and it is cleared only
  // right after a successful save, when the draft is known to match what was
  // just persisted.
  const dirty = useRef(false)

  const refresh = useCallback(async () => {
    const mine = ++generation.current
    setLoading(true)
    try {
      const stages = await listStages(deckId)
      // Discard a load a newer refresh has superseded, and discard one that
      // resolves after the admin has resumed editing -- either way, applying
      // it would silently discard something more current than the fetch.
      if (mine !== generation.current || dirty.current) return
      setDraft(stages)
      setPersisted(stages)
      setError(null)
    } catch (e) {
      if (mine === generation.current) setError((e as Error).message)
    } finally {
      if (mine === generation.current) setLoading(false)
    }
  }, [deckId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const total = useMemo(() => draft.reduce((sum, s) => sum + s.weight, 0), [draft])
  const balanced = Math.abs(total - 1) <= STAGE_WEIGHT_EPSILON

  /**
   * The stages this save would delete, cascading their zones and nulling their
   * cells. The only destructive part of a stage save, and now the only part
   * worth confirming: with identity on the id, a reorder moves nobody's
   * recorded progress, so there is nothing left to disclose about it.
   */
  const removed = useMemo(() => stagesRemovedBy(persisted, draft), [persisted, draft])
  /**
   * Names and colours that more than one stage is claiming.
   *
   * Blocks the save rather than warning about it: a name and a colour are how a
   * stage is recognised, by the admin in the report and by the GS on the
   * drawing, and a deck painted in two identical greens cannot be read back at
   * all. There is no answer the admin could give that would make it correct.
   */
  const clashes = useMemo(() => duplicateStageFields(draft), [draft])
  const hasClash = clashes.names.length > 0 || clashes.colors.length > 0

  const patch = (index: number, change: Partial<Stage>) => {
    dirty.current = true
    setDraft((prev) => prev.map((s, i) => (i === index ? { ...s, ...change } : s)))
  }

  /** seq is renumbered 1..n on every structural change. Cumulative progress
   *  reads stages in seq ORDER, so a TIE corrupts every percentage -- two
   *  stages at one seq each count the other's cells. A GAP costs nothing:
   *  computeDeckProgress compares `stageSeqOf(...) >= stage.seq` over a sorted
   *  copy, so only relative order matters. Do not restate that as "a gap or a
   *  tie would corrupt every percentage": overstating the gap half is what made
   *  saveStages upsert the renumbered survivors before deleting the removed row,
   *  which put two rows at one seq and made removing any stage but the last fail
   *  outright. Renumbering itself is free of consequences -- it rewrites display
   *  order and touches no row's id, so no cell's recorded stage moves with it. */
  const renumber = (rows: Stage[]) => rows.map((s, i) => ({ ...s, seq: i + 1 }))

  /**
   * The row being dragged, while it is being dragged.
   *
   * A ref rather than state: nothing renders from it, and dragover fires on
   * every pixel of movement -- re-rendering the whole table on each one makes
   * the drag stutter badly enough to drop rows in the wrong place.
   */
  const dragging = useRef<number | null>(null)

  /**
   * Moves a stage to where it was dropped.
   *
   * Top to bottom is innermost to outermost, which is the order the GS ticks
   * them in and the order cumulative progress reads them in -- so this is not
   * cosmetic, and it is why seq is renumbered from the list's own order rather
   * than being typed.
   */
  const dropOn = (target: number) => {
    const from = dragging.current
    dragging.current = null
    if (from === null || from === target) return
    const rows = [...draft]
    const [moved] = rows.splice(from, 1)
    rows.splice(target, 0, moved)
    setDraft(renumber(rows))
  }

  const addStage = () => {
    dirty.current = true
    setDraft((prev) =>
      renumber([
        ...prev,
        // The id is minted here, not by the database, so the row carries its
        // identity from the moment it exists: saveStages' upsert keys on the id,
        // which turns a new stage into an INSERT of a known row rather than a
        // match to be worked out afterwards. See lib/uuid.ts for why this is
        // not a bare crypto.randomUUID() call.
        { id: randomUUID(), seq: 0, name: 'Lớp mới', color: '#8c8c8c', weight: 0 },
      ]),
    )
  }

  const removeStage = (index: number) => {
    dirty.current = true
    setDraft((prev) => renumber(prev.filter((_s, i) => i !== index)))
  }

  const move = (index: number, delta: number) => {
    dirty.current = true
    setDraft((prev) => {
      const next = [...prev]
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return renumber(next)
    })
  }

  const onSave = async () => {
    setBusy(true)
    try {
      await saveStages(deckId, draft)
      setError(null)
      setConfirming(false)
      // The draft just persisted is the new clean baseline: the background
      // refresh below is only reconciling with what we already know is
      // saved. Clearing `dirty` here lets that refresh write -- unless the
      // admin edits again before it resolves, which flips `dirty` back on
      // and makes `refresh` skip the write instead of clobbering the edit.
      dirty.current = false
      // Deliberately not awaited: the write already succeeded, so the save
      // itself is done and the row should stop being locked down. The
      // reconciliation fetch continues in the background under its own
      // `loading` state; `dirty` and the generation token together are what
      // keep a late-resolving background fetch from clobbering whatever the
      // admin has typed by the time it lands, so it is safe to let them keep
      // working instead of freezing the row for the length of a GET nobody
      // asked to wait for.
      void refresh()
      onSaved?.()
    } catch (e) {
      // Close the dialog before surfacing the error. The Alert lives outside the
      // modal, so leaving it open hides the message behind the mask -- the admin
      // would see the confirm dialog simply not go away, with no reason given.
      setConfirming(false)
      setError(saveStagesErrorInVietnamese((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}
      {!balanced && (
        <Alert
          type="warning"
          // formatWeight(1), not a hardcoded "1.00": a literal dot decimal in
          // the same sentence as a correctly formatted "1,0000" read as two
          // different number formats stitched together.
          message={`Tổng trọng số phải bằng ${formatWeight(1)} — hiện tại ${formatWeight(total)}`}
          description="Mọi phần trăm tiến độ đều tính từ các trọng số này, nên không lưu được khi tổng lệch."
        />
      )}

      <Table<Stage>
        // By id, not seq: seq is renumbered under the rows on every reorder and
        // removal, so keying React's reconciliation on it makes a row's identity
        // change out from under it -- the same mistake at the UI level that
        // keying the upsert on seq was at the database level.
        rowKey="id"
        size="small"
        // Only the very first fetch (before any row exists to show or edit)
        // should block the table behind Spin's overlay -- antd applies
        // `pointer-events: none` to the whole content while spinning, which
        // would also swallow input during every later background
        // reconciliation refresh, defeating the point of not disabling rows
        // for those (see the `disabled={busy}` comment below). A project
        // always has at least one stage once loaded, so `draft.length === 0`
        // is true only before that first load ever completes.
        loading={loading && draft.length === 0}
        dataSource={draft}
        pagination={false}
        onRow={(_row, index) => ({
          draggable: !busy,
          'aria-grabbed': false,
          onDragStart: () => { dragging.current = index ?? null },
          // Without preventDefault the browser refuses the drop outright: the
          // default for a dragover is "this is not a drop target".
          onDragOver: (e: { preventDefault: () => void }) => e.preventDefault(),
          onDrop: () => dropOn(index ?? 0),
        })}
        columns={[
          {
            title: 'Thứ tự',
            dataIndex: 'seq',
            width: 80,
            // Plain `dataIndex` rendering left the seq cell with no handle a
            // test could target unambiguously from other numeric text on the
            // page (e.g. the weight total). A gap or tie here would corrupt
            // every cumulative-progress percentage, so it needs to be
            // directly assertable, not inferred from a text regex.
            render: (v: number, _r, i) => <span data-testid={`seq-${i}`}>{v}</span>,
          },
          {
            title: 'Tên lớp',
            dataIndex: 'name',
            render: (v: string, _r, i) => (
              <Input
                value={v}
                // Only `busy` (an active write) locks this down, not `loading`.
                // `loading` is also true for the background reconciliation
                // fetch after a save, and that fetch is exactly the case the
                // generation-token guard in `refresh` exists to make safe to
                // edit through -- freezing the row for it would make the
                // guard's protection unreachable. `loading` alone (the very
                // first fetch on mount) has nothing rendered yet to disable.
                disabled={busy}
                onChange={(e) => patch(i, { name: e.target.value })}
              />
            ),
          },
          {
            title: 'Màu',
            dataIndex: 'color',
            width: 110,
            render: (v: string, _r, i) => (
              <Input
                type="color"
                value={v}
                disabled={busy}
                onChange={(e) => patch(i, { color: e.target.value })}
              />
            ),
          },
          {
            title: 'Trọng số',
            dataIndex: 'weight',
            width: 130,
            render: (v: number, _r, i) => (
              <InputNumber
                value={v}
                min={0}
                max={1}
                disabled={busy}
                // No explicit `step`/`precision`: rc-input-number derives the
                // displayed precision from max(precision of value, precision
                // of step). A step with more decimals than the stored weight
                // (e.g. 0.05) pads the display -- 0.6 renders as "0.60" -- so
                // the input silently stops mirroring the raw stored number.
                // Leaving step at its default (1, precision 0) lets the
                // value's own digits decide the display.
                // A Vietnamese admin types "0,25" for a weight. Without this,
                // antd parses that as 0 and the stage silently loses its
                // weight -- the same class of bug the deck-area field had.
                decimalSeparator=","
                // Clamped to the column's own scale (numeric(6,5)) as it is
                // typed, so the admin never enters a sixth decimal that
                // Postgres rounds away behind their back. That rounding is what
                // turned a successful save into a config whose total no longer
                // summed to 1 on reload, disabling this very button.
                onChange={(n) => patch(i, { weight: roundStageWeight(n ?? 0) })}
              />
            ),
          },
          {
            title: '',
            key: 'actions',
            width: 200,
            render: (_v, _r, i) => (
              <Space size="small">
                <Button size="small" disabled={busy || i === 0} onClick={() => move(i, -1)}>
                  Lên
                </Button>
                <Button
                  size="small"
                  disabled={busy || i === draft.length - 1}
                  onClick={() => move(i, 1)}
                >
                  Xuống
                </Button>
                <Button
                  size="small"
                  danger
                  disabled={busy || draft.length === 1}
                  onClick={() => removeStage(i)}
                >
                  Xoá
                </Button>
              </Space>
            ),
          },
        ]}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={3}>
              <Typography.Text strong>Tổng</Typography.Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={3}>
              <Typography.Text type={balanced ? 'success' : 'danger'} strong>
                {formatWeight(total)}
              </Typography.Text>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />

      {hasClash && (
        <Alert
          type="error"
          message="Hai lớp sơn đang trùng nhau"
          description={[
            clashes.names.length > 0 ? `Trùng tên: ${clashes.names.join(', ')}.` : '',
            clashes.colors.length > 0 ? `Trùng màu: ${clashes.colors.join(', ')}.` : '',
            'GS nhận ra lớp sơn bằng màu trên bản vẽ, báo cáo nhận ra bằng tên — trùng thì không đọc lại được.',
          ].filter(Boolean).join(' ')}
        />
      )}

      <Space>
        <Button
          type="primary"
          disabled={!balanced || hasClash}
          loading={busy}
          // A rename, a reweight and a reorder all keep every stage row, id,
          // zone and tick, so there is genuinely nothing to disclose and the
          // save goes straight through: a dialog on a save that costs nothing is
          // a dialog the admin learns to click through, which is how the one
          // that does matter gets skimmed. A removal is the one that matters.
          onClick={() => (removed.length > 0 ? setConfirming(true) : void onSave())}
        >
          Lưu
        </Button>
        <Button disabled={busy} onClick={addStage}>
          Thêm lớp
        </Button>
      </Space>

      {/* Conditionally rendered rather than toggled via `open`, so that the
       * dialog's presence in the DOM is a direct, immediate reflection of
       * `confirming` -- not something waiting on rc-motion's leave animation
       * (which never completes under jsdom, since no real `transitionend`
       * ever fires there) to unmount. The cost is losing the open/close
       * animation on this one dialog, which is negligible against a save
       * confirmation whose closed state needs to be trustworthy. */}
      {confirming && (
        <Modal
          open
          title="Xoá lớp sơn khỏi cấu hình?"
          okText="Vẫn lưu"
          cancelText="Huỷ"
          confirmLoading={busy}
          onCancel={() => setConfirming(false)}
          onOk={() => void onSave()}
        >
          {/*
            The stages being deleted, by the name the DATABASE holds for them --
            `removed` comes from the persisted snapshot, and these rows are no
            longer in the draft at all, so there is no edited name left to show.

            This list used to be the whole write laid out seq by seq, because a
            seq-keyed upsert really did rewrite each position in place and the
            consequences landed per position rather than per stage. With identity
            on the id that framing would now be a lie: a reorder rewrites nothing
            but display order, and the only thing a save can destroy is the rows
            named here. An earlier wording claimed a stage save wiped all recorded
            progress in the project (true of the delete-and-reinsert write it
            described) and never mentioned zones, which were the part being
            destroyed silently.
          */}
          <Typography.Paragraph>Các lớp sơn sẽ bị xoá khỏi cấu hình:</Typography.Paragraph>
          <ul>
            {removed.map((s) => (
              <li key={s.id}>
                <strong>{s.name}</strong>
              </li>
            ))}
          </ul>
          <Typography.Paragraph>
            Xoá một lớp sẽ xoá tiến độ đã ghi của mọi ô đang ở lớp đó — các ô đó
            trở về trạng thái chưa bắt đầu — và xoá luôn các zone đã lên kế hoạch
            cho lớp đó.
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary">
            Đổi tên, đổi trọng số hay đổi thứ tự thì không mất gì: mỗi lớp giữ
            nguyên danh tính của nó, nên tiến độ đã ghi và zone vẫn đi theo đúng
            lớp. Nhưng các lớp bị xoá ở trên thì mất vĩnh viễn và không thể khôi
            phục.
          </Typography.Paragraph>
        </Modal>
      )}
    </Space>
  )
}
