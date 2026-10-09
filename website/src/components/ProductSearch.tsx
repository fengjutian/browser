import { useMemo, useState } from 'react';
import { Search, Monitor, Clock3 } from 'lucide-react';

type Product = { id:string; title:string; description:string; category:string; platforms:string[]; status:string; version:string };
const statusLabel:Record<string,string> = { development:'开发中', beta:'测试版', stable:'正式版' };

export default function ProductSearch({ products }:{ products:Product[] }) {
  const [query,setQuery] = useState(''); const [platform,setPlatform] = useState('全部');
  const list = useMemo(() => products.filter(p => (platform==='全部'||p.platforms.includes(platform)) && `${p.title}${p.description}${p.category}`.toLowerCase().includes(query.toLowerCase())), [products,query,platform]);
  return <div>
    <div className="mb-8 grid gap-3 border-y border-[var(--line)] py-5 md:grid-cols-[1fr_auto]">
      <label className="flex items-center gap-3 bg-[var(--panel)] px-4"><Search size={18}/><span className="sr-only">搜索产品</span><input value={query} onChange={e=>setQuery(e.target.value)} className="min-h-12 w-full bg-transparent outline-none" placeholder="搜索产品或功能"/></label>
      <div className="flex gap-2 overflow-x-auto">{['全部','Windows','macOS','Linux'].map(p=><button key={p} onClick={()=>setPlatform(p)} className={`min-h-12 border px-4 text-sm ${platform===p?'border-[var(--acid)] text-[var(--acid)]':'border-[var(--line)]'}`}>{p}</button>)}</div>
    </div>
    <div className="grid gap-4 md:grid-cols-2">{list.map(p=><a href={`/products/${p.id}/`} className="group border border-[var(--line)] bg-[var(--panel)] p-7 transition hover:border-[var(--acid)]" key={p.id}>
      <div className="mb-12 flex items-start justify-between"><span className="flex size-12 items-center justify-center bg-[var(--acid)] text-xl font-bold text-[#11150f]">{p.title[0]}</span><span className="flex items-center gap-2 text-xs text-[var(--acid)]"><Clock3 size={14}/>{statusLabel[p.status]}</span></div>
      <p className="text-xs uppercase tracking-[.16em] text-[var(--muted)]">{p.category} · v{p.version}</p><h2 className="mt-2 text-3xl font-semibold tracking-tight">{p.title}</h2><p className="mt-3 text-[var(--muted)]">{p.description}</p>
      <div className="mt-6 flex items-center gap-2 text-sm"><Monitor size={16}/>{p.platforms.join(' · ')}</div>
    </a>)}</div>
    {!list.length && <div className="border border-[var(--line)] p-10 text-center text-[var(--muted)]">没有找到匹配的产品，请尝试其他关键词。</div>}
  </div>;
}
