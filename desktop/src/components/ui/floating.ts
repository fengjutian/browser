export type Placement = 'top' | 'topLeft' | 'topRight' | 'bottom' | 'bottomLeft' | 'bottomRight' | 'left' | 'right'

export function splitPlacement(placement: Placement = 'top'): { side: 'top' | 'bottom' | 'left' | 'right'; align: 'start' | 'center' | 'end' } {
  const side = placement.startsWith('bottom') ? 'bottom' : placement.startsWith('left') ? 'left' : placement.startsWith('right') ? 'right' : 'top'
  const align = placement.endsWith('Left') ? 'start' : placement.endsWith('Right') ? 'end' : 'center'
  return { side, align }
}
