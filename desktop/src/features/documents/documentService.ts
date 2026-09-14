import type { Document } from '../../types'
import { listDocuments } from '../../api'
export async function loadDocuments(): Promise<{ items: Document[]; offline: boolean }> {
  try { return { items: await listDocuments(), offline: false } }
  catch { return { items: [], offline: true } }
}
