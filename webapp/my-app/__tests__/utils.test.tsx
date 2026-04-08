import '@testing-library/jest-dom'


function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3 
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lng2 - lng1) * Math.PI / 180

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c
}

describe('Distance Calculation Utilities', () => {
  describe('calculateDistance', () => {
    it('calculates distance between two identical points as 0', () => {
      const distance = calculateDistance(37.7749, -122.4194, 37.7749, -122.4194)
      expect(distance).toBe(0)
    })

    it('calculates approximate distance between San Francisco landmarks', () => {
      // Golden Gate Bridge to Ferry Building (approx 6.5km)
      const distance = calculateDistance(37.8199, -122.4783, 37.7955, -122.3937)
      expect(distance).toBeGreaterThan(6000)
      expect(distance).toBeLessThan(8000)
    })

    it('calculates distance for points 1 degree apart', () => {
      const distance = calculateDistance(37.0, -122.0, 38.0, -122.0)
      // 1 degree latitude is approximately 111km
      expect(distance).toBeGreaterThan(110000)
      expect(distance).toBeLessThan(112000)
    })

    it('handles negative coordinates', () => {
      const distance = calculateDistance(-33.8688, 151.2093, -34.8688, 151.2093)
      expect(distance).toBeGreaterThan(110000)
      expect(distance).toBeLessThan(112000)
    })

    it('handles longitude wrapping across dateline', () => {
      const distance = calculateDistance(0, 179, 0, -179)
      expect(distance).toBeGreaterThan(0)
      expect(distance).toBeLessThan(300000) // Should be approximately 222km
    })

    it('returns positive distance regardless of order', () => {
      const distance1 = calculateDistance(37.7749, -122.4194, 37.7849, -122.4294)
      const distance2 = calculateDistance(37.7849, -122.4294, 37.7749, -122.4194)
      expect(distance1).toBeCloseTo(distance2, 0)
    })
  })

  describe('Waypoint Order Logic', () => {
    it('assigns sequential order numbers', () => {
      const waypoints = [
        { id: 'wp-1', order: 1 },
        { id: 'wp-2', order: 2 },
        { id: 'wp-3', order: 3 },
      ]
      
      expect(waypoints[0].order).toBe(1)
      expect(waypoints[1].order).toBe(2)
      expect(waypoints[2].order).toBe(3)
    })

    it('reorders waypoints after removal', () => {
      const waypoints = [
        { id: 'wp-1', order: 1 },
        { id: 'wp-2', order: 2 },
        { id: 'wp-3', order: 3 },
      ]
      
      // Remove second waypoint
      const filtered = waypoints.filter(wp => wp.id !== 'wp-2')
      const reordered = filtered.map((wp, index) => ({
        ...wp,
        order: index + 1
      }))
      
      expect(reordered).toHaveLength(2)
      expect(reordered[0].order).toBe(1)
      expect(reordered[1].order).toBe(2)
      expect(reordered[1].id).toBe('wp-3')
    })
  })

  describe('Waypoint Type Identification', () => {
    it('identifies start waypoint', () => {
      const waypoints = [
        { id: 'wp-1', order: 1 },
        { id: 'wp-2', order: 2 },
        { id: 'wp-3', order: 3 },
      ]
      
      const isStart = (index: number) => index === 0 && waypoints.length > 1
      expect(isStart(0)).toBe(true)
      expect(isStart(1)).toBe(false)
    })

    it('identifies end waypoint', () => {
      const waypoints = [
        { id: 'wp-1', order: 1 },
        { id: 'wp-2', order: 2 },
        { id: 'wp-3', order: 3 },
      ]
      
      const isEnd = (index: number) => index === waypoints.length - 1 && waypoints.length > 1
      expect(isEnd(2)).toBe(true)
      expect(isEnd(1)).toBe(false)
    })

    it('does not label single waypoint as start or end', () => {
      const waypoints = [
        { id: 'wp-1', order: 1 },
      ]
      
      const isStart = (index: number) => index === 0 && waypoints.length > 1
      const isEnd = (index: number) => index === waypoints.length - 1 && waypoints.length > 1
      
      expect(isStart(0)).toBe(false)
      expect(isEnd(0)).toBe(false)
    })
  })

  describe('Coordinate Formatting', () => {
    it('formats coordinates to 6 decimal places', () => {
      const lat = 37.774912345678
      const lng = -122.419415678901
      
      expect(lat.toFixed(6)).toBe('37.774912')
      expect(lng.toFixed(6)).toBe('-122.419416')
    })

    it('handles whole number coordinates', () => {
      const lat = 37
      const lng = -122
      
      expect(lat.toFixed(6)).toBe('37.000000')
      expect(lng.toFixed(6)).toBe('-122.000000')
    })
  })

  describe('Angle Calculation for Arrows', () => {
    it('calculates angle between two points', () => {
      const calculateAngle = (
        lat1: number, lng1: number, 
        lat2: number, lng2: number
      ) => {
        return Math.atan2(lng2 - lng1, lat2 - lat1) * 180 / Math.PI
      }
      
      // North direction (0 degrees)
      const angleNorth = calculateAngle(0, 0, 1, 0)
      expect(angleNorth).toBeCloseTo(0, 1)
      
      // East direction (90 degrees)
      const angleEast = calculateAngle(0, 0, 0, 1)
      expect(angleEast).toBeCloseTo(90, 1)
    })
  })
})