import { redirect } from 'next/navigation';
import { getAllTags } from '@/lib/blog';

export async function generateStaticParams() {
  const tags = getAllTags();
  return tags.map((tag) => ({
    tag: encodeURIComponent(tag),
  }));
}

export default async function TagRedirectPage({ params }: { params: Promise<{ tag: string }> }) {
  const resolvedParams = await params;
  const { tag } = resolvedParams;
  
  // 重定向到第一页
  redirect(`/blog/tag/${tag}/page/1`);
} 