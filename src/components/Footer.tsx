export default function Footer() {
  return (
    <footer className="bg-[var(--background)]">
      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
        <p className="text-center text-xs leading-5 text-gray-400">
          &copy; {new Date().getFullYear()} Skyfalling
        </p>
      </div>
    </footer>
  );
}
