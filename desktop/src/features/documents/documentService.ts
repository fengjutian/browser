import type { Document } from '../../types'
import { demoDocuments } from '../../mock'
import { listDocuments } from '../../api'
export async function loadDocuments(): Promise<{ items: Document[]; offline: boolean }> { try { return { items: await listDocuments(), offline: false } } catch { return { items: demoDocuments, offline: true } } }
