export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-label="Loading content" className="space-y-4">
      <div className="h-7 w-48 animate-pulse rounded bg-muted" />
      <div className="h-10 w-full max-w-md animate-pulse rounded bg-muted" />
      <div className="h-64 w-full animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
