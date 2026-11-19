# AngleMotion Academy Blog

A public blog at `/blog`, built to bring in organic search traffic and lead readers to the free trial. It is separate from the signed-in Academy at `/academy` (resources and Q&A for subscribers), which is unchanged.

"Academy" means three things in this product: the members area (`/academy`), the 4-seat Academy plan, and this blog. Say which one.

## How it works
- Each article is a Markdown file in `content/blog/`. The file name is the URL: `content/blog/my-post.md` → `/blog/my-post`.
- Pages are generated at build time (`generateStaticParams`, `dynamicParams = false`): no database, no CMS, no new dependency, no request-time work. An unknown slug is a real 404.
- `lib/blog/markdown.ts` is a small, safe Markdown reader that builds a data tree (never an HTML string). Raw HTML in a post stays literal text; links and images accept only `/…`, `#…`, `https://…` and `mailto:`.
- `app/sitemap.ts` and `app/robots.ts` are generated from the same lists, and `tests/seoSite.test.ts` checks them against the middleware's public-path list so a new route cannot drift out of sync.
- `/blog` is in the middleware's public list (`middleware.ts`); nothing else about the auth gate changed.

## Writing a post
Create `content/blog/<slug>.md`:

```
---
title: At most 70 characters
description: At most 160 characters; this is the search snippet
date: 2026-11-19
updated: 2026-12-01        (optional)
category: tutorials
author: Vin Baccelli       (optional; must exist in lib/blog/authors.ts)
image: /blog/my-image.jpg  (optional; site path or https URL; default is the logo image)
draft: false               (true hides it everywhere, including the sitemap)
---
Body in Markdown…
```

Categories (`lib/blog/categories.ts`): `tutorials`, `articles`, `ebooks`, `pro-analysis`, `coaching`.

Markdown supported: `##`/`###`/`####` headings (the page already has the H1; `#` becomes H2), paragraphs, bullet and numbered lists, `>` quotes, `---`, fenced code, and inline **bold**, *italic*, `code`, links and images. Not supported: tables, raw HTML, triple-star emphasis.

A post with a mistake fails the build and `npm test` (`tests/blogContent.test.ts`), so it can never silently disappear. The test also rejects: a post under 150 words, the internal name "StroMotion", describing the AI as finding mistakes, and "guarantee".

## Content rules (same as the rest of the product)
- Use the product's words: Motion Layer, AI Track, Snapshot, Phase, Coach Override; "Ready", not "Approved". The AI proposes, the coach decides.
- No invented tennis or biomechanics claims, numbers, quotes, user counts, press or testimonials. Product steps come from the app itself (the guided tours are a good source).
- Quote a price only from the live Stripe prices, never from memory.
- Reviews on the site are of the founder's coaching service, not of the app.

## Publishing
Open a pull request with the new file; the owner approves; merging deploys it. After it is live, check the URL, `/sitemap.xml`, and the page's title in the browser, and record the URL in the editorial tracker.

## Not included (on purpose, for later)
Site search, RSS, comments, per-article images generated at build time, future-dated scheduling (publishing is the merge), and a real 404 for unknown non-blog URLs (KNOWN_ISSUES 085). A dedicated 1200×630 share image can replace the default by changing `DEFAULT_OG_IMAGE` in `lib/seo/site.ts`.

## Related setting outside the code
Make `anglemotion.com` redirect to `www.anglemotion.com` in Vercel → Domains (KNOWN_ISSUES 086). Canonical tags already point to `www`.
