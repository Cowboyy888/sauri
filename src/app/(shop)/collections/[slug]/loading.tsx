export default function CollectionLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="skeleton h-3 w-40" />
      <div className="skeleton mt-4 h-10 w-72" />
      <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i}>
            <div className="skeleton aspect-[4/5] w-full" />
            <div className="skeleton mt-3 h-3 w-20" />
            <div className="skeleton mt-2 h-4 w-32" />
            <div className="skeleton mt-2 h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
