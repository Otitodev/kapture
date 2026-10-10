import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface MenuRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  /** Right-aligned hint, usually a keyboard shortcut. Fixed lane so rows line up. */
  hint?: ReactNode;
}

export function MenuRow({ icon, label, hint, className = '', type = 'button', ...rest }: MenuRowProps) {
  return (
    <button
      type={type}
      className={`flex h-10 w-full cursor-pointer items-center gap-3 rounded-sm px-2 text-left text-fg hover:bg-raised focus-visible:bg-raised disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent ${className}`}
      {...rest}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5">{label}</span>
      <span className="w-[76px] shrink-0 text-right font-mono text-[12px] leading-4 text-muted">{hint}</span>
    </button>
  );
}
