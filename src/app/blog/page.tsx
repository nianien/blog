import { redirect } from 'next/navigation';

export default function BlogRootRedirect() {
  redirect('/');
  return null;
}
