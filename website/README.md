# Arcadia Website

Arcadia 软件产品官网，基于 Astro、React、TypeScript 与 Tailwind CSS。

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

Netlify 使用 `netlify.toml` 中的配置发布 `dist/`。正式上线前请更新 `astro.config.mjs` 中的 `site` 域名、GitHub 链接、支持邮箱和实际下载地址。

## 添加产品

在 `src/content/products/` 新增一个 Markdown 文件，填写 frontmatter 与正文即可自动生成产品卡片和详情页。
