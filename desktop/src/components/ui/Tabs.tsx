import { Tabs as AntTabs } from 'antd'
import type { ComponentProps } from 'react'

// Transitional adapter: browser editable tabs depend on Ant's mature overflow
// and keyboard behaviour. Business code imports this boundary so the internal
// implementation can be replaced independently in the next migration step.
export const Tabs = AntTabs
export type TabsProps = ComponentProps<typeof AntTabs>
