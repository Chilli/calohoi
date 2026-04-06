import { useEffect, useMemo, useRef, useState } from 'react'
import { applySwUpdate } from './lib/swUpdate'

import { Button } from './components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog'
import { useLocalStorageState } from './lib/useLocalStorageState'

type Sex = 'male' | 'female'

type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'very'

type GoalMode = 'cut' | 'maintain' | 'bulk'

type Profile = {
  sex: Sex
  ageYears: number
  birthdateISO?: string
  heightCm: number
  weightKg: number
  activity: ActivityLevel
  goalMode: GoalMode
  goalDeltaKcal: number
}

type MacroTargets = {
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number
}

type Meal = 'breakfast' | 'lunch' | 'snack' | 'dinner'

const MEALS: { key: Meal; label: string; icon: string }[] = [
  { key: 'breakfast', label: 'Breakfast', icon: '☀️' },
  { key: 'lunch', label: 'Lunch', icon: '🥗' },
  { key: 'snack', label: 'Snack', icon: '🍎' },
  { key: 'dinner', label: 'Dinner', icon: '🍽️' },
]

type DiaryEntry = {
  id: string
  meal: Meal
  name: string
  caloriesKcal: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number
  createdAt: string
}

function clampNumber(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function parseOptionalNumber(s: string) {
  const trimmed = s.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return null
  return n
}

function newId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

type FoodNutrients = {
  caloriesKcal?: number
  proteinG?: number
  carbsG?: number
  fatG?: number
  fiberG?: number
}

type OffProduct = {
  code: string
  productName: string
  brands?: string
  imageUrl?: string
  nutrimentsPer100g: FoodNutrients
}

type OffSearchItem = {
  code: string
  productName: string
  brands?: string
  imageUrl?: string
  source?: 'mvt' | 'off'
  nutrimentsPer100g: FoodNutrients
}

type MvtFood = { n: string; k: number; p: number; c: number; f: number; fi: number }
let mvtCache: MvtFood[] | null = null
async function loadMvt(): Promise<MvtFood[]> {
  if (mvtCache) return mvtCache
  const base = import.meta.env.BASE_URL ?? '/'
  const res = await fetch(`${base}matvaretabellen.json`)
  if (!res.ok) return []
  mvtCache = (await res.json()) as MvtFood[]
  return mvtCache
}

function searchMvt(foods: MvtFood[], query: string): OffSearchItem[] {
  const q = query.toLowerCase()
  const words = q.split(/\s+/).filter(Boolean)
  const scored = foods
    .map((f) => {
      const name = f.n.toLowerCase()
      const allMatch = words.every((w) => name.includes(w))
      if (!allMatch) return null
      const startsWithQ = name.startsWith(q)
      const isRaw = name.includes('rå')
      let score = 0
      if (startsWithQ) score += 100
      if (isRaw) score += 50
      if (name === q) score += 200
      score -= name.length
      return { food: f, score }
    })
    .filter((x): x is { food: MvtFood; score: number } => x !== null)
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 15).map((s) => ({
    code: `mvt-${s.food.n}`,
    productName: s.food.n,
    brands: 'Matvaretabellen',
    source: 'mvt' as const,
    nutrimentsPer100g: {
      caloriesKcal: s.food.k,
      proteinG: s.food.p,
      carbsG: s.food.c,
      fatG: s.food.f,
      fiberG: s.food.fi,
    },
  }))
}

async function searchOffProducts(query: string, signal?: AbortSignal): Promise<OffSearchItem[]> {
  const q = query.trim()
  if (!q) return []
  const url = `https://world.openfoodfacts.org/api/v2/search?search_terms=${encodeURIComponent(q)}&page_size=50&fields=code,product_name,brands,image_front_small_url,nutriments,categories_tags,popularity_key`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  const data: unknown = await res.json()
  const root = data as { products?: Array<Record<string, unknown>> }
  const products = root.products ?? []
  const qLower = q.toLowerCase()

  const items = products
    .map((p) => {
      const nutr = (p.nutriments as Record<string, unknown> | undefined) ?? {}
      const caloriesKcal =
        (typeof nutr['energy-kcal_100g'] === 'number' ? (nutr['energy-kcal_100g'] as number) : undefined) ??
        (typeof nutr['energy-kcal'] === 'number' ? (nutr['energy-kcal'] as number) : undefined)

      const item: OffSearchItem = {
        code: String(p.code ?? ''),
        productName: String(p.product_name ?? '').trim() || 'Unknown product',
        brands: typeof p.brands === 'string' ? p.brands.trim() || undefined : undefined,
        imageUrl:
          typeof p.image_front_small_url === 'string' ? (p.image_front_small_url as string) : undefined,
        nutrimentsPer100g: {
          caloriesKcal,
          proteinG: typeof nutr['proteins_100g'] === 'number' ? (nutr['proteins_100g'] as number) : undefined,
          carbsG:
            typeof nutr['carbohydrates_100g'] === 'number'
              ? (nutr['carbohydrates_100g'] as number)
              : undefined,
          fatG: typeof nutr['fat_100g'] === 'number' ? (nutr['fat_100g'] as number) : undefined,
          fiberG: typeof nutr['fiber_100g'] === 'number' ? (nutr['fiber_100g'] as number) : undefined,
        },
      }
      if (!item.code) return null
      if (item.nutrimentsPer100g.caloriesKcal == null) return null

      const cats = Array.isArray(p.categories_tags) ? (p.categories_tags as string[]) : []
      const nameLower = item.productName.toLowerCase()
      const nameMatch = nameLower.includes(qLower)
      const isBeverage = cats.some((c) => c.includes('beverage') || c.includes('juice') || c.includes('drink'))
      const isRaw = cats.some((c) => c.includes('fresh-food') || c.includes('plant-based') || c.includes('fruit') || c.includes('vegetable') || c.includes('meat') || c.includes('fish'))
      const pop = typeof p.popularity_key === 'number' ? (p.popularity_key as number) : 0

      let score = pop
      if (nameMatch) score += 1_000_000_000
      if (isRaw) score += 500_000_000
      if (isBeverage && !nameLower.includes(qLower)) score -= 500_000_000

      return { item, score }
    })
    .filter((x): x is { item: OffSearchItem; score: number } => Boolean(x))

  items.sort((a, b) => b.score - a.score)
  return items.slice(0, 20).map((x) => x.item)
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}

function toLocalDateKeyFromISO(iso: string) {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function toLocalDateKey(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDaysToDateKey(dateKey: string, deltaDays: number) {
  const [y, m, d] = dateKey.split('-').map((x) => Number(x))
  if (!y || !m || !d) return dateKey
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + deltaDays)
  return toLocalDateKey(dt)
}

function activityMultiplier(level: ActivityLevel) {
  switch (level) {
    case 'sedentary':
      return 1.2
    case 'light':
      return 1.375
    case 'moderate':
      return 1.55
    case 'very':
      return 1.725
  }
}

function mifflinStJeorBmr(profile: Pick<Profile, 'sex' | 'weightKg' | 'heightCm' | 'ageYears'>) {
  const base = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.ageYears
  return profile.sex === 'male' ? base + 5 : base - 161
}

function ageFromBirthdateISO(birthdateISO?: string) {
  if (!birthdateISO) return null
  const d = new Date(birthdateISO)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1
  return age
}

function clampIntOrFallback(value: string, min: number, max: number, fallback: number) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return clampNumber(Math.round(n), min, max)
}

function App() {
  const [profile, setProfile] = useLocalStorageState<Profile>({
    key: 'calorieohhoi.profile.v1',
    defaultValue: {
      sex: 'male',
      ageYears: 30,
      birthdateISO: undefined,
      heightCm: 180,
      weightKg: 80,
      activity: 'moderate',
      goalMode: 'cut',
      goalDeltaKcal: 500,
    },
  })

  const [activeTab, setActiveTab] = useState<'home' | 'diary' | 'scan' | 'profile'>('home')

  const [swUpdateAvailable, setSwUpdateAvailable] = useState(false)
  useEffect(() => {
    const handler = () => setSwUpdateAvailable(true)
    window.addEventListener('sw-update-available', handler)
    return () => window.removeEventListener('sw-update-available', handler)
  }, [])

  const [profileDraft, setProfileDraft] = useState<{
    sex: Sex
    activity: ActivityLevel
    goalMode: GoalMode
    birthdateISO: string
    heightCm: string
    weightKg: string
    goalDeltaKcal: string
  }>(() => ({
    sex: profile.sex,
    activity: profile.activity,
    goalMode: profile.goalMode,
    birthdateISO: profile.birthdateISO ?? '',
    heightCm: String(profile.heightCm),
    weightKg: String(profile.weightKg),
    goalDeltaKcal: String(profile.goalDeltaKcal),
  }))

  useEffect(() => {
    if (activeTab !== 'profile' && activeTab !== 'diary') return
    setProfileDraft({
      sex: profile.sex,
      activity: profile.activity,
      goalMode: profile.goalMode,
      birthdateISO: profile.birthdateISO ?? '',
      heightCm: String(profile.heightCm),
      weightKg: String(profile.weightKg),
      goalDeltaKcal: String(profile.goalDeltaKcal),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  const [profileJustSaved, setProfileJustSaved] = useState(false)

  const [macroTargets, setMacroTargets] = useLocalStorageState<MacroTargets>({
    key: 'calorieohhoi.macroTargets.v1',
    defaultValue: {
      proteinG: 160,
      carbsG: 200,
      fatG: 70,
      fiberG: 30,
    },
  })

  const [diaryEntries, setDiaryEntries] = useLocalStorageState<DiaryEntry[]>({
    key: 'calorieohhoi.diaryEntries.v1',
    defaultValue: [],
  })

  const [currentMeal, setCurrentMeal] = useState<Meal>('breakfast')
  const [selectedDateKey, setSelectedDateKey] = useState(() => toLocalDateKey(new Date()))
  const [addFoodOpen, setAddFoodOpen] = useState(false)
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [quickAddStep, setQuickAddStep] = useState<'meal' | 'method'>('meal')
  const [foodSearchQuery, setFoodSearchQuery] = useState('')
  const [foodSearchResults, setFoodSearchResults] = useState<OffSearchItem[]>([])
  const [foodSearchLoading, setFoodSearchLoading] = useState(false)
  const [foodSearchError, setFoodSearchError] = useState<string | null>(null)
  const [selectedFood, setSelectedFood] = useState<OffSearchItem | null>(null)
  const [manualGramsText, setManualGramsText] = useState('100')
  const [barcode, setBarcode] = useState('')
  const [offProduct, setOffProduct] = useState<OffProduct | null>(null)
  const [offError, setOffError] = useState<string | null>(null)
  const [offLoading, setOffLoading] = useState(false)
  const [gramsText, setGramsText] = useState('100')
  const [servings, setServings] = useState(1)
  const [manualBarcodeEntry, setManualBarcodeEntry] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const barcodeInputRef = useRef<HTMLInputElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanLoopRef = useRef<number | null>(null)
  const foundRef = useRef(false)
  const lastCandidateRef = useRef<string>('')
  const stableCountRef = useRef(0)

  useEffect(() => {
    if (!addFoodOpen) return
    setFoodSearchError(null)
    setFoodSearchResults([])
    setFoodSearchLoading(false)
    setFoodSearchQuery('')
    setSelectedFood(null)
    setManualGramsText('100')
  }, [addFoodOpen])

  useEffect(() => {
    if (!addFoodOpen) return
    const q = foodSearchQuery.trim()
    if (!q) {
      setFoodSearchResults([])
      setFoodSearchError(null)
      setFoodSearchLoading(false)
      return
    }

    const controller = new AbortController()
    const t = window.setTimeout(() => {
      setFoodSearchLoading(true)
      setFoodSearchError(null)
      void (async () => {
        try {
          const mvtFoods = await loadMvt()
          const mvtResults = searchMvt(mvtFoods, q)
          if (controller.signal.aborted) return
          setFoodSearchResults(mvtResults)

          const offResults = await searchOffProducts(q, controller.signal)
          if (controller.signal.aborted) return
          const mvtCodes = new Set(mvtResults.map((r) => r.code))
          const merged = [...mvtResults, ...offResults.filter((r) => !mvtCodes.has(r.code))]
          setFoodSearchResults(merged)
        } catch (e) {
          if ((e as { name?: string }).name === 'AbortError') return
          setFoodSearchError(e instanceof Error ? e.message : 'Search failed')
        } finally {
          setFoodSearchLoading(false)
        }
      })()
    }, 250)

    return () => {
      window.clearTimeout(t)
      controller.abort()
    }
  }, [addFoodOpen, foodSearchQuery])

  function stopCamera() {
    if (scanLoopRef.current) {
      window.cancelAnimationFrame(scanLoopRef.current)
      scanLoopRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }

  const canBarcodeDetect =
    typeof window !== 'undefined' &&
    'BarcodeDetector' in window &&
    typeof (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector !== 'undefined'

  const computedAgeYears = useMemo(() => {
    return ageFromBirthdateISO(profile.birthdateISO) ?? profile.ageYears
  }, [profile.ageYears, profile.birthdateISO])

  const profileIsDirty = useMemo(() => {
    const birthdateISO = profileDraft.birthdateISO.trim() ? profileDraft.birthdateISO.trim() : undefined
    return (
      profileDraft.sex !== profile.sex ||
      profileDraft.activity !== profile.activity ||
      profileDraft.goalMode !== profile.goalMode ||
      birthdateISO !== profile.birthdateISO ||
      profileDraft.heightCm.trim() !== String(profile.heightCm) ||
      profileDraft.weightKg.trim() !== String(profile.weightKg) ||
      profileDraft.goalDeltaKcal.trim() !== String(profile.goalDeltaKcal)
    )
  }, [profile.birthdateISO, profile.goalDeltaKcal, profile.heightCm, profile.weightKg, profileDraft.birthdateISO, profileDraft.goalDeltaKcal, profileDraft.heightCm, profileDraft.weightKg])

  const profilePreview = useMemo(() => {
    const heightCm = clampIntOrFallback(profileDraft.heightCm, 120, 230, profile.heightCm)
    const weightKg = clampIntOrFallback(profileDraft.weightKg, 30, 250, profile.weightKg)
    const goalDeltaKcal = clampIntOrFallback(profileDraft.goalDeltaKcal, 0, 1500, profile.goalDeltaKcal)
    const birthdateISO = profileDraft.birthdateISO.trim() ? profileDraft.birthdateISO.trim() : profile.birthdateISO
    const ageYears = ageFromBirthdateISO(birthdateISO) ?? computedAgeYears
    return {
      ...profile,
      sex: profileDraft.sex,
      activity: profileDraft.activity,
      goalMode: profileDraft.goalMode,
      heightCm,
      weightKg,
      goalDeltaKcal,
      birthdateISO,
      ageYears,
    }
  }, [computedAgeYears, profile, profileDraft.birthdateISO, profileDraft.goalDeltaKcal, profileDraft.heightCm, profileDraft.weightKg])

  const tdee = useMemo(() => {
    const bmr = mifflinStJeorBmr({ ...profile, ageYears: computedAgeYears })
    const mult = activityMultiplier(profile.activity)
    return Math.round(bmr * mult)
  }, [computedAgeYears, profile])

  const tdeePreview = useMemo(() => {
    const bmr = mifflinStJeorBmr(profilePreview)
    const mult = activityMultiplier(profilePreview.activity)
    return Math.round(bmr * mult)
  }, [profilePreview])

  const goalCalories = useMemo(() => {
    const delta = Math.round(clampNumber(profile.goalDeltaKcal, 0, 1500))
    if (profile.goalMode === 'maintain') return tdee
    if (profile.goalMode === 'cut') return Math.max(1200, tdee - delta)
    return tdee + delta
  }, [profile.goalDeltaKcal, profile.goalMode, tdee])

  const goalCaloriesPreview = useMemo(() => {
    const delta = Math.round(clampNumber(profilePreview.goalDeltaKcal, 0, 1500))
    if (profilePreview.goalMode === 'maintain') return tdeePreview
    if (profilePreview.goalMode === 'cut') return Math.max(1200, tdeePreview - delta)
    return tdeePreview + delta
  }, [profilePreview.goalDeltaKcal, profilePreview.goalMode, tdeePreview])

  const macroTargetCalories = useMemo(() => {
    const protein = clampNumber(macroTargets.proteinG, 0, 600) * 4
    const carbs = clampNumber(macroTargets.carbsG, 0, 1000) * 4
    const fat = clampNumber(macroTargets.fatG, 0, 400) * 9
    const fiber = clampNumber(macroTargets.fiberG, 0, 200) * 2
    return Math.round(protein + carbs + fat + fiber)
  }, [macroTargets.carbsG, macroTargets.fatG, macroTargets.fiberG, macroTargets.proteinG])

  const diaryEntriesForDay = useMemo(() => {
    return diaryEntries.filter((e) => toLocalDateKeyFromISO(e.createdAt) === selectedDateKey)
  }, [diaryEntries, selectedDateKey])

  const macroSplit = useMemo(() => {
    const proteinKcal = clampNumber(macroTargets.proteinG, 0, 600) * 4
    const carbsKcal = clampNumber(macroTargets.carbsG, 0, 1000) * 4
    const fatKcal = clampNumber(macroTargets.fatG, 0, 400) * 9
    const fiberKcal = clampNumber(macroTargets.fiberG, 0, 200) * 2
    const total = Math.max(1, proteinKcal + carbsKcal + fatKcal + fiberKcal)
    return {
      proteinPct: proteinKcal / total,
      carbsPct: carbsKcal / total,
      fatPct: fatKcal / total,
      fiberPct: fiberKcal / total,
    }
  }, [macroTargets.carbsG, macroTargets.fatG, macroTargets.fiberG, macroTargets.proteinG])

  const prevGoalRef = useRef(goalCalories)
  useEffect(() => {
    const prev = prevGoalRef.current
    prevGoalRef.current = goalCalories
    if (prev === goalCalories || goalCalories <= 0) return
    const oldTotal = Math.max(1, macroTargetCalories)
    const scale = goalCalories / oldTotal
    setMacroTargets((t) => ({
      ...t,
      proteinG: clampNumber(Math.round(t.proteinG * scale * 10) / 10, 0, 600),
      carbsG: clampNumber(Math.round(t.carbsG * scale * 10) / 10, 0, 1000),
      fatG: clampNumber(Math.round(t.fatG * scale * 10) / 10, 0, 400),
      fiberG: clampNumber(Math.round(t.fiberG * scale * 10) / 10, 0, 200),
    }))
  }, [goalCalories])

  function MacroWheel({ size = 120 }: { size?: number }) {
    const stroke = 14
    const r = (size - stroke) / 2
    const c = 2 * Math.PI * r
    const gap = 2
    const seg = {
      carbs: macroSplit.carbsPct,
      protein: macroSplit.proteinPct,
      fat: macroSplit.fatPct,
      fiber: macroSplit.fiberPct,
    }
    const macroVsGoal = goalCalories > 0 ? clampNumber(macroTargetCalories / goalCalories, 0, 2) : 0
    const pctText = Math.round(macroVsGoal * 100)

    const parts = [
      { key: 'carbs', color: '#0ea5e9', frac: seg.carbs },
      { key: 'protein', color: '#22c55e', frac: seg.protein },
      { key: 'fat', color: '#8b5cf6', frac: seg.fat },
      { key: 'fiber', color: '#f59e0b', frac: seg.fiber },
    ]

    let offset = 0
    return (
      <div className="flex items-center justify-center">
        <div className="relative">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="#e5e7eb"
              strokeWidth={stroke}
            />
            {parts.map((p) => {
              const dash = Math.max(0, c * p.frac - gap)
              const d = (
                <circle
                  key={p.key}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={p.color}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  strokeDasharray={`${dash} ${c - dash}`}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              )
              offset += c * p.frac
              return d
            })}
          </svg>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center leading-none">
            <div className="text-lg font-semibold text-zinc-900">{pctText}%</div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
          {parts.map((p) => (
            <div key={p.key} className="flex items-center gap-1 text-[10px] text-zinc-600">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
              {p.key === 'carbs' ? 'Carbs' : p.key === 'protein' ? 'Protein' : p.key === 'fat' ? 'Fat' : 'Fiber'} {Math.round(p.frac * 100)}%
            </div>
          ))}
        </div>
      </div>
    )
  }

  const totals = useMemo(() => {
    return diaryEntriesForDay.reduce(
      (acc, e) => {
        acc.caloriesKcal += clampNumber(e.caloriesKcal, 0, 100000)
        acc.proteinG += clampNumber(e.proteinG, 0, 100000)
        acc.carbsG += clampNumber(e.carbsG, 0, 100000)
        acc.fatG += clampNumber(e.fatG, 0, 100000)
        acc.fiberG += clampNumber(e.fiberG, 0, 100000)
        return acc
      },
      { caloriesKcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
    )
  }, [diaryEntriesForDay])

  const dayMacroKcal = useMemo(() => {
    const proteinKcal = totals.proteinG * 4
    const carbsKcal = totals.carbsG * 4
    const fatKcal = totals.fatG * 9
    const fiberKcal = totals.fiberG * 2
    const total = Math.max(1, proteinKcal + carbsKcal + fatKcal + fiberKcal)
    return {
      proteinKcal,
      carbsKcal,
      fatKcal,
      fiberKcal,
      total,
      proteinPct: proteinKcal / total,
      carbsPct: carbsKcal / total,
      fatPct: fatKcal / total,
      fiberPct: fiberKcal / total,
    }
  }, [totals.carbsG, totals.fatG, totals.fiberG, totals.proteinG])

  const remaining = useMemo(() => {
    return {
      caloriesKcal: goalCalories - totals.caloriesKcal,
      proteinG: macroTargets.proteinG - totals.proteinG,
      carbsG: macroTargets.carbsG - totals.carbsG,
      fatG: macroTargets.fatG - totals.fatG,
      fiberG: macroTargets.fiberG - totals.fiberG,
    }
  }, [goalCalories, macroTargets, totals])

  function deleteEntry(id: string) {
    setDiaryEntries((prev) => prev.filter((e) => e.id !== id))
  }

  async function fetchOffProduct(code: string) {
    const cleaned = code.replace(/\D/g, '')
    if (!cleaned) return
    setOffLoading(true)
    setOffError(null)
    setOffProduct(null)
    try {
      const url = `https://world.openfoodfacts.org/api/v2/product/${cleaned}.json`
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`)
      }
      const data: unknown = await res.json()

      const root = data as {
        code?: string
        status?: number
        product?: {
          product_name?: string
          brands?: string
          image_front_small_url?: string
          nutriments?: Record<string, unknown>
        }
      }

      if (root.status !== 1 || !root.product) {
        setOffError('Not found in Open Food Facts')
        return
      }

      const nutr = root.product.nutriments ?? {}
      const caloriesKcal =
        (typeof nutr['energy-kcal_100g'] === 'number' ? (nutr['energy-kcal_100g'] as number) : undefined) ??
        (typeof nutr['energy-kcal'] === 'number' ? (nutr['energy-kcal'] as number) : undefined)

      const product: OffProduct = {
        code: cleaned,
        productName: root.product.product_name?.trim() || 'Unknown product',
        brands: root.product.brands?.trim() || undefined,
        imageUrl: root.product.image_front_small_url || undefined,
        nutrimentsPer100g: {
          caloriesKcal,
          proteinG: typeof nutr['proteins_100g'] === 'number' ? (nutr['proteins_100g'] as number) : undefined,
          carbsG:
            typeof nutr['carbohydrates_100g'] === 'number'
              ? (nutr['carbohydrates_100g'] as number)
              : undefined,
          fatG: typeof nutr['fat_100g'] === 'number' ? (nutr['fat_100g'] as number) : undefined,
          fiberG: typeof nutr['fiber_100g'] === 'number' ? (nutr['fiber_100g'] as number) : undefined,
        },
      }
      setOffProduct(product)
    } catch (e) {
      setOffError(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setOffLoading(false)
    }
  }

  function addOffServingToDiary(grams: number) {
    if (!offProduct) return
    const safeGrams = clampNumber(Number(grams || 0), 0.1, 2000)
    const factor = safeGrams / 100
    const n = offProduct.nutrimentsPer100g
    const entry: DiaryEntry = {
      id: newId(),
      createdAt: new Date().toISOString(),
      meal: currentMeal,
      name: `${offProduct.productName}${offProduct.brands ? ` (${offProduct.brands})` : ''}`,
      caloriesKcal: Math.round((n.caloriesKcal ?? 0) * factor),
      proteinG: round1((n.proteinG ?? 0) * factor),
      carbsG: round1((n.carbsG ?? 0) * factor),
      fatG: round1((n.fatG ?? 0) * factor),
      fiberG: round1((n.fiberG ?? 0) * factor),
    }
    setDiaryEntries((prev) => [entry, ...prev])
  }

  function addSearchFoodToDiary(food: OffSearchItem, grams: number) {
    const safeGrams = clampNumber(Number(grams || 0), 0.1, 2000)
    const factor = safeGrams / 100
    const n = food.nutrimentsPer100g
    const entry: DiaryEntry = {
      id: newId(),
      createdAt: new Date().toISOString(),
      meal: currentMeal,
      name: `${food.productName}${food.brands ? ` (${food.brands})` : ''}`,
      caloriesKcal: Math.round((n.caloriesKcal ?? 0) * factor),
      proteinG: round1((n.proteinG ?? 0) * factor),
      carbsG: round1((n.carbsG ?? 0) * factor),
      fatG: round1((n.fatG ?? 0) * factor),
      fiberG: round1((n.fiberG ?? 0) * factor),
    }
    setDiaryEntries((prev) => [entry, ...prev])
  }

  useEffect(() => {
    if (activeTab !== 'scan') return
    setOffError(null)
    setOffProduct(null)
    setBarcode('')
    setGramsText('100')
    setServings(1)
    setManualBarcodeEntry(false)
    foundRef.current = false
    lastCandidateRef.current = ''
    stableCountRef.current = 0
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'scan' || !canBarcodeDetect) return
    let cancelled = false

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()

        const Detector = (window as unknown as { BarcodeDetector: new (arg?: unknown) => { detect: (v: HTMLVideoElement) => Promise<Array<{ rawValue?: string }> > } }).BarcodeDetector
        const detector = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] })

        const loop = async () => {
          if (cancelled || foundRef.current) return
          try {
            const barcodes = await detector.detect(video)
            const value = barcodes?.[0]?.rawValue
            if (value) {
              const cleaned = value.replace(/\D/g, '')
              const isComplete = cleaned.length === 13 || cleaned.length === 8
              if (isComplete) {
                if (cleaned === lastCandidateRef.current) {
                  stableCountRef.current += 1
                } else {
                  lastCandidateRef.current = cleaned
                  stableCountRef.current = 1
                }

                // Require the same complete code a few frames in a row (reduces missing digits)
                if (stableCountRef.current >= 3) {
                  foundRef.current = true
                  setBarcode(cleaned)
                  fetchOffProduct(cleaned)
                  stopCamera()
                  return
                }
              }
            }
          } catch {
            // ignore detection errors
          }
          scanLoopRef.current = window.requestAnimationFrame(loop)
        }

        scanLoopRef.current = window.requestAnimationFrame(loop)
      } catch {
        setOffError('Camera not available')
      }
    }

    void startCamera()
    return () => {
      cancelled = true
      stopCamera()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  const calorieProgress = useMemo(() => {
    if (goalCalories <= 0) return 0
    return clampNumber(totals.caloriesKcal / goalCalories, 0, 1)
  }, [goalCalories, totals.caloriesKcal])

  function ProgressRing({ value }: { value: number }) {
    const size = 180
    const stroke = 14
    const r = (size - stroke) / 2
    const c = 2 * Math.PI * r
    const dash = c * clampNumber(value, 0, 1)
    const gap = c - dash

    return (
      <div className="relative grid place-items-center">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="drop-shadow-sm">
          <defs>
            <linearGradient id="cal-ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#22c55e" />
              <stop offset="1" stopColor="#14b8a6" />
            </linearGradient>
          </defs>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="url(#cal-ring)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${gap}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <div className="absolute grid place-items-center text-center">
          <div className="text-[11px] font-medium text-zinc-500">kcal left</div>
          <div className="mt-1 text-4xl font-semibold tracking-tight text-zinc-900">
            {Math.max(0, remaining.caloriesKcal)}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {totals.caloriesKcal} eaten / {goalCalories} goal
          </div>
        </div>
      </div>
    )
  }

  function MacroChip({
    label,
    current,
    target,
    unit,
    tone,
  }: {
    label: string
    current: number
    target: number
    unit: string
    tone: 'emerald' | 'sky' | 'violet' | 'amber'
  }) {
    const p = target > 0 ? clampNumber(current / target, 0, 1) : 0
    const pct = Math.round(p * 10) * 10
    const widthClass =
      {
        0: 'w-0',
        10: 'w-[10%]',
        20: 'w-[20%]',
        30: 'w-[30%]',
        40: 'w-[40%]',
        50: 'w-[50%]',
        60: 'w-[60%]',
        70: 'w-[70%]',
        80: 'w-[80%]',
        90: 'w-[90%]',
        100: 'w-full',
      }[clampNumber(pct, 0, 100) as 0 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100] ?? 'w-0'
    const bar = {
      emerald: 'bg-emerald-500',
      sky: 'bg-sky-500',
      violet: 'bg-violet-500',
      amber: 'bg-amber-500',
    }[tone]
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
        <div className="flex items-baseline justify-between">
          <div className="text-xs font-medium text-zinc-500">{label}</div>
          <div className="text-[11px] text-zinc-500">
            {current} / {target}
            {unit}
          </div>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-100">
          <div className={`h-full ${bar} ${widthClass}`} />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900 [background:radial-gradient(900px_circle_at_50%_-20%,rgba(16,185,129,0.20),transparent_55%),radial-gradient(900px_circle_at_10%_20%,rgba(56,189,248,0.15),transparent_50%),linear-gradient(to_bottom,#fafafa,#f4f4f5)]">
      {swUpdateAvailable && (
        <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg">
          <span>New version available</span>
          <button
            className="rounded-lg bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur hover:bg-white/30"
            onClick={() => applySwUpdate()}
          >
            Update now
          </button>
        </div>
      )}
      <div className="mx-auto max-w-sm px-3 pb-24 pt-4">
        {activeTab === 'home' ? (
          <div className="mt-6 grid gap-4">
            <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="grid place-items-center">
                <ProgressRing value={calorieProgress} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <MacroChip
                label="Carbs"
                current={totals.carbsG}
                target={macroTargets.carbsG}
                unit="g"
                tone="sky"
              />
              <MacroChip
                label="Protein"
                current={totals.proteinG}
                target={macroTargets.proteinG}
                unit="g"
                tone="emerald"
              />
              <MacroChip
                label="Fat"
                current={totals.fatG}
                target={macroTargets.fatG}
                unit="g"
                tone="violet"
              />
              <MacroChip
                label="Fiber"
                current={totals.fiberG}
                target={macroTargets.fiberG}
                unit="g"
                tone="amber"
              />
            </div>

            <div className="mt-2 grid gap-4">
              {MEALS.map((m) => {
                const mealEntries = diaryEntriesForDay.filter((e) => e.meal === m.key)
                const mealKcal = mealEntries.reduce((s, e) => s + e.caloriesKcal, 0)
                return (
                  <div key={m.key} className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{m.icon}</span>
                        <div>
                          <div className="text-sm font-semibold text-zinc-900">{m.label}</div>
                          {mealKcal > 0 && <div className="text-[11px] text-zinc-500">{mealKcal} kcal</div>}
                        </div>
                      </div>
                    </div>

                    {mealEntries.length > 0 ? (
                      <div className="mt-3 grid gap-1.5">
                        {mealEntries.map((e) => (
                          <div
                            key={e.id}
                            className="flex items-center justify-between gap-2 rounded-xl bg-zinc-50 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-zinc-900">{e.name}</div>
                              <div className="text-[11px] text-zinc-500">
                                {e.caloriesKcal} kcal · P {e.proteinG}g · C {e.carbsG}g · F {e.fatG}g
                              </div>
                            </div>
                            <button
                              className="shrink-0 text-xs text-zinc-400"
                              onClick={() => deleteEntry(e.id)}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-2xl bg-zinc-50 p-3 text-xs text-zinc-500">No items yet.</div>
                    )}

                    <button
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700"
                      onClick={() => {
                        setCurrentMeal(m.key)
                        setQuickAddOpen(true)
                        setQuickAddStep('method')
                      }}
                    >
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-sm font-bold text-white">
                        +
                      </span>
                      Add to {m.label}
                    </button>
                  </div>
                )
              })}
            </div>

          </div>
        ) : null}

        {activeTab === 'diary' ? (
          <div className="mt-6 grid gap-4">
            <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-zinc-900">{selectedDateKey}</div>
                <div className="flex items-center gap-1.5">
                  <button
                    className="h-9 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700"
                    onClick={() => setSelectedDateKey((k) => addDaysToDateKey(k, -1))}
                  >
                    ‹
                  </button>
                  <button
                    className="h-9 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-xs font-semibold text-zinc-700"
                    onClick={() => setSelectedDateKey(toLocalDateKey(new Date()))}
                  >
                    ⟳
                  </button>
                  <button
                    className="h-9 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700"
                    onClick={() => setSelectedDateKey((k) => addDaysToDateKey(k, 1))}
                  >
                    ›
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-zinc-50 p-3">
                  <div className="text-xs text-zinc-500">Calories eaten</div>
                  <div className="mt-1 text-lg font-semibold text-zinc-900">{totals.caloriesKcal} kcal</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">of {goalCalories} kcal goal</div>
                </div>
                <div className="rounded-2xl bg-zinc-50 p-3">
                  <div className="text-xs text-zinc-500">Macro split</div>
                  <div className="mt-1 text-[11px] font-medium text-zinc-700">
                    C {Math.round(dayMacroKcal.carbsPct * 100)}% · P {Math.round(dayMacroKcal.proteinPct * 100)}% · F {Math.round(dayMacroKcal.fatPct * 100)}%
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    P {round1(totals.proteinG)}g · C {round1(totals.carbsG)}g · F {round1(totals.fatG)}g · Fi {round1(totals.fiberG)}g
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              {MEALS.map((m) => {
                const mealEntries = diaryEntriesForDay.filter((e) => e.meal === m.key)
                const mealKcal = mealEntries.reduce((s, e) => s + e.caloriesKcal, 0)
                if (mealEntries.length === 0) return null
                return (
                  <div key={m.key} className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{m.icon}</span>
                      <div>
                        <div className="text-sm font-semibold text-zinc-900">{m.label}</div>
                        <div className="text-[11px] text-zinc-500">{mealKcal} kcal</div>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-1.5">
                      {mealEntries.map((e) => (
                        <div
                          key={e.id}
                          className="flex items-center justify-between gap-2 rounded-xl bg-zinc-50 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-zinc-900">{e.name}</div>
                            <div className="text-[11px] text-zinc-500">
                              {e.caloriesKcal} kcal · P {e.proteinG}g · C {e.carbsG}g · F {e.fatG}g
                            </div>
                          </div>
                          <button
                            className="shrink-0 text-xs text-zinc-400"
                            onClick={() => deleteEntry(e.id)}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
              {diaryEntriesForDay.length === 0 && (
                <div className="rounded-3xl border border-zinc-200 bg-white p-4 text-center text-sm text-zinc-500 shadow-sm">
                  No entries for this day.
                </div>
              )}
            </div>
          </div>
        ) : null}

        <Dialog
          open={quickAddOpen}
          onOpenChange={(open) => {
            setQuickAddOpen(open)
            if (open) {
              setQuickAddStep('meal')
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add food</DialogTitle>
              <DialogDescription>Choose meal, then scan or add manually.</DialogDescription>
            </DialogHeader>

            {quickAddStep === 'meal' ? (
              <div className="grid grid-cols-2 gap-3">
                {MEALS.map((m) => (
                  <button
                    key={m.key}
                    className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 text-left"
                    onClick={() => {
                      setCurrentMeal(m.key)
                      setQuickAddStep('method')
                    }}
                  >
                    <div className="text-sm font-semibold text-zinc-900">{m.icon} {m.label}</div>
                    <div className="mt-1 text-[11px] text-zinc-500">Add to this meal</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                  <div className="text-xs font-medium text-zinc-500">Meal</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900">
                    {MEALS.find((m) => m.key === currentMeal)?.label}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuickAddOpen(false)
                      setAddFoodOpen(true)
                    }}
                  >
                    Search food
                  </Button>
                  <Button
                    variant="outline"
                    className="text-zinc-900"
                    onClick={() => {
                      setQuickAddOpen(false)
                      setActiveTab('scan')
                    }}
                  >
                    Scan barcode
                  </Button>
                </div>

                <Button variant="ghost" onClick={() => setQuickAddStep('meal')}>
                  Back
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={addFoodOpen} onOpenChange={setAddFoodOpen}>
          <DialogContent className="!inset-0 !bottom-0 !top-0 !max-h-none !w-full !max-w-none !translate-x-0 !translate-y-0 !rounded-none sm:!inset-auto sm:!bottom-auto sm:!left-1/2 sm:!top-8 sm:!max-h-[85dvh] sm:!max-w-md sm:!-translate-x-1/2 sm:!translate-y-0 sm:!rounded-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add food — {MEALS.find((m) => m.key === currentMeal)?.label}</DialogTitle>
              <DialogDescription>Search Open Food Facts and add by grams.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-3">
              <label className="grid gap-1">
                <div className="text-xs text-zinc-500">Search</div>
                <input
                  className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm"
                  value={foodSearchQuery}
                  onChange={(e) => setFoodSearchQuery(e.target.value)}
                  placeholder="e.g. eple / apple"
                />
              </label>

              {foodSearchLoading ? (
                <div className="text-sm text-zinc-500">Searching…</div>
              ) : null}

              {foodSearchError ? (
                <div className="rounded-2xl bg-zinc-50 p-3 text-sm text-zinc-700">{foodSearchError}</div>
              ) : null}

              {selectedFood ? (
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                  <div className="flex items-start gap-3">
                    {selectedFood.imageUrl ? (
                      <img
                        src={selectedFood.imageUrl}
                        alt=""
                        className="h-12 w-12 rounded-xl border border-zinc-200 object-cover"
                      />
                    ) : null}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-zinc-900">{selectedFood.productName}</div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {selectedFood.brands ? `${selectedFood.brands} • ` : ''}{selectedFood.code}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="grid gap-1">
                      <div className="text-xs text-zinc-500">Grams</div>
                      <input
                        className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                        inputMode="decimal"
                        value={manualGramsText}
                        onChange={(e) => setManualGramsText(e.target.value)}
                        placeholder="e.g. 150"
                      />
                    </label>
                    <div className="grid content-end">
                      <Button
                        variant="secondary"
                        disabled={parseOptionalNumber(manualGramsText) == null || (parseOptionalNumber(manualGramsText) ?? 0) <= 0}
                        onClick={() => {
                          const g = parseOptionalNumber(manualGramsText)
                          if (g == null || g <= 0) return
                          addSearchFoodToDiary(selectedFood, g)
                          setAddFoodOpen(false)
                        }}
                      >
                        Add
                      </Button>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setSelectedFood(null)}
                  >
                    Change food
                  </Button>
                </div>
              ) : (
                <div className="grid gap-2">
                  {foodSearchResults.map((r) => (
                    <button
                      key={r.code}
                      className={`flex items-center gap-3 rounded-2xl border p-3 text-left ${r.source === 'mvt' ? 'border-emerald-200 bg-emerald-50/50' : 'border-zinc-200 bg-white'}`}
                      onClick={() => setSelectedFood(r)}
                    >
                      {r.imageUrl ? (
                        <img
                          src={r.imageUrl}
                          alt=""
                          className="h-10 w-10 rounded-xl border border-zinc-200 object-cover"
                        />
                      ) : (
                        <div className={`grid h-10 w-10 place-items-center rounded-xl border text-lg ${r.source === 'mvt' ? 'border-emerald-200 bg-emerald-100' : 'border-zinc-200 bg-zinc-50'}`}>
                          {r.source === 'mvt' ? '🇳🇴' : '🔍'}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-zinc-900">{r.productName}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
                          {r.source === 'mvt' && <span className="rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-semibold text-emerald-700">MVT</span>}
                          {r.brands && r.source !== 'mvt' ? `${r.brands} · ` : ''}{r.nutrimentsPer100g.caloriesKcal ?? '?'} kcal/100g
                        </div>
                      </div>
                    </button>
                  ))}
                  {foodSearchQuery.trim() && !foodSearchLoading && foodSearchResults.length === 0 ? (
                    <div className="rounded-2xl bg-zinc-50 p-3 text-sm text-zinc-600">No results.</div>
                  ) : null}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {activeTab === 'scan' ? (
          <div className="mt-2 grid max-h-[calc(100dvh-7.5rem)] gap-4 overflow-y-auto pb-28">
            <div className="rounded-3xl border border-zinc-200 bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-900">Scan</div>
                  <div className="mt-0.5 text-xs text-zinc-500">Point the camera at the barcode.</div>
                </div>
                <button
                  className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm"
                  onClick={() => {
                    stopCamera()
                    setActiveTab('home')
                  }}
                >
                  Back
                </button>
              </div>

              {canBarcodeDetect ? (
                <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50">
                  <video ref={videoRef} className="h-40 w-full object-cover sm:h-56" muted playsInline />
                </div>
              ) : (
                <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
                  Camera barcode scanning isn’t supported in this browser yet.
                </div>
              )}

              <div className="mt-3 grid gap-2">
                <label className="grid gap-1">
                  <div className="text-xs text-zinc-500">Barcode</div>
                  <input
                    ref={barcodeInputRef}
                    className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm"
                    inputMode="numeric"
                    value={barcode}
                    readOnly={!manualBarcodeEntry}
                    onChange={(e) => setBarcode(e.target.value)}
                    placeholder={manualBarcodeEntry ? 'e.g. 7035620029894' : 'Scanning…'}
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => fetchOffProduct(barcode)}
                    disabled={offLoading || barcode.replace(/\D/g, '').length < 8}
                  >
                    {offLoading ? 'Looking…' : 'Lookup'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setManualBarcodeEntry(true)
                      stopCamera()
                      window.setTimeout(() => barcodeInputRef.current?.focus(), 0)
                    }}
                  >
                    Enter manually
                  </Button>
                </div>
              </div>
            </div>

            {offError ? (
              <div className="rounded-3xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm">
                {offError}
              </div>
            ) : null}

            {offProduct ? (
              <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
                {(() => {
                  const gramsRaw = parseOptionalNumber(gramsText)
                  const grams = gramsRaw == null ? 0 : clampNumber(gramsRaw, 0.1, 2000)
                  const factor = grams / 100
                  const n = offProduct.nutrimentsPer100g
                  const kcal = n.caloriesKcal == null ? undefined : Math.round(n.caloriesKcal * factor)
                  const protein = n.proteinG == null ? undefined : round1(n.proteinG * factor)
                  const carbs = n.carbsG == null ? undefined : round1(n.carbsG * factor)
                  const fat = n.fatG == null ? undefined : round1(n.fatG * factor)
                  const fiber = n.fiberG == null ? undefined : round1(n.fiberG * factor)
                  const canAdd = gramsRaw != null && gramsRaw > 0

                  return (
                    <>
                      <div className="flex items-start gap-3">
                        {offProduct.imageUrl ? (
                          <img
                            src={offProduct.imageUrl}
                            alt=""
                            className="h-16 w-16 rounded-2xl border border-zinc-200 object-cover"
                          />
                        ) : null}
                        <div className="min-w-0">
                          <div className="truncate text-base font-semibold text-zinc-900">{offProduct.productName}</div>
                          <div className="mt-1 text-xs text-zinc-500">
                            {offProduct.brands ? `${offProduct.brands} • ` : ''}{offProduct.code}
                          </div>
                          <div className="mt-2 text-xs text-zinc-500">
                            Adds to: {MEALS.find((m) => m.key === currentMeal)?.label}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 text-xs font-medium text-zinc-500">
                        For {canAdd ? grams : '—'} g
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <div className="rounded-2xl bg-zinc-50 p-3">
                          <div className="text-[10px] text-zinc-500">kcal</div>
                          <div className="mt-1 text-sm font-semibold text-zinc-900">{kcal ?? '—'}</div>
                        </div>
                        <div className="rounded-2xl bg-zinc-50 p-3">
                          <div className="text-[10px] text-zinc-500">Protein</div>
                          <div className="mt-1 text-sm font-semibold text-zinc-900">{protein ?? '—'}g</div>
                        </div>
                        <div className="rounded-2xl bg-zinc-50 p-3">
                          <div className="text-[10px] text-zinc-500">Carbs</div>
                          <div className="mt-1 text-sm font-semibold text-zinc-900">{carbs ?? '—'}g</div>
                        </div>
                        <div className="rounded-2xl bg-zinc-50 p-3">
                          <div className="text-[10px] text-zinc-500">Fat</div>
                          <div className="mt-1 text-sm font-semibold text-zinc-900">{fat ?? '—'}g</div>
                        </div>
                        <div className="rounded-2xl bg-zinc-50 p-3">
                          <div className="text-[10px] text-zinc-500">Fiber</div>
                          <div className="mt-1 text-sm font-semibold text-zinc-900">{fiber ?? '—'}g</div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <label className="grid gap-1">
                            <div className="text-xs text-zinc-500">Total grams</div>
                            <input
                              className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm"
                              inputMode="decimal"
                              value={gramsText}
                              onChange={(e) => setGramsText(e.target.value)}
                            />
                          </label>
                          <label className="grid gap-1">
                            <div className="text-xs text-zinc-500">Servings</div>
                            <input
                              className="h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm"
                              inputMode="decimal"
                              value={servings}
                              onChange={(e) => {
                                const v = clampNumber(Number(e.target.value || 0), 0.01, 20)
                                setServings(v)
                                setGramsText(String(Math.round(v * 1000) / 10))
                              }}
                            />
                          </label>
                        </div>

                        <Button
                          className="w-full"
                          variant="secondary"
                          disabled={!canAdd}
                          onClick={() => {
                            if (!canAdd) return
                            addOffServingToDiary(grams)
                            setActiveTab('home')
                          }}
                        >
                          Add to {MEALS.find((m) => m.key === currentMeal)?.label}
                        </Button>
                      </div>
                    </>
                  )
                })()}
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === 'profile' ? (
          <div className="mt-6 grid gap-4">
            {/* TDEE & Goal */}
            <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold text-zinc-900">TDEE & Goal</div>
              <div className="mt-1 text-xs text-zinc-500">Mifflin–St Jeor with activity multiplier</div>

              <div className="mt-3 grid gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <div className="text-[11px] font-medium text-zinc-500">Sex</div>
                    <select
                      className="h-9 w-full min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 px-2 text-sm"
                      value={profileDraft.sex}
                      onChange={(e) => setProfileDraft((d) => ({ ...d, sex: e.target.value as Sex }))}
                    >
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <div className="text-[11px] font-medium text-zinc-500">Birthdate</div>
                    <input
                      className="h-9 w-full min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 px-2 text-sm"
                      type="date"
                      value={profileDraft.birthdateISO}
                      onChange={(e) => setProfileDraft((d) => ({ ...d, birthdateISO: e.target.value }))}
                    />
                  </label>
                </div>

                <div className="text-[11px] text-zinc-500">Age: {computedAgeYears}</div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <div className="text-[11px] font-medium text-zinc-500">Height (cm)</div>
                    <input
                      className="h-9 w-full min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 px-2 text-sm"
                      inputMode="numeric"
                      value={profileDraft.heightCm}
                      onChange={(e) => setProfileDraft((d) => ({ ...d, heightCm: e.target.value }))}
                    />
                  </label>
                  <label className="grid gap-1">
                    <div className="text-[11px] font-medium text-zinc-500">Weight (kg)</div>
                    <input
                      className="h-9 w-full min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 px-2 text-sm"
                      inputMode="numeric"
                      value={profileDraft.weightKg}
                      onChange={(e) => setProfileDraft((d) => ({ ...d, weightKg: e.target.value }))}
                    />
                  </label>
                </div>

                <label className="grid gap-1">
                  <div className="text-[11px] font-medium text-zinc-500">Activity level</div>
                  <select
                    className="h-9 w-full min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 px-2 text-sm"
                    value={profileDraft.activity}
                    onChange={(e) => setProfileDraft((d) => ({ ...d, activity: e.target.value as ActivityLevel }))}
                  >
                    <option value="sedentary">Sedentary (office job)</option>
                    <option value="light">Light (1-3 days/wk)</option>
                    <option value="moderate">Moderate (3-5 days/wk)</option>
                    <option value="very">Very active (6-7 days/wk)</option>
                  </select>
                </label>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <div className="text-[11px] font-medium text-zinc-500">Goal</div>
                    <select
                      className="h-9 w-full min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 px-2 text-sm"
                      value={profileDraft.goalMode}
                      onChange={(e) => setProfileDraft((d) => ({ ...d, goalMode: e.target.value as GoalMode }))}
                    >
                      <option value="cut">Cut (deficit)</option>
                      <option value="maintain">Maintain</option>
                      <option value="bulk">Bulk (surplus)</option>
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <div className="text-[11px] font-medium text-zinc-500">Adjustment (kcal)</div>
                    <input
                      className="h-9 w-full min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 px-2 text-sm"
                      inputMode="numeric"
                      value={profileDraft.goalDeltaKcal}
                      onChange={(e) => setProfileDraft((d) => ({ ...d, goalDeltaKcal: e.target.value }))}
                      disabled={profileDraft.goalMode === 'maintain'}
                    />
                  </label>
                </div>

                <div className="rounded-2xl bg-zinc-50 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-600">BMR</span>
                    <span className="font-semibold text-zinc-900">{Math.round(mifflinStJeorBmr(profilePreview))} kcal</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <span className="text-zinc-600">TDEE</span>
                    <span className="font-semibold text-emerald-600">{tdeePreview} kcal</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <span className="text-zinc-600">Daily goal</span>
                    <span className="font-semibold text-zinc-900">{goalCaloriesPreview} kcal</span>
                  </div>
                </div>

                <Button
                  variant="secondary"
                  disabled={!profileIsDirty}
                  onClick={() => {
                    const oldGoalCalories = goalCalories
                    const oldMacroCalories = Math.max(1, macroTargetCalories)
                    const height = clampIntOrFallback(profileDraft.heightCm, 120, 230, profile.heightCm)
                    const weight = clampIntOrFallback(profileDraft.weightKg, 30, 250, profile.weightKg)
                    const adjustment = clampIntOrFallback(profileDraft.goalDeltaKcal, 0, 1500, profile.goalDeltaKcal)
                    const birthdateISO = profileDraft.birthdateISO.trim() ? profileDraft.birthdateISO.trim() : undefined

                    const newGoalCalories = goalCaloriesPreview

                    setProfile((p) => ({
                      ...p,
                      sex: profileDraft.sex,
                      activity: profileDraft.activity,
                      goalMode: profileDraft.goalMode,
                      birthdateISO,
                      heightCm: height,
                      weightKg: weight,
                      goalDeltaKcal: adjustment,
                    }))

                    if (newGoalCalories !== oldGoalCalories) {
                      const scale = newGoalCalories / oldMacroCalories
                      setMacroTargets((t) => ({
                        ...t,
                        proteinG: clampNumber(Math.round(t.proteinG * scale * 10) / 10, 0, 600),
                        carbsG: clampNumber(Math.round(t.carbsG * scale * 10) / 10, 0, 1000),
                        fatG: clampNumber(Math.round(t.fatG * scale * 10) / 10, 0, 400),
                        fiberG: clampNumber(Math.round(t.fiberG * scale * 10) / 10, 0, 200),
                      }))
                    }

                    setProfileJustSaved(true)
                    window.setTimeout(() => setProfileJustSaved(false), 1200)
                  }}
                >
                  {profileJustSaved ? 'Saved' : 'Save'}
                </Button>

                {profileJustSaved ? (
                  <div className="text-xs font-medium text-emerald-600">Saved locally</div>
                ) : null}
              </div>
            </div>

            {/* Macro Targets */}
            <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold text-zinc-900">Macro Targets</div>
              <div className="mt-1 text-xs text-zinc-500">P/C/F at 4/4/9 kcal·g⁻¹, fiber at 2</div>

              <div className="mt-3">
                <MacroWheel size={132} />
              </div>

              <div className="mt-3 grid gap-4">
                {([
                  { key: 'proteinG' as const, label: 'Protein', color: '#22c55e', max: 600, unit: 'g', kcalPer: 4 },
                  { key: 'carbsG' as const, label: 'Carbs', color: '#0ea5e9', max: 1000, unit: 'g', kcalPer: 4 },
                  { key: 'fatG' as const, label: 'Fat', color: '#8b5cf6', max: 400, unit: 'g', kcalPer: 9 },
                  { key: 'fiberG' as const, label: 'Fiber', color: '#f59e0b', max: 200, unit: 'g', kcalPer: 2 },
                ] as const).map((m) => (
                  <div key={m.key}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: m.color }} />
                        <span className="text-xs font-medium text-zinc-700">{m.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input
                          className="h-7 w-16 min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 px-1.5 text-center text-xs tabular-nums"
                          inputMode="numeric"
                          value={macroTargets[m.key]}
                          onChange={(e) =>
                            setMacroTargets((t) => ({ ...t, [m.key]: clampNumber(Number(e.target.value || 0), 0, m.max) }))
                          }
                        />
                        <span className="text-[10px] text-zinc-400">{m.unit}</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={m.max}
                      step={1}
                      value={macroTargets[m.key]}
                      onChange={(e) =>
                        setMacroTargets((t) => ({ ...t, [m.key]: clampNumber(Number(e.target.value), 0, m.max) }))
                      }
                      className="mt-1 h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-200 accent-current"
                      style={{ accentColor: m.color } as React.CSSProperties}
                    />
                    <div className="mt-0.5 text-right text-[10px] text-zinc-400">
                      {Math.round(macroTargets[m.key] * m.kcalPer)} kcal
                    </div>
                  </div>
                ))}

                <div className="rounded-2xl bg-zinc-50 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-600">Macro total</span>
                    <span className="font-semibold text-zinc-900">{macroTargetCalories} kcal</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <span className="text-zinc-600">Daily goal</span>
                    <span className="font-semibold text-zinc-900">{goalCalories} kcal</span>
                  </div>
                  {Math.abs(macroTargetCalories - goalCalories) > 50 && (
                    <div className="mt-2 text-xs text-amber-600">
                      ⚠ Macro total differs from calorie goal by {Math.abs(macroTargetCalories - goalCalories)} kcal
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto grid max-w-sm grid-cols-4 px-2 py-1.5">
          <button
            className={`flex flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-semibold ${
              activeTab === 'home' ? 'bg-zinc-900 text-white' : 'text-zinc-500'
            }`}
            onClick={() => setActiveTab('home')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" /></svg>
            Home
          </button>
          <button
            className={`flex flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-semibold ${
              activeTab === 'diary' ? 'bg-zinc-900 text-white' : 'text-zinc-500'
            }`}
            onClick={() => setActiveTab('diary')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" /></svg>
            Diary
          </button>
          <button
            className="flex flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-semibold text-emerald-600"
            onClick={() => setQuickAddOpen(true)}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg>
            </div>
            Add
          </button>
          <button
            className={`flex flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-semibold ${
              activeTab === 'profile' ? 'bg-zinc-900 text-white' : 'text-zinc-500'
            }`}
            onClick={() => setActiveTab('profile')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" /></svg>
            Profile
          </button>
        </div>
      </nav>

      <div className="sr-only">{tdee}</div>
      <div className="sr-only">{macroTargetCalories}</div>
      <div className="sr-only">{remaining.fiberG}</div>

      <div className="sr-only">{profile.sex}</div>
      <div className="sr-only">{profile.ageYears}</div>
      <div className="sr-only">{profile.heightCm}</div>
      <div className="sr-only">{profile.weightKg}</div>
      <div className="sr-only">{profile.activity}</div>
      <div className="sr-only">{profile.goalMode}</div>
      <div className="sr-only">{profile.goalDeltaKcal}</div>

      <div className="sr-only">{macroTargets.proteinG}</div>
      <div className="sr-only">{macroTargets.carbsG}</div>
      <div className="sr-only">{macroTargets.fatG}</div>
      <div className="sr-only">{macroTargets.fiberG}</div>

      <div className="sr-only">{diaryEntries.length}</div>
    </div>
  )
}

export default App
