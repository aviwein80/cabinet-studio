/** Thrown when a long run is stopped by its caller. */
export class Cancelled extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'Cancelled'
  }
}

export type CancelCheck = () => boolean

export function checkCancel(isCancelled?: CancelCheck) {
  if (isCancelled?.()) throw new Cancelled()
}
