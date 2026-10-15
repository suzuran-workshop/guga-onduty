import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * 进度条 —— 纯 Tailwind 实现（无需 radix 依赖）。
 * shadcn 的 Progress 用 @radix-ui/react-progress；此处为到岗率展示，
 * 语义只需「value 0-100 的横条」，用原生 div + role=progressbar 即可，避免多装一个 peer。
 */
export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0-100 */
  value?: number | null;
}

function Progress({ className, value = 0, ...props }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-secondary', className)}
      {...props}
    >
      <div
        className="h-full rounded-full bg-primary transition-all duration-300"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export { Progress };
