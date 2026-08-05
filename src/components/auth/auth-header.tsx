import { APP_NAME } from '@/lib/app-config';

interface AuthHeaderProps {
  /**
   * Render the product mark above the title. The auth canvas carries the brand
   * at `lg`+, so only the entry screen (sign-in) needs to introduce the product
   * itself on narrow viewports.
   */
  brandMark?: boolean;
  subtitle: string;
  title: string;
}

/**
 * Title + subtitle block shared by the sign-in, verify and onboarding screens,
 * which each used to ship their own byte-identical copy of this markup.
 */
export function AuthHeader({ title, subtitle, brandMark = false }: AuthHeaderProps) {
  return (
    <div className="flex flex-col gap-1">
      {brandMark && (
        <div className="mb-4 flex items-center gap-2.5 lg:hidden">
          <span
            className="h-6 w-6 rounded-lg ring-1 ring-brand-border"
            style={{ backgroundImage: 'var(--gradient-brand)' }}
          />
          <span className="text-sm font-semibold tracking-tight text-foreground">{APP_NAME}</span>
        </div>
      )}
      <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground">
        {title}
      </h1>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}
