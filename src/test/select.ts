import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Picks an option in the dropdown of ONE named antd Select.
 *
 * antd leaves every dropdown it has opened in the DOM (hidden), shows the
 * chosen value under the same title, and under test gives every Select the
 * same id -- rc-select's `TEST_OR_SSR` -- so neither `findByTitle` nor the
 * input's `aria-controls` tells the dropdowns apart. The one open is the one
 * not hidden. `root` narrows which Select of that name is meant (a bar, a
 * drawer).
 */
export async function chooseOption(name: string, option: string | RegExp, root?: HTMLElement) {
  const dropdown = await openDropdown(name, root)
  await userEvent.click(await within(dropdown).findByTitle(option))
}

/** The option titles of the named Select's dropdown, in order, opening it. */
export async function optionTitles(name: string, root?: HTMLElement): Promise<Array<string | null>> {
  const dropdown = await openDropdown(name, root)
  return [...dropdown.querySelectorAll('.ant-select-item-option')].map((o) => o.getAttribute('title'))
}

/** Opens the named Select and returns its popup, the one dropdown not hidden. */
export async function openDropdown(name: string, root?: HTMLElement): Promise<HTMLElement> {
  const box = await (root ? within(root) : screen).findByRole('combobox', { name })
  await userEvent.click(box)
  let dropdown: HTMLElement | undefined
  await waitFor(() => {
    dropdown = [...document.querySelectorAll<HTMLElement>('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')].at(-1)
    if (!dropdown) throw new Error(`Select "${name}" opened no dropdown`)
  })
  return dropdown as HTMLElement
}
