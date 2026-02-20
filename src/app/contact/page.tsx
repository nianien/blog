export default function ContactPage() {
  return (
    <div className="bg-[var(--background)] py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-xl">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            联系
          </h1>
          <div className="mt-10 space-y-6">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <span className="text-gray-500">邮箱</span>
              <a href="mailto:nianien@gmail.com" className="text-blue-600 hover:text-blue-500">
                nianien@gmail.com
              </a>
            </div>
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <span className="text-gray-500">GitHub</span>
              <a
                href="https://github.com/nianien"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-500"
              >
                github.com/nianien
              </a>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">公众号</span>
              <span className="text-gray-900 font-medium">xijianghuanyue</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
