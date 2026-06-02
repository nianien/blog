export default function Footer() {
  return (
    <footer className="bg-[var(--background)]">
      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
        <p className="text-center text-xs leading-5 text-gray-400">
          &copy; {new Date().getFullYear()} Skyfalling
          <span className="mx-2 text-gray-300">·</span>
          <a
            href="/rss.xml"
            className="hover:text-gray-600 transition-colors"
            aria-label="RSS Feed"
          >
            RSS
          </a>
        </p>
      </div>
    </footer>
  );
}
