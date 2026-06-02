import { getAllPosts } from '@/lib/blog';
import { SITE } from '@/lib/site';

export const dynamic = 'force-static';

const FEED_SIZE = 50;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function postUrl(slug: string): string {
  return `${SITE.url}/blog/${encodeURI(slug)}/`;
}

export async function GET(): Promise<Response> {
  const posts = getAllPosts().slice(0, FEED_SIZE);
  const now = new Date().toUTCString();
  const latest = posts[0]?.pubDate
    ? new Date(posts[0].pubDate).toUTCString()
    : now;

  const items = posts
    .map((post) => {
      const link = postUrl(post.slug);
      const pubDate = new Date(post.pubDate).toUTCString();
      const categories = (post.tags || [])
        .map((t) => `    <category>${escapeXml(t)}</category>`)
        .join('\n');
      const description = escapeXml(post.description || post.title);
      return `  <item>
    <title>${escapeXml(post.title)}</title>
    <link>${link}</link>
    <guid isPermaLink="true">${link}</guid>
    <pubDate>${pubDate}</pubDate>
    <description>${description}</description>
${categories}
  </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${escapeXml(SITE.name)}</title>
  <link>${SITE.url}</link>
  <atom:link href="${SITE.url}/rss.xml" rel="self" type="application/rss+xml"/>
  <description>${escapeXml(SITE.description)}</description>
  <language>${SITE.locale}</language>
  <lastBuildDate>${latest}</lastBuildDate>
${items}
</channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
