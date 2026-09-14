import type { Document } from './types'
const BASE = 'http://127.0.0.1:8787/api/v1'
export async function listDocuments(query=''):Promise<Document[]> { const r=await fetch(`${BASE}/documents?q=${encodeURIComponent(query)}`); if(!r.ok)throw new Error('API unavailable'); return (await r.json()).items }
export async function saveDocument(input:{title:string;url:string;markdown:string;tags:string[]}):Promise<Document>{const r=await fetch(`${BASE}/documents`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});if(!r.ok)throw new Error('Save failed');return r.json()}
export async function getDocument(id:string):Promise<Document>{const r=await fetch(`${BASE}/documents/${encodeURIComponent(id)}`);if(!r.ok)throw new Error('Document unavailable');return r.json()}
