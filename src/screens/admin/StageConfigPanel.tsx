import { Alert, Button, Input, InputNumber, Modal, Space, Table, Typography } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Stage } from '../../domain/types'
import {
  listStages, roundStageWeight, saveStages, stageSavePlan, stagesRemovedBy,
  STAGE_WEIGHT_EPSILON,
} from '../../lib/projectsApi'

/**
 * A row being edited, plus the seq it was LOADED at.
 *
 * `originSeq` is what separates a rename from a shift, and the two have opposite
 * consequences. saveStages upserts on (project_id, seq) and never moves a row
 * between seqs, while cells.stage_id and zones.stage_id point at rows -- so
 * renaming the row at seq 2 renames the layer whose progress is recorded there
 * (what the admin asked for), whereas moving a different layer into seq 2
 * re-labels progress that was recorded against the old one (what nobody asked
 * for). A seq-to-seq diff alone cannot tell them apart: both come out as "the
 * name at seq 2 changed". null for a row that was never loaded, i.e. one the
 * admin has just added.
 */
type DraftStage = Omit<Stage, 'id'> & { originSeq: number | null }

/** The payload saveStages takes: the draft without this screen's own bookkeeping. */
const forSave = (draft: DraftStage[]) =>
  draft.map(({ seq, name, color, weight }) => ({ seq, name, color, weight }))

const weightFmt = new Intl.NumberFormat('vi-VN', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
})

export function StageConfigPanel({ projectId }: { projectId: string }) {
  const [draft, setDraft] = useState<DraftStage[]>([])
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
      const stages = await listStages(projectId)
      // Discard a load a newer refresh has superseded, and discard one that
      // resolves after the admin has resumed editing -- either way, applying
      // it would silently discard something more current than the fetch.
      if (mine !== generation.current || dirty.current) return
      setDraft(stages.map(({ seq, name, color, weight }) => ({
        seq, name, color, weight, originSeq: seq,
      })))
      setPersisted(stages)
      setError(null)
    } catch (e) {
      if (mine === generation.current) setError((e as Error).message)
    } finally {
      if (mine === generation.current) setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const total = useMemo(() => draft.reduce((sum, s) => sum + s.weight, 0), [draft])
  const balanced = Math.abs(total - 1) <= STAGE_WEIGHT_EPSILON

  /** The seqs this save would delete, cascading their zones and nulling their cells. */
  const removed = useMemo(() => stagesRemovedBy(persisted, forSave(draft)), [persisted, draft])

  /**
   * Rows that are no longer at the seq they were loaded at.
   *
   * The second thing worth confirming, and the one the plain removal/rename
   * split misses. Because saveStages rewrites each seq in place and progress is
   * recorded against rows, moving a layer to another seq leaves the progress
   * behind and re-labels it: reorder Coat 2 and Coat 3 and every cell recorded
   * at Coat 2 is thereafter counted as Coat 3 -- a later, heavier stage, so the
   * deck's reported percentage rises with nothing deleted and nothing on screen
   * to explain it. Exactly the plausible-looking wrong number this product
   * cannot afford, and it happens with no removals at all.
   */
  const shifted = useMemo(
    () => draft.filter((s) => s.originSeq !== null && s.originSeq !== s.seq),
    [draft],
  )

  /** The whole write, seq by seq, for the dialog to show. */
  const plan = useMemo(() => stageSavePlan(persisted, forSave(draft)), [persisted, draft])

  const patch = (index: number, change: Partial<DraftStage>) => {
    dirty.current = true
    setDraft((prev) => prev.map((s, i) => (i === index ? { ...s, ...change } : s)))
  }

  /** seq is renumbered 1..n on every structural change: cumulative progress
   *  reads stages by seq, so a gap or a tie would corrupt every percentage. */
  const renumber = (rows: DraftStage[]) => rows.map((s, i) => ({ ...s, seq: i + 1 }))

  const addStage = () => {
    dirty.current = true
    setDraft((prev) =>
      renumber([...prev, { seq: 0, name: 'Lớp mới', color: '#8c8c8c', weight: 0, originSeq: null }]),
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
      await saveStages(projectId, forSave(draft))
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
    } catch (e) {
      // Close the dialog before surfacing the error. The Alert lives outside the
      // modal, so leaving it open hides the message behind the mask -- the admin
      // would see the confirm dialog simply not go away, with no reason given.
      setConfirming(false)
      setError((e as Error).message)
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
          message={`Tổng trọng số phải bằng 1.00 — hiện tại ${weightFmt.format(total)}`}
          description="Mọi phần trăm tiến độ đều tính từ các trọng số này, nên không lưu được khi tổng lệch."
        />
      )}

      <Table<DraftStage>
        rowKey="seq"
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
                {weightFmt.format(total)}
              </Typography.Text>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />

      <Space>
        <Button
          type="primary"
          disabled={!balanced}
          loading={busy}
          // A rename or a reweight keeps every stage row, id, zone and tick, so
          // there is genuinely nothing to disclose and the save goes straight
          // through: a dialog on a save that costs nothing is a dialog the admin
          // learns to click through, which is how the one that does matter gets
          // skimmed. A removal or a position shift is a different matter -- see
          // `removed` and `shifted`.
          onClick={() =>
            (removed.length > 0 || shifted.length > 0 ? setConfirming(true) : void onSave())
          }
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
          title={removed.length > 0 ? 'Xoá lớp sơn khỏi cấu hình?' : 'Đổi thứ tự lớp sơn?'}
          okText="Vẫn lưu"
          cancelText="Huỷ"
          confirmLoading={busy}
          onCancel={() => setConfirming(false)}
          onOk={() => void onSave()}
        >
          {/*
            The plan seq by seq, which is what the write actually is: one UPDATE
            per seq, plus a DELETE for the seqs that vanish. Every sentence below
            is about that plan.

            The wording this replaced claimed a stage save wiped all recorded
            progress in the project -- true of the delete-and-reinsert write it
            described, no longer true of the diff -- and never mentioned zones,
            which were the part being destroyed silently.

            Two separate lists (removed / moved) were tried first and rejected:
            after removing a middle stage the same NAME appears in both, pointing
            at two different database rows, which is worse than saying nothing.
          */}
          <Typography.Paragraph>
            Cấu hình sau khi lưu, theo thứ tự lớp:
          </Typography.Paragraph>
          <ul>
            {plan.map((p) => (
              <li key={p.seq}>
                thứ tự {p.seq}:{' '}
                {p.toName === null ? (
                  <><strong>{p.fromName}</strong> → xoá</>
                ) : p.fromName === null ? (
                  <><strong>{p.toName}</strong> (lớp mới)</>
                ) : p.fromName === p.toName ? (
                  <><strong>{p.toName}</strong> (không đổi)</>
                ) : (
                  <><strong>{p.fromName}</strong> → <strong>{p.toName}</strong></>
                )}
              </li>
            ))}
          </ul>
          <Typography.Paragraph>
            Tiến độ đã ghi và zone gắn theo thứ tự lớp, không gắn theo tên. Đổi thứ
            tự nghĩa là những ô đang ở một thứ tự sẽ được tính theo lớp mới của thứ
            tự đó, chứ không đi theo lớp cũ.
          </Typography.Paragraph>
          {removed.length > 0 && (
            <Typography.Paragraph>
              Xoá một thứ tự sẽ xoá tiến độ đã ghi của mọi ô đang ở đó — các ô đó
              trở về trạng thái chưa bắt đầu — và xoá luôn các zone đã lên kế hoạch
              cho lớp đó.
            </Typography.Paragraph>
          )}
          <Typography.Paragraph type="secondary">
            Đổi tên hay đổi trọng số thì không mất gì. Nhưng phần bị xoá ở trên thì
            mất vĩnh viễn và không thể khôi phục.
          </Typography.Paragraph>
        </Modal>
      )}
    </Space>
  )
}
