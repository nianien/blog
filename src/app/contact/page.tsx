import type { Metadata } from 'next';
import ContactLinks from '@/components/ContactLinks';

export const metadata: Metadata = { title: '联系', alternates: { canonical: '/contact/' } };

export default function ContactPage() {
  return (
    <div className="reading-shell page-space">
      <h1 className="page-title">联系</h1>
      <ContactLinks />
    </div>
  );
}
