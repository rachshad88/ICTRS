# Make IT Request Cancellable (PENDING status)

## Change

In `frontend-ts/src/pages/Requested.tsx`, line 206, change:

```tsx
{req.status === 'PENDING' && !isAssigned && user?.role === 'CLIENT' && (
```

To:

```tsx
{req.status === 'PENDING' && user?.role === 'CLIENT' && (
```

Removes the `!isAssigned` condition so clients can cancel PENDING requests even if a technician has already been assigned.

## Why this works

- **Backend** (`requests.ts:211-215`) already allows clients to cancel their own PENDING requests regardless of assignment — it only checks `created_by` and `status: 'PENDING'`
- The `isAssigned` variable (`req.assigned_to !== null`) on line 190 is no longer needed for this condition but remains defined — the variable itself can be kept or removed at your discretion
- No backend changes needed
