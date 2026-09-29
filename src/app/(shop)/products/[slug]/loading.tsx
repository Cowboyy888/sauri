export default function ProductLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="skeleton h-3 w-52" />
      <div className="mt-6 grid gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="skeleton aspect-[4/5] w-full" />
        <div>
          <div className="skeleton h-4 w-24" />
          <div className="skeleton mt-3 h-9 w-64" />
          <div className="skeleton mt-4 h-7 w-28" />
          <div className="skeleton mt-6 h-20 w-full" />
          <div className="skeleton mt-8 h-12 w-full" />
        </div>
      </div>
    </div>
  );
}
