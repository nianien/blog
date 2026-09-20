export default function Footer() {
  return (
    <footer className="site-footer">
      <span>&copy; {new Date().getFullYear()} Skyfalling</span>
      <a href="/rss.xml" aria-label="RSS 订阅">RSS</a>
    </footer>
  );
}
