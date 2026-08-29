/**
 * Everything geometry.ts and the network can refuse a mesh edit with, in the
 * admin's language.
 *
 * Split out of DeckEditor: these are pure string mappings with no React in
 * them, they are the part of that screen most worth unit testing directly, and
 * the screen is long enough without three doc comments about wording in it.
 */
/**
 * Domain merge errors, in the admin's language.
 *
 * geometry.ts throws in English and stays that way -- it has no business
 * knowing the UI language -- but all four of mergeCells' own errors are
 * routine validation an admin hits by selecting an L-shape or the same cell
 * twice, not infrastructure failures, so they cannot be surfaced raw. Matched
 * on a stable marker rather than the whole sentence so a reworded domain
 * message still translates, and anything unrecognised falls through unchanged
 * so a new domain error is never swallowed.
 *
 * Exported so its one hard-to-reach branch (a duplicate cell in the
 * selection) can be unit tested directly: `cells` and `selected` both hold
 * unique codes by construction under every UI path that reaches mergeCells,
 * so there is no way to drive that branch through the rendered screen.
 */
export function mergeErrorInVietnamese(message: string): string {
  if (message.includes('solid rectangle')) {
    return 'Các ô đã chọn phải ghép thành một hình chữ nhật kín. Bỏ chọn ô lẻ, hoặc chọn thêm ô để bù chỗ trống.'
  }
  if (message.includes('overlapping cells')) {
    return 'Các ô đã chọn bị trùng nhau nên không gộp được. Sinh lại lưới ô rồi chọn lại.'
  }
  if (message.includes('at least two cells')) {
    return 'Cần chọn ít nhất hai ô để gộp.'
  }
  if (message.includes('same cell more than once')) {
    return 'Danh sách ô chọn có ô bị lặp lại. Bỏ chọn rồi chọn lại.'
  }
  return message
}

/**
 * A failed round trip, in the admin's language.
 *
 * A dropped connection reaches here as a TypeError carrying the browser's own
 * English -- "Failed to fetch" in Chrome, "Load failed" in Safari,
 * "NetworkError when attempting to fetch resource" in Firefox. Rendering that
 * verbatim told a Vietnamese admin nothing and hid the only thing they can act
 * on: the network, not the deck. Matched on the browsers' markers rather than
 * on the error's type, because postgrest-js and supabase-js both re-wrap the
 * failure before it gets here. Anything unrecognised falls through unchanged
 * rather than being flattened into a generic apology that loses the detail.
 */
export function saveErrorInVietnamese(message: string): string {
  if (/failed to fetch|load failed|networkerror|network request failed/i.test(message)) {
    return 'Mất kết nối tới máy chủ. Kiểm tra mạng rồi thử lại.'
  }
  return message
}

/**
 * Refusals from `drawnCell`, in the admin's language. Same rule as
 * mergeErrorInVietnamese: the domain throws in English and stays that way, and
 * both of these are things an admin hits by drawing, not infrastructure
 * failures, so neither may reach them raw.
 */
export function drawErrorInVietnamese(message: string): string {
  if (message.includes('too small')) {
    return 'Ô vừa vẽ quá nhỏ. Kéo một khung lớn hơn.'
  }
  if (message.includes('overlaps')) {
    return 'Chỗ đó đã có ô rồi. Chỉ vẽ được vào chỗ còn trống.'
  }
  return message
}
