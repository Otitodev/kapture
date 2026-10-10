import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'text' | 'record' | 'danger';
type Size = 'md' | 'sm';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-fg text-bg',
  secondary: 'border border-rule-strong text-fg hover:bg-raised',
  text: 'text-muted hover:text-fg font-normal px-1',
  record: 'border border-record text-record hover:bg-raised',
  danger: 'bg-record text-on-record',
};

const SIZE: Record<Size, string> = {
  md: 'h-9 px-4 text-[14px] leading-5',
  sm: 'h-7 px-3 text-[13px] leading-[18px]',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${SIZE[size]} ${VARIANT[variant]} ${className}`}
      {...rest}
    />
  );
}
