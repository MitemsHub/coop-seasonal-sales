// app/components/ExhibitionProductSkeleton.jsx
// A loading placeholder shaped like ExhibitionProductCard (4:3 photo, two
// name lines, unit line, price, stepper) so the shop does not jump when the
// real cards arrive. A flat grey box of the wrong height made the grid shift
// by a whole row on slow connections.
import Skeleton from './ui/Skeleton'

export default function ExhibitionProductSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface" aria-hidden="true">
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        <Skeleton className="absolute inset-0" rounded="none" />
      </div>
      <div className="flex flex-col gap-1.5 p-2">
        <Skeleton className="h-2.5 w-full" rounded="full" />
        <Skeleton className="h-2.5 w-3/5" rounded="full" />
        <Skeleton className="h-2 w-2/5" rounded="full" />
        <Skeleton className="mt-1 h-3.5 w-1/2" rounded="sm" />
        <Skeleton className="mt-1.5 h-8 w-full" rounded="lg" />
      </div>
    </div>
  )
}
