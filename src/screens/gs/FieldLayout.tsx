import { Layout } from 'antd'
import type { ReactNode } from 'react'
import { Copyright } from '../../components/Copyright'
import { TypeScaleProvider } from '../../components/typeScale'
import { fieldType } from '../../theme'
import { FieldHeader } from './FieldHeader'
import { FIELD_TAB_BAR_SPACE, useFieldPhone } from './fieldSections'

/**
 * The frame of every field page: the field header first, then the page, then
 * the copyright line (RV7-2). On a phone the page ends as far above the bottom
 * of the screen as the fixed tab bar reaches (GS-06), so its last row -- the
 * copyright line -- never sits under the bar.
 *
 * The header is always the first child of the same Layout, so a host that
 * swaps its body (loading, a failure, the next project) keeps one header.
 * Everything inside is on the field's type scale (GS-10): a shared component
 * sets its running text at the field's 14, not the admin's 13.
 */
export function FieldLayout({ projectId, children }: {
  projectId: string | null | undefined
  children: ReactNode
}) {
  const phone = useFieldPhone()
  return (
    <TypeScaleProvider value={fieldType}>
      <Layout style={{ minHeight: '100vh', paddingBottom: phone ? FIELD_TAB_BAR_SPACE : undefined }}>
        {projectId ? <FieldHeader projectId={projectId} /> : null}
        {children}
        <Copyright />
      </Layout>
    </TypeScaleProvider>
  )
}
