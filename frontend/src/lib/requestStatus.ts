import type { RequestStatus } from '@/services/api'

type BadgeVariant =
  | 'default'
  | 'primary'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'

/** How each work-request status is labelled and coloured across pages */
export const STATUS_BADGE: Record<
  RequestStatus,
  { label: string; variant: BadgeVariant }
> = {
  open: { label: 'open', variant: 'success' },
  accepted: { label: 'in progress', variant: 'primary' },
  delivered: { label: 'delivered', variant: 'info' },
  closed: { label: 'closed', variant: 'default' },
  declined: { label: 'declined', variant: 'warning' },
  cancelled: { label: 'cancelled', variant: 'default' },
  expired: { label: 'expired', variant: 'error' },
}
