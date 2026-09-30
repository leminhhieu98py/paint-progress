import { createContext, useContext } from 'react'
import { type, type TypeScale } from '../theme'

/**
 * The type scale of the page a shared component is drawn on (GS-10): the
 * admin's `type`, or `fieldType` under a field page, whose base is 14. A shared
 * component (EmptyState, ConsequenceModal, NoteThread, …) reads its steps here,
 * so the one component sets its running text at 13 on an admin screen and at
 * 14 on a field screen. FieldLayout provides the field scale.
 */
const TypeScaleContext = createContext<TypeScale>(type)

export const TypeScaleProvider = TypeScaleContext.Provider

export function useTypeScale(): TypeScale {
  return useContext(TypeScaleContext)
}
