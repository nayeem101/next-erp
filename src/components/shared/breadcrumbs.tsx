import Link from "next/link";

export interface BreadcrumbEntry {
  label: string;
  href?: string;
}

/**
 * Accessible breadcrumb trail. The final entry is the current page and must
 * not be a link; earlier entries link when an `href` is supplied.
 */
export function Breadcrumbs({ items }: { items: readonly BreadcrumbEntry[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li
              key={item.href ?? `${item.label}-current`}
              className="flex items-center gap-1"
            >
              {!isLast && item.href ? (
                <>
                  <Link
                    href={item.href}
                    className="rounded hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {item.label}
                  </Link>
                  <span aria-hidden="true">/</span>
                </>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={isLast ? "font-medium text-foreground" : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
