import { redirect } from 'next/navigation';

export default function BlogRootRedirect() {
  redirect('/blog/page/1');
  return null;
} 